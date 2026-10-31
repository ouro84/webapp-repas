---
paths:
  - "supabase/**"
  - "lib/persistance.ts"
  - "lib/recettes.ts"
  - "lib/foyer.ts"
  - "lib/preferences.ts"
  - "app/api/**"
  - "scripts/query-supabase.mjs"
  - "scripts/generer-seed-recettes.mjs"
---

# Supabase : migrations, RLS, RPC

## Migrations

- **Tout changement de schéma passe par un fichier** `supabase/migrations/<timestamp 14 chiffres>_<nom>.sql`, appliqué par la CI via `supabase db push` (staging sur chaque PR, prod sur push `main`). Le SQL editor ne modifie jamais le schéma, sinon la base diverge des migrations.
- **Appliquer une migration de branche sur staging avant `npm run test:e2e:staging`** : l'exécuter via `node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "<sql>"`, puis l'inscrire dans `supabase_migrations.schema_migrations` pour que le `db push` de la CI ne la rejoue pas.
- **Sans CI** (crédits Actions épuisés) : appliquer le fichier `.sql` par un script Node qui le lit et l'envoie à l'API de management (`/v1/projects/<ref>/database/query`), puis insérer `(version, name, statements = array[<contenu>])` dans `supabase_migrations.schema_migrations`. Pourquoi : un SQL qui contient `$$` et des apostrophes casse en argument shell de `query-supabase.mjs`. En prod, uniquement sur validation humaine, migration **avant** le merge.
- La baseline `20260606225900_init.sql` est marquée appliquée sur prod et staging ; une base neuve la rejoue entièrement.
- Vérifier le schéma prod : `node scripts/query-supabase.mjs gabyhlcwahzquolwxmgd "<sql>"`. Si une migration n'a pas atteint la prod (run `push` absent, cf. `ci.md`), la relancer via `gh workflow run CI --ref main`, jamais à la main.

## Scope foyer et RLS

- La propriété des données partagées est le **foyer** : `recette` (garde aussi `user_id` = créateur ; global = `foyer_id IS NULL`), `recette_ingredient` / `planning_slot` (via le parent), `planning`, `etat_courses_article`, `recette_masquee`, `recette_preference`, `cycle_courses`, `article_manuel`. **`reglages` reste par utilisateur.**
- **Toute RLS passe par le helper `mon_foyer()`** (`SECURITY DEFINER`, lit `profiles`), plutôt qu'une réimplémentation de `auth.uid() = user_id`.
- Les inserts directs **omettent `foyer_id`** : la colonne a `default mon_foyer()`.
- **Insertion de `recette`** : le `with check` contraint aussi `user_id IS NULL OR user_id = auth.uid()` (anti-usurpation d'auteur). L'UPDATE n'a pas cette contrainte, car un membre édite la recette d'un autre (RG-30).
- `chargerRecettesGerees` : `editable = foyer_id !== null`.
- **Grant au niveau colonne** quand le client doit écrire une partie d'une table sensible : `profiles` (`grant update (prenom, couleur_avatar, onboarding_complete, …)`) et `foyers` (`revoke update` puis `grant update (jour_courses)`). Pourquoi : une policy seule laisserait réécrire `foyer_id` ou `code_invitation` ; les RPC `SECURITY DEFINER` restent libres d'écrire ces colonnes.
- **Table `ingredient`** : catalogue global partagé, lecture réservée aux authentifiés, UNIQUE `(nom, categorie, fond_de_placard)`. `trouverOuCreerIngredient` (`lib/recettes.ts`) fait un select-then-insert ; une course concurrente lève `23505`, rattrapée en relisant le triplet (`lireIngredientParTriplet`). Ce repli reste en place.

## Écritures : RPC ou direct

- **RPC `SECURITY DEFINER` atomiques** (foyer dérivé de `mon_foyer()`, jamais fourni par le client) : `sauvegarder_planning` (remplace la semaine), `sauvegarder_slots` (upsert des seuls slots fournis), `sauvegarder_cycle` (jours d'un cycle sur N semaines ISO + purge des coches RG-13 en une transaction : « Générer mon cycle » web **et** MCP, jamais N × `sauvegarder_slots` côté client), `generer_code_invitation`, `apercu_invitation`, `rejoindre_foyer`, `quitter_foyer`, `supprimer_mon_compte`. `planning` n'a donc que des policies select + delete. Pourquoi : un `delete → insert` côté client n'est pas atomique (course entre deux appareils).
- **Écritures directes sous RLS** quand une opération = une ligne : coches (`etat_courses_article`), `article_manuel`, `recette`, `recette_masquee`, `recette_preference`.
- **Les RPC de planning refusent un `recette_id` hors catalogue global et hors foyer** (`exiger_recettes_visibles`, appelée avant toute écriture par `sauvegarder_planning` / `sauvegarder_slots` / `sauvegarder_cycle`). Pourquoi : `SECURITY DEFINER` contourne la RLS de `recette` ; sans ce contrôle, un client plaçait la recette d'un autre foyer dans son planning. Une recette masquée reste acceptée.
- **Grants d'une nouvelle RPC** : `revoke execute … from public` **et** `from anon`, puis `grant … to authenticated`. Pourquoi : Supabase accorde explicitement `execute` à `anon` sur les nouvelles fonctions du schéma `public`, que `revoke from public` ne retire pas.
- `planning.version` est incrémenté par la RPC ; `updated_at` est posé par trigger (cf. `sync-planning.md`).
- **PostgREST rejette tout `UPDATE` sans clause WHERE** (`21000: UPDATE requires a WHERE clause`), même quand la RLS bornerait déjà le résultat. Ajouter un filtre qui matche les lignes visibles (ex. `.not("id","is",null)`).

## Fonctions `SECURITY DEFINER`

- `set search_path = public, extensions` dès qu'elles appellent une fonction d'extension (`gen_random_bytes`, etc.), car les extensions vivent dans le schéma `extensions`. Sinon : `ERROR 42883 … does not exist`.
- **Une fonction jamais exécutée peut cacher un bug jusqu'à son premier appel.** Chaque RPC est exercée par un e2e ou par un test SQL en transaction `rollback` (impersonation `set local request.jwt.claims`).

## FK sans cascade vers `foyers` : checklist de toute nouvelle table scopée foyer

Les FK vers `foyers(id)` ne sont **pas** `ON DELETE CASCADE`. Toute nouvelle table portant `foyer_id` oblige, dans la même migration, à **recréer** :
1. `rejoindre_foyer()` : purger la table avant `delete from foyers` (sinon violation `23503` à la jonction) ;
2. `quitter_foyer()` : la **cloner** vers le nouveau foyer (RG-34) ;
3. `supprimer_mon_compte()` : la purger dans la branche solo.
Un renommage ou une suppression de colonne référencée par ces fonctions impose aussi de les recréer.

**Exception : `executeur_panier` et `demande_panier` sont en `on delete cascade`** vers `foyers`. Rien à recréer dans `rejoindre_foyer`, `quitter_foyer` ni `supprimer_mon_compte`, et rien n'est cloné à la sortie. Pourquoi : l'exécuteur appartient à l'installation du foyer, pas à la personne qui part ; la cascade (et le trigger Vault ci-dessous) nettoie tout quand le foyer disparaît.

## Demandes de panier (`demande_panier`, `executeur_panier`)

- **Codes d'erreur applicatifs en SQLSTATE `OMQ0x`** : `OMQ01` aucun exécuteur, `OMQ02` demande déjà active, `OMQ03` demande non rapportable. La route et le MCP les lisent par `error.code` ; les messages vivent dans `MESSAGES_PANIER` (`lib/panier.ts`). Pourquoi : un code stable évite de filtrer sur un message français que PostgREST peut reformuler.
- **Secret du webhook dans Supabase Vault, `name` unique** (`executeur_panier:<foyer>:chronodrive`) : `enregistrer_executeur_panier` met à jour le secret existant au lieu d'en créer un second, et un trigger `after delete` sur `executeur_panier` supprime le secret (y compris par la cascade du foyer). Pourquoi : Vault n'a pas de FK vers la table, un secret orphelin y resterait.
- **`enregistrer_executeur_panier` n'est exécutable que par `service_role`** (`revoke` de `public`, `anon` et `authenticated`), et les tables n'ont aucun droit d'écriture pour les rôles client : tout passe par les RPC. Pourquoi : un client authentifié ne doit jamais pouvoir poser l'URL ni le secret d'un webhook.
- **« Une seule demande active » repose sur l'index unique partiel** (`demande_panier_active_idx`) ; le `exists` préalable ne sert que le cas courant. Pourquoi : deux clics simultanés passent tous les deux le select.
- **`creer_demande_panier` et `rapporter_panier` prennent `pg_advisory_xact_lock(hashtext('panier:' || foyer))`** juste après la résolution du foyer. Une nouvelle RPC qui crée une demande ou vérifie qu'aucune demande plus récente n'existe prend le même verrou. Pourquoi : sans lui, un rapport tardif pouvait être accepté pendant qu'une demande plus récente se créait (RG-84).
- **CHECK de `demande_panier`** : `(statut = 'echec') = (cause_echec is not null)`, `motif_echec` ≤ 500 caractères, `rapport` objet portant les trois listes et ≤ 64 Kio. Tout chemin qui change `statut` pose ou remet à null `cause_echec` dans le même `update`. Pourquoi : un rapport tardif `terminee` sur une demande `echec` violerait sinon la contrainte ; le contenu du rapport reste validé par zod, la base ne garde que la forme.
- **Chaque RPC du cycle de vie appelle d'abord `expirer_demandes_panier(foyer)`** (expiration paresseuse, pas de `pg_cron`) ; une nouvelle RPC qui lit ou écrit une demande doit faire de même. Pourquoi : sans tâche planifiée, c'est le seul moment où une demande périmée se ferme.

## Clonage à la sortie (`quitter_foyer`, RG-34)

On **clone**, on ne déplace pas : le foyer quitté garde tout. Remap d'ids via des tables temporaires (`_map_recette`, `_map_planning`, `on commit drop`). Un slot pointe vers la recette clonée si elle appartenait au foyer, et garde l'id d'origine pour une globale (`coalesce(mr.nouvelle, ps.recette_id)`). Les recettes clonées prennent `user_id = auth.uid()`. Le profil est détaché **en dernier**.

## Suppression de compte (`supprimer_mon_compte`)

**Solo** : purge complète du foyer, dans l'ordre coches, articles manuels, cycles, préférences, masquages, plannings, recettes, profil, foyer (`profiles.foyer_id → foyers` est `RESTRICT`). **Partagé** : `recette.user_id = NULL` puis suppression du seul profil. Côté route, l'ordre RPC puis `deleteUser` est décrit dans `foyer-compte.md`.

## Realtime

Publier une table dans `supabase_realtime` pour la suivre. Elle doit être en `REPLICA IDENTITY FULL` si le client lit `old` au DELETE (coches, `article_manuel`) ; ce n'est pas nécessaire pour `planning`, dont on ne lit que `new`. Les events respectent la RLS via le JWT.

## Seed du catalogue

`scripts/generer-seed-recettes.mjs` émet `vegetarien` / `accompagnement` / `saisons` / `etapes`. `--fragment` n'émet que le corps d'insert, pour l'insérer dans un bloc `do $$` qui fait autre chose (réassignation, masquage). Une migration qui touche des données par utilisateur résout le compte par email via `auth.users` (`profiles` n'a pas d'email) et doit être un no-op si le compte est absent (portabilité staging/prod).
