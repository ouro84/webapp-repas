# PR4c (#320) — Panier Chronodrive multi-cycle : implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une demande de panier vise **le cycle affiché** (courant ou à venir, refusé si terminé), que ce soit depuis le bouton de `/courses` ou depuis l'assistant (`lancer_demande_panier`). L'exécuteur lit et coche ce cycle-là. La carte montre la demande de chaque cycle, grise le bouton sur un cycle terminé, porte les libellés « Remplir mon panier » / « Compléter mon panier » et le logo Chronodrive.

**Architecture :**
- La garde « cycle terminé » vit en base (`creer_demande_panier`, nouveau code `OMQ04`), avec un miroir TS pur (`cycleTermine`) pour l'UI. C'est la règle du jumeau.
- La création et l'envoi du webhook sont extraits de la route dans une fonction serveur partagée par la route et l'outil MCP.
- `etat_panier(p_ancre)` renvoie la dernière demande **du cycle demandé** et la demande active du foyer, quel que soit son cycle.

**Tech Stack:** Next.js 16, Supabase (migration SQL, RPC `SECURITY DEFINER`), Vitest, Playwright (staging), skill Hermes (Markdown).

**Spec:** `SPECS_FONCTIONNELLES.md` US-53, RG-81, RG-82, RG-83, RG-84, RG-85 (déjà à jour), `ADR.md` ADR-12 (« Précisions du grilling de #320 »).

## Global Constraints

- **Cycle terminé** = son dernier jour (`ancre + longueur − 1`, longueur lue dans `cycle_courses`, 7 par défaut) est **strictement antérieur à aujourd'hui à Paris**. Côté SQL : `(now() at time zone 'Europe/Paris')::date`. Côté TS : `aujourdhuiParis()`. Le cycle courant et les cycles à venir ne sont jamais terminés.
- Motif affiché sur un cycle terminé, mot pour mot : « Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir. »
- Libellés : « Remplir mon panier » (principal) ; « Compléter mon panier » (secondaire) **seulement si** la dernière demande du cycle affiché est `terminee` **et** au moins un article de ce cycle est coché (`aDesCoches`) ; « Panier en cours… » pendant une demande active.
- Une seule demande active par foyer, quel que soit son cycle (index unique existant, RG-83) : une demande active désactive le bouton partout.
- Migration : `supabase/migrations/20261101120000_panier_multi_cycle.sql`. Règles de `.claude/rules/supabase.md` :
  - `SECURITY DEFINER` avec `search_path` explicite (garder celui de chaque fonction) ;
  - verrou `pg_advisory_xact_lock(hashtext('panier:' || foyer))` et `expirer_demandes_panier` d'abord ;
  - grants : `revoke … from public, anon`, puis `grant … to authenticated` ;
  - changer une signature impose `drop function` puis recréation avec ses grants.
- OMQ ne parle jamais à l'enseigne (RG-80). Le webhook reste sans donnée métier (`{"evenement":"demande_panier"}`) : l'ancre est dans la demande, lue par `prendre_demande_panier`.
- Tout en français ; commentaires qui citent RG-xx / #320 ; apostrophe typographique `’` dans le texte JSX.
- Mobile-first, tokens du design system (`.claude/rules/ui.md`, `DESIGN.md`), dark mode compris.

## Review Focus

1. **Demande sur un cycle terminé par un appel direct** (route ou RPC, sans passer par l'UI) : refusée par la base (`OMQ04`, 409), aucune demande ni webhook. → tests Task 1 (SQL via e2e) et Task 2.
2. **Bascule de cycle avec une demande active ailleurs** : la carte d'un autre cycle affiche le bouton désactivé (« Panier en cours… ») et ne montre pas le rapport d'un autre cycle. → tests Task 4.
3. **`cocher_article` avec une ancre de cycle à venir** : coche dans ce cycle, jamais dans le cycle courant ; le même libellé présent dans les deux cycles n'est coché que dans le cycle demandé. → test Task 3.
4. **Ancre absente ou mal formée dans le corps de la route** : ancre absente → cycle courant (rétrocompatible) ; ancre mal formée → 400, aucune RPC. → test Task 2.
5. **« Tout décocher » après un compte-rendu** : le bouton repasse à « Remplir mon panier ». → test Task 4.

---

### Task 1 : migration (garde cycle terminé, `etat_panier(p_ancre)`) et miroir TS

**Files:**
- Create: `supabase/migrations/20261101120000_panier_multi_cycle.sql`
- Modify: `lib/cycles.ts` (`cycleTermine`), `lib/panier.ts` (`MESSAGES_PANIER.OMQ04`), `lib/panier-affichage.ts` (type `EtatPanier`)
- Test: `lib/cycles.test.ts`

**Interfaces:**
- SQL :
  - `creer_demande_panier(p_ancre date)`, même signature (`create or replace`) : après le verrou et `expirer_demandes_panier`, et **avant** le contrôle de l'exécuteur, lever `OMQ04` (errcode personnalisé, comme `OMQ01`/`OMQ02`) si `p_ancre + coalesce((select longueur from cycle_courses where foyer_id = v_foyer and ancre = p_ancre), 7) - 1 < (now() at time zone 'Europe/Paris')::date`. Le reste est inchangé.
  - `etat_panier(p_ancre date default null)` : `drop function etat_panier()` puis recréation avec les mêmes grants. Elle renvoie `{ executeur, derniere, active }` :
    - `derniere` = la dernière demande (`order by cree_le desc limit 1`) **dont `ancre = p_ancre`**, ou de tout le foyer si `p_ancre is null` ;
    - `active` = la demande `en_attente`/`en_cours` du foyer, ou `null`, même objet JSON que `derniere`.
  - L'appel sans argument (`rpc('etat_panier')`) reste valide grâce au défaut.
- TS :
  - `export function cycleTermine(ancre: string, longueur: number, aujourdhui: Date): boolean` dans `lib/cycles.ts` : dernier jour de `joursDuCycle(ancre, longueur)` < date ISO locale d'`aujourdhui` ;
  - `MESSAGES_PANIER.OMQ04 = "Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir."` ;
  - `EtatPanier = { executeur: boolean; derniere: DemandePanier | null; active: DemandePanier | null }`.

- [ ] **Step 1 : test qui échoue.** `lib/cycles.test.ts` : « cycleTermine : la veille du début → non ; dernier jour = aujourd'hui → non ; dernier jour = hier → oui ; cycle de 5 jours ; cycle à venir → non ».
- [ ] **Step 2 : constater l'échec.** Run : `npx vitest run lib/cycles.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** `cycleTermine`, le message, le type, puis la migration. En tête de la migration, un commentaire donne le pourquoi (#320, RG-81/84/85) et précise que la garde « cycle terminé » a un miroir TS (`cycleTermine`).
- [ ] **Step 4 : vérifier.** Run : `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS. Les tests qui typent `EtatPanier` sans `active` peuvent casser : ajoute `active: null` aux fixtures concernées, rien de plus (l'usage arrive en Task 4). Ne pas appliquer la migration : le contrôleur s'en charge sur staging.
- [ ] **Step 5 : commit.** `feat: garde cycle terminé et etat_panier par cycle (#320, RG-81, RG-84)`

### Task 2 : demande sur le cycle affiché (fonction serveur partagée, route, client)

**Files:**
- Create: `lib/panier-demande.ts` (serveur)
- Modify: `app/api/panier/demande/route.ts`, `lib/panier-client.ts`
- Test: `lib/panier-demande.test.ts`, `app/api/panier/demande/route.test.ts`, `lib/panier-client.test.ts`

**Interfaces:**
- Produces :

```ts
// lib/panier-demande.ts — création + webhook + fermeture si injoignable, extrait de la route (jumeau route / MCP)
export type ResultatDemande =
  | { ok: true; demandeId: string }
  | { ok: false; statut: 409 | 500 | 502; message: string; code?: "OMQ01" | "OMQ02" | "OMQ04" }
export async function creerEtEnvoyerDemande(
  supabase: ClientSupabase,
  ancre: string,
  options?: { fetch?: typeof fetch }
): Promise<ResultatDemande>
```

  Elle reprend à l'identique la séquence actuelle de la route : `rpc("creer_demande_panier", { p_ancre })` (`OMQ01`/`OMQ02`/`OMQ04` → 409 avec `MESSAGES_PANIER[code]`), `envoyerWebhook`, `echouer_envoi_demande_panier` en cas d'échec (un `false` → `ok: true`, la demande a été prise), messages et logs actuels.
- Route : lit le corps JSON **optionnel** `{ ancre?: string }`.
  - Absent ou vide → `ancreParDefaut(aujourdhuiParis(), jour_courses)`, comme aujourd'hui.
  - Présent → `estDateISO(ancre)`, sinon 400 « Cycle invalide. », sans aucune RPC.
  - Puis `creerEtEnvoyerDemande`. Statuts et corps de réponse inchangés.
  - Le commentaire d'en-tête « aucun corps lu » devient faux : le réécrire.
- Client : `lancerDemandePanier(ancre: string, options?)` envoie `{ ancre }` en JSON ; `chargerEtatPanier(ancre: string | null, supabase?)` appelle `rpc("etat_panier", { p_ancre: ancre })`.

- [ ] **Step 1 : tests qui échouent.**
  - `lib/panier-demande.test.ts` : migrer depuis `route.test.ts` les cas propres à la création/l'envoi (OMQ01, OMQ02, nouveau OMQ04 → 409 avec son message, erreur inconnue → 500, data vide → 500, webhook en échec → fermeture puis 502, fermeture `false` → ok, fermeture en erreur → 502 loggé).
  - `route.test.ts` : « corps { ancre } → creer_demande_panier reçoit cette ancre », « sans corps → ancre du cycle courant (semaine et week-end) », « ancre mal formée → 400 sans RPC », et garder 401, 429 et le 500 « jour de courses illisible ».
  - `panier-client.test.ts` : POST avec corps `{ ancre }`, et `chargerEtatPanier("2026-11-05")` → `p_ancre`.
- [ ] **Step 2 : constater l'échec.** Run : `npx vitest run lib/panier-demande.test.ts app/api/panier/demande/route.test.ts lib/panier-client.test.ts` → FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vérifier.** Run : `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS. Les appelants de `lancerDemandePanier` / `chargerEtatPanier` (la carte) peuvent ne plus compiler. Corrige-les a minima : passer l'ancre affichée existante. L'UI complète arrive en Task 4.
- [ ] **Step 5 : commit.** `feat: demande de panier sur le cycle affiché (#320, RG-81)`

### Task 3 : MCP (`lancer_demande_panier`, `cocher_article(ancre)`) et skill de l'exécuteur

**Files:**
- Modify: `lib/mcp/panier.ts`, `lib/mcp/ecriture-courses.ts`, `lib/mcp/serveur.ts`, `integrations/chronodrive-mcp/hermes/skills/omq/panier-chronodrive/SKILL.md`
- Test: `lib/mcp/panier.test.ts`, `lib/mcp/ecriture-courses.test.ts`, `app/api/mcp/route.test.ts`

**Interfaces:**
- `export async function lancerDemandePanierMcp(supabase: ClientSupabase, userId: string, args: { ancre?: string }, aujourdhui: Date): Promise<{ demande_id: string; ancre: string }>` dans `lib/mcp/panier.ts` :
  - quota `limitePanier(userId)`, sinon `ErreurOutil` avec le message 429 de la route ;
  - `ancre` résolue par `ancreDemandee` si présente, sinon `ancreParDefaut(aujourdhui, chargerJourCoursesFoyer(...))` ;
  - puis `creerEtEnvoyerDemande` (Task 2). `ok: false` → `ErreurOutil(message)`. Pour 502, le message dit que l'exécuteur n'a pas répondu et qu'on peut réessayer plus tard.
  - Renvoie l'ancre de cycle effectivement visée.
- Outil `lancer_demande_panier` dans `enregistrerOutilsEcriture`, schéma `{ ancre?: string }`. Description : « Lance le remplissage du panier Chronodrive pour le cycle en cours, ou celui qui contient `ancre` (AAAA-MM-JJ, cycle en cours ou à venir), exactement comme le bouton « Remplir mon panier » de l'app : l'exécuteur du foyer est réveillé et remplit le panier de son côté ; le compte-rendu arrive sur sa messagerie et sur /courses. N'appelle cet outil qu'après l'accord explicite de l'utilisateur. Refusé si une demande est déjà en cours, si le cycle est terminé ou si aucun exécuteur n'est enregistré. »
- `cocherArticle(supabase, args: { libelle; coche?; quantite?; ancre?: string }, aujourdhui)` : avec `ancre`, `chargerListeCoursesCycle(supabase, { ancre: await ancreDemandee(...) })`. Le schéma de `cocher_article` gagne `ancre` ; sa description dit « du cycle en cours, ou de celui qui contient `ancre` ».
- Description de `prendre_demande_panier` : remplacer « c'est le cycle en cours, celui que lit lire_liste_courses » par « passe-la en `ancre` à lire_liste_courses et à cocher_article ».
- `route.test.ts` : `tools/list` gagne `lancer_demande_panier` (titre : 8 écritures).
- Skill (`SKILL.md`) :
  - tableau des outils : `lire_liste_courses` avec `ancre` = `demande.ancre` ; `cocher_article` avec `libelle`, `quantite` et `ancre` ;
  - étape 2 : « Appelle `lire_liste_courses` avec `ancre` = `demande.ancre` » ; le contrôle « le cycle a changé » reste (ancre hors `cycle.du`…`cycle.au`) ;
  - étape 5 : `cocher_article` reçoit toujours `ancre` = `demande.ancre` ;
  - interdiction d'appeler `lancer_demande_panier` pendant un run ;
  - le mode mesure reste sans ancre.

- [ ] **Step 1 : tests qui échouent.**
  - `panier.test.ts` : « lancer : ancre résolue par ancreDemandee puis creerEtEnvoyerDemande », « lancer sans ancre → cycle courant », « lancer : OMQ02 → ErreurOutil (message demande active) », « lancer : OMQ04 → ErreurOutil (cycle terminé) », « lancer : quota épuisé → ErreurOutil sans RPC ».
  - `ecriture-courses.test.ts` : « cocher_article avec ancre → coche dans ce cycle, même libellé présent dans le cycle courant non touché » (Review Focus 3).
  - `route.test.ts` : liste des outils et transmission des arguments de `lancer_demande_panier`.
- [ ] **Step 2 : constater l'échec.** Run : `npx vitest run lib/mcp app/api/mcp` → FAIL.
- [ ] **Step 3 : implémenter**, skill comprise.
- [ ] **Step 4 : vérifier.** Run : `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5 : commit.** `feat: lancer_demande_panier et cocher_article par cycle ; skill de l'exécuteur (#320, RG-85)`

### Task 4 : carte « Panier Chronodrive » (cycle affiché, cycle terminé, libellés, logo)

**Files:**
- Create: `components/ui/logo-chronodrive.tsx` (SVG inline, à partir de `.superpowers/sdd/assets-pr4c/chronodrive-app.svg`, symbole 40×40 monochrome : `var(--icon-color)` remplacé par `currentColor`)
- Modify: `lib/panier-affichage.ts`, `components/courses/panier-chronodrive.tsx`, `app/courses/page.tsx`
- Test: `lib/panier-affichage.test.ts`, `components/courses/panier-chronodrive.test.tsx`

**Interfaces:**
- `affichagePanier(etat: EtatPanier, cycle: { ancre: string; termine: boolean }, aDesCoches: boolean): AffichagePanier` :
  - `!executeur` → invisible ; sinon **toujours visible** ;
  - `actif = etat.active !== null` (tout cycle) ; `lanceA` vient de `etat.active` ;
  - `echec` et `rapport` viennent de `etat.derniere` (déjà filtrée sur le cycle par la RPC), avec les mêmes règles qu'aujourd'hui ;
  - `bouton: "remplir" | "completer"` : `"completer"` si `derniere?.statut === "terminee" && aDesCoches` ;
  - `motifIndisponible: string | null` = `MESSAGES_PANIER.OMQ04` si `cycle.termine`, sinon `null`.
  - Supprimer `boutonDisponible` / `relance` s'ils ne servent plus.
- Composant `PanierChronodrive({ ancreAffichee, longueur, aDesCoches })` :
  - `termine = cycleTermine(ancreAffichee, longueur, aujourdhuiParis())` ;
  - `chargerEtatPanier(ancreAffichee)`, relu quand `ancreAffichee` change (une réponse d'un ancien cycle est ignorée, comme le garde de lecture existant) ;
  - bouton toujours rendu, `aria-disabled` (jamais `disabled`) si `actif`, si l'envoi est en cours ou si `motifIndisponible`. Le motif s'affiche sous le bouton en texte lisible (pas un toast) ;
  - libellés de Global Constraints ; `lancerDemandePanier(ancreAffichee)`.
- Titre : `<LogoChronodrive>` (hérite de la couleur du texte, `aria-hidden`) à la place de `ShoppingBasket`, texte « Panier Chronodrive » inchangé. Mettre à jour la liste des icônes de `.claude/rules/ui.md`.
- Page : `{cycle && <PanierChronodrive ancreAffichee={cycle.ancre} longueur={cycle.longueur} aDesCoches={liste !== null && aDesCoches(liste, coches)} />}` ; réécrire le commentaire de montage.

- [ ] **Step 1 : tests qui échouent.**
  - `panier-affichage.test.ts` : réécrire les cas du modèle « courant seulement » selon le nouveau contrat, et ajouter :
    - « cycle terminé → visible, motif OMQ04, rapport du cycle conservé » ;
    - « cycle à venir sans demande → bouton remplir » ;
    - « demande active d'un autre cycle → actif, pas de rapport de l'autre cycle » (Review Focus 2) ;
    - « terminee + aDesCoches → completer ; terminee sans coche → remplir » (Review Focus 5).
  - `panier-chronodrive.test.tsx` : libellés « Remplir mon panier » / « Compléter mon panier » ; cycle terminé → bouton `aria-disabled` + motif, clic sans effet ; changement d'`ancreAffichee` → `chargerEtatPanier` rappelé avec la nouvelle ancre ; clic → `lancerDemandePanier(ancreAffichee)` ; logo présent (`aria-hidden`), titre « Panier Chronodrive ».
- [ ] **Step 2 : constater l'échec.** Run : `npx vitest run lib/panier-affichage.test.ts components/courses/panier-chronodrive.test.tsx` → FAIL.
- [ ] **Step 3 : implémenter.** Suivre `.claude/rules/ui.md` (tokens, dark mode, contraste ≥ 4.5:1, mobile-first).
- [ ] **Step 4 : vérifier.** Run : `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5 : commit.** `feat: carte panier sur le cycle affiché, cycle terminé grisé, libellés et logo (#320, RG-81, RG-84)`

### Task 5 : e2e, règles et changelog

**Files:**
- Modify: `e2e/panier-demande.spec.ts`, `.claude/rules/chronodrive.md`, `.claude/rules/courses-cycle.md`, `.claude/rules/mcp.md`, `.claude/rules/e2e.md`, `.claude/rules/supabase.md`, `CHANGELOG.md`

- [ ] **Step 1 : e2e** (`panier-demande.spec.ts`, mêmes helpers, récepteur local et comptes jetables) :
  - adapter les libellés (« Remplir mon panier ») et le test « cycle suivant → lecture seule », devenu « cycle suivant → bouton actif, clic → demande créée avec l'ancre de ce cycle, webhook reçu » ;
  - « cycle passé → bouton grisé, motif affiché » ;
  - « route : POST { ancre d'un cycle terminé } → 409 OMQ04, aucun webhook » (Review Focus 1) ;
  - « etat_panier(p_ancre) : la demande d'un cycle n'apparaît pas sur un autre » ;
  - si les helpers OAuth (`e2e/oauth.ts`) s'y prêtent sans nouveau compte : « lancer_demande_panier(ancre du cycle suivant) → webhook reçu, demande en_attente sur ce cycle » ; sinon, dans `e2e/mcp-ecriture.spec.ts`, « lancer_demande_panier sans exécuteur → isError (OMQ01) ».
  - Ne pas lancer l'e2e (le contrôleur la lance contre staging, migration appliquée).
- [ ] **Step 2 : règles.** Chaque fichier : une règle puis son « Pourquoi », sans date ni numéro de PR. Corriger ce qui devient faux :
  - `chronodrive.md` : « la route ne lit aucun corps » ;
  - `courses-cycle.md` : « bouton sur le cycle courant seulement », « Relancer pour les articles restants », « carte absente sur un autre cycle » ;
  - `e2e.md` : « `deplacerDemandePanier`, seul moyen d'avoir la demande d'un autre cycle » ;
  - `mcp.md` : outils de panier, `lancer_demande_panier`, `cocher_article(ancre)` ;
  - `supabase.md` : code `OMQ04`, miroir SQL/TS de `cycleTermine`, `etat_panier(p_ancre)`.
- [ ] **Step 3 : changelog.** `[Unreleased]` / « Modifié » : « Panier Chronodrive : le bouton remplit le panier du cycle affiché (en cours ou à venir), il est grisé sur un cycle terminé, s’intitule « Remplir mon panier » ou « Compléter mon panier », et la carte porte le logo Chronodrive (#320). » ; « Ajouté » : « Assistant connecté (MCP) : lancer le remplissage du panier d’un cycle, cocher un article dans un cycle précis (#320). »
- [ ] **Step 4 : vérifier.** Run : `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5 : commit.** `test: e2e du panier multi-cycle ; règles et changelog (#320)`

---

## Après le plan (contrôleur)

1. Revue finale de la branche, puis correction de **tous** les constats, mineurs compris.
2. Appliquer la migration sur **staging** (`supabase.md` : script Node → API de management, puis inscription dans `schema_migrations`). Puis lancer l'e2e staging : `npm run test:e2e:staging -- e2e/panier-demande.spec.ts e2e/mcp-ecriture.spec.ts e2e/courses.spec.ts --retries=2`.
3. `graphify update .`, push, PR `Refs #320`, merge sur CI verte (`migrate-prod` applique la migration).
4. Après le merge, copier la skill mise à jour sur le NAS (sauvegarde d'abord, sans redémarrer la gateway), et vérifier que la skill du conteneur est bien la nouvelle.
