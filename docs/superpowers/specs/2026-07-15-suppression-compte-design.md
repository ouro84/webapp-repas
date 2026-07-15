# Design — Suppression de compte (droit à l'effacement RGPD)

> Date : 2026-07-15
> Statut : design validé, prêt pour plan d'implémentation
> Issue : #237 (US-31, épopée B2C #234, lot 1 RGPD — bloqueur d'ouverture)

---

## 1. Problème & besoin

Aujourd'hui, aucun mécanisme de suppression de compte n'existe : le droit à l'effacement
(RGPD art. 17) n'est honoré que **manuellement** (email à l'éditeur, traité à la main — cf.
politique de confidentialité). C'est un bloqueur documenté avant toute ouverture publique
(épopée B2C #234, lot 1 RGPD, avec #235/#236 déjà livrés).

## 2. Décisions produit

| # | Décision |
|---|----------|
| D1 | Suppression **réelle** (compte `auth.users` + données), pas un flag « désactivé ». |
| D2 | Déclenchée depuis `/profil`, nouvelle section **« Zone dangereuse »**, après ré-authentification (mot de passe) **et** confirmation forte (saisie exacte de « SUPPRIMER »). |
| D3 | **Solo** (seul membre de son foyer) : tout est purgé — foyer, recettes, plannings, coches, masquages, préférences, réglages, profil. Le catalogue global (`foyer_id IS NULL`) n'est jamais touché. |
| D4 | **Foyer partagé** (2+ membres) : le partant est retiré, ses recettes **restent** dans le foyer (réattribuées `user_id = NULL`, `foyer_id` inchangé — la visibilité ne dépend que de `foyer_id` depuis #56), les autres membres conservent tout intact. |
| D5 | Redirection après succès vers une nouvelle page **publique** `/compte-supprime` (message de confirmation, lien vers l'accueil) — pas un simple retour à `/login`. |
| D6 | Pas de garde serveur sur le texte « SUPPRIMER » (confirmation UX, pas un contrôle de sécurité — la ré-authentification par mot de passe *est* le contrôle de sécurité, comme pour le changement de mot de passe #22). |
| D7 | Échec de `deleteUser` après une RPC déjà réussie : erreur loggée (Sentry) + message « réessaie » côté client. Rejouable sans danger (RPC idempotente : chaque étape est un DELETE/UPDATE conditionnel). |

## 3. Piège de conception (vérifié sur staging, 2026-07-15)

`recette.user_id → auth.users(id)` porte un **`ON DELETE CASCADE`** (confirmé via
`pg_constraint` sur le projet staging `upxoxrjumxpzumakawiv`). Appeler
`admin.auth.admin.deleteUser()` **avant** d'avoir traité les recettes d'un membre de foyer
partagé détruirait donc, en cascade, les recettes qu'il a créées **pour tout le foyer** — pas
seulement pour lui. Toute la logique de purge/réattribution doit donc s'exécuter **avant**
`deleteUser`, jamais après ni en parallèle.

`profiles.foyer_id → foyers(id)` porte un `ON DELETE RESTRICT` : en solo, il faut supprimer la
ligne `profiles` **avant** la ligne `foyers`, pas l'inverse.

Aucune autre table de contenu ne référence `auth.users` directement (RG-30+ : le scope est
passé de `user_id` à `foyer_id` depuis #56) — seules `recette.user_id` et `reglages.user_id`
le font. `reglages` (réglages de génération **par utilisateur**, RG existante) n'a **aucune
action à prévoir dans la RPC** : son `ON DELETE CASCADE` s'exécute correctement tel quel dans
les deux branches (solo et partagé) — un réglage personnel doit disparaître avec son
utilisateur, qu'il soit seul ou en foyer partagé.

## 4. Architecture

```
/profil (Zone dangereuse)
  → ré-auth (mot de passe) + saisie "SUPPRIMER"
  → POST /api/compte/supprimer
       → route serveur (client cookies, session utilisateur)
       → RPC supprimer_mon_compte()  [SECURITY DEFINER, purge/réattribution SQL]
       → client ADMIN (service_role) . auth.admin.deleteUser(user.id)
  → signOut local + redirection pleine page → /compte-supprime (page publique)
```

Nouveau fichier `lib/supabase/admin.ts` : client `service_role`, **importé uniquement** par
`app/api/compte/supprimer/route.ts` (jamais par du code client — même discipline que
`SUPABASE_ACCESS_TOKEN`/`UPSTASH_*`, secrets serveur uniquement).

## 5. RPC `supprimer_mon_compte()`

`SECURITY DEFINER`, même famille que `quitter_foyer()`/`rejoindre_foyer()`. Foyer dérivé de
`mon_foyer()`. Branche sur `select count(*) from profiles where foyer_id = mon_foyer()` :

**Solo (1 membre)** — purge intégrale, dans cet ordre (contraintes FK `NO ACTION`/`RESTRICT`
sur `foyer_id`, aucune n'est `CASCADE`, cf. §3) :
1. `etat_courses_article`, `article_manuel`, `cycle_courses`, `recette_preference`,
   `recette_masquee` où `foyer_id = mon_foyer()`.
2. `planning` où `foyer_id = mon_foyer()` (cascade `planning_slot`).
3. `recette` où `foyer_id = mon_foyer()` (cascade `recette_ingredient`, et les éventuelles
   lignes `recette_preference`/`recette_masquee` restantes par `recette_id`).
4. `profiles` où `user_id = auth.uid()`.
5. `foyers` où `id = mon_foyer()`.

**Partagé (2+ membres)** :
1. `update recette set user_id = null where foyer_id = mon_foyer() and user_id = auth.uid()`
   (empêche la cascade de #3 de détruire les recettes du foyer — RG piège §3).
2. `delete from profiles where user_id = auth.uid()`.
3. **Rien d'autre** : le foyer, son planning, ses coches, ses recettes restent intacts pour les
   autres membres.

Idempotente : rejouer la RPC après un premier succès partiel ne trouve plus rien à purger côté
foyer (déjà fait) et se contente, le cas échéant, de retenter la suppression du profil (déjà
absent → no-op).

## 6. Route serveur `app/api/compte/supprimer/route.ts`

1. Session utilisateur via le client serveur (cookies) — 401 si absente.
2. Appelle la RPC via ce même client (RLS + `SECURITY DEFINER` gèrent la portée).
3. Si la RPC réussit, appelle `client_admin.auth.admin.deleteUser(user.id)`.
4. Si `SUPABASE_SERVICE_ROLE_KEY` est absente à l'exécution : erreur explicite loggée
   (`console.error` + Sentry), réponse 500 avec message actionnable — **jamais** de succès
   silencieux (contrairement au NO-OP volontaire d'Upstash : une suppression ne doit jamais
   faire semblant de réussir).
5. Si `deleteUser` échoue après une RPC réussie : 500 + log Sentry ; le client affiche
   « Une erreur est survenue, réessaie » — un second appel est sûr (RPC idempotente).

## 7. UI — section « Zone dangereuse » de `/profil`

Nouveau composant `components/profil/supprimer-compte.tsx`, même patron que
`ChangerMotDePasse` (section autonome, formulaire, pas de modale) :
- Champ « Mot de passe actuel » (ré-authentification, `signInWithPassword`).
- Champ texte « Tape SUPPRIMER pour confirmer » — bouton de soumission **désactivé** tant que
  la valeur exacte n'est pas saisie.
- Bouton final en rouge (`bg-red-*`, cohérent avec les encadrés d'état — cf. sémantique des
  couleurs du design system).
- Succès : `signOut({ scope: 'local' })` (ne révoque pas les autres appareils/membres, comme la
  déconnexion existante) puis navigation pleine page vers `/compte-supprime`.
- Erreur : message inline (`role="alert"`), le formulaire reste rempli pour réessayer.

Section placée **après** « Vie privée » (dernière section de `/profil`, hors lien de
déconnexion qui reste tout en bas).

## 8. Nouvelle page `/compte-supprime`

Route publique, statique (aucune donnée à charger) : titre de confirmation, message bref,
lien vers l'accueil `/`. Hors `protectedRoutes` **et** hors garde d'onboarding du proxy (comme
`/legal/*`, #235) — un compte qui vient d'être supprimé n'est plus authentifié.

## 9. Tests

- **Test SQL en transaction `rollback`** (impersonation JWT, `set local request.jwt.claims`,
  comme #56 PR6) : vérifie finement chaque table touchée, pour un scénario **solo** et un
  scénario **partagé** — exécuté en dev sur staging+prod, jamais commité tel quel (transaction
  annulée).
- **e2e réels** (comptes JETABLES, staging) :
  - Solo : un compte jetable se supprime lui-même → vérifie que le compte ne peut plus se
    reconnecter, que la page `/compte-supprime` s'affiche.
  - Partagé : deux comptes jetables (X invite, Y rejoint) — Y se supprime → X constate que
    Y a disparu du foyer mais que **son propre contenu** (recettes, planning) est intact ;
    vérification REST que les recettes créées par Y sous le foyer partagé existent encore
    (`user_id IS NULL`, `foyer_id` inchangé).
  - Nécessite `SUPABASE_SERVICE_ROLE_KEY` (staging) dans les secrets CI — **déjà posé** dans
    les coffres GitHub Actions et Dependabot (`STAGING_SUPABASE_SERVICE_ROLE_KEY`) et sur
    Vercel Production (`SUPABASE_SERVICE_ROLE_KEY`), 2026-07-15.
- Pas de logique pure isolée à tester unitairement (tout est SQL + route serveur).

## 10. Hors scope (YAGNI, à noter si redécouvert plus tard)

- Export des données avant suppression (#238, issue séparée — droit à la portabilité).
- Délai de grâce / annulation différée (« tu as 30 jours pour te raviser ») — suppression
  immédiate, comme demandé par l'issue.
- Notification aux autres membres du foyer quand quelqu'un se supprime (contrairement à
  `quitter_foyer`, aucune UI de notification prévue ici — le foyer partagé constate juste
  l'absence du membre à la prochaine consultation).
