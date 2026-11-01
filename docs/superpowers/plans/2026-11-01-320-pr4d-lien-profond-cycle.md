# Lien profond vers un cycle (PR4d de #320) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/planning?cycle=AAAA-MM-JJ` ouvre la vue Cycle sur le cycle qui contient cette date, une seule fois, sans toucher la vue préférée, et survit à la connexion.

**Architecture:** La page `/planning` lit `cycle` une fois au montage (`lireLienCycle`), force la vue Cycle pour cette visite (état local, jamais `storeVuePlanning`) et retire le paramètre par `router.replace`. `VuePlanningCycle` reçoit la date (`lienCycle`) et la résout en ancre par `resoudreAncreCycle` (`lib/ancre-cycle.ts`, déjà partagé route/MCP) au lieu de l'ancre par défaut. Le proxy pose `suivant` pour ce lien quand il n'y a pas de session, comme pour `/oauth`.

**Tech Stack:** Next.js 16 App Router (`useSearchParams`, `useRouter`, `Suspense`), Supabase, Vitest, Playwright.

**Spec:** `SPECS_FONCTIONNELLES.md` RG-87 (et RG-85 pour la résolution d'une date en cycle). Décisions du grilling #320 (2026-11-01) : Q21 lien profond fait maintenant ; Q22 paramètre `cycle`, retiré après lecture par `router.replace`, vue préférée non écrasée, date invalide ignorée.

## Global Constraints

- Paramètre : `cycle`, format `AAAA-MM-JJ` (`estDateISO`), sur `/planning` uniquement.
- Une date de format invalide est ignorée **sans message** : comportement normal de `/planning` (vue préférée).
- Le paramètre est retiré de l'URL une fois lu, qu'il soit valide ou non (`router.replace("/planning", { scroll: false })`) : un rechargement ou un retour revient au comportement normal.
- La vue préférée enregistrée (`storeVuePlanning`, clé localStorage `vue_planning`) n'est **jamais** écrite par le lien. Seul un clic sur la bascule Semaine/Cycle l'écrit (choix explicite, comportement existant).
- Résolution date → ancre : `resoudreAncreCycle(clientParDefaut(), date, aujourdhuiParis())`, jamais une réimplémentation (règle du jumeau, cf. `mcp.md`).
- Sans session : `/login?suivant=/planning?cycle=…`, filtré par `cheminDeRetour` (anti open-redirect, inchangé).
- Langue : identifiants, commentaires, messages en français ; commentaires citent RG-87 / #320. Apostrophe typographique `’` dans le JSX texte.
- `CHANGELOG.md` `[Unreleased]` et `.claude/rules/` mis à jour dans la PR (critère de merge).

## Rulings (décisions prises au plan)

- **Date bien formée mais hors plage (−12/+6 semaines) ou lecture du foyer en échec** : la vue Cycle s’ouvre sur le cycle par défaut (le lien a bien demandé la vue Cycle). Hors plage : silencieux ; lecture en échec : `console.error` (règle « toute erreur capturée est loggée »). Coût si faux : un lien périmé montre le cycle courant au lieu de la vue préférée.
- **`suivant` limité à `/planning` avec `cycle`** (plus `/oauth`, existant) ; les autres routes protégées gardent le retour par défaut. Coût si faux : aucun, élargissement possible plus tard.
- **Utilisateur non onboardé** : le proxy l’envoie sur `/bienvenue`, le lien est perdu. Hors périmètre (cas impossible pour le foyer qui reçoit le lien).

## Review Focus

1. Lien vers un cycle à venir encore vide : la vue Cycle de ce cycle s’affiche avec son état vide et « Générer mon cycle », pas le cycle courant. → e2e Task 3 (cycle suivant, compte partagé sans planning futur garanti : on vérifie le libellé du cycle, pas les repas).
2. Rechargement après lecture : vue préférée (Semaine par défaut), plus de paramètre. → e2e Task 3.
3. Clic sur « Semaine » après le lien, puis retour sur « Cycle » : la vue Cycle reprend le cycle par défaut (le lien ne se réapplique pas), et la préférence enregistrée est celle du dernier clic. → test composant/page Task 2 si faisable, sinon e2e Task 3.
4. Date dans le trou d’un cycle raccourci : cycle suivant. Déjà couvert par `lib/ancre-cycle.test.ts` (résolveur partagé) ; aucune réimplémentation à tester.
5. Lien ouvert sans session : la connexion ramène sur `/planning?cycle=…` et la vue Cycle s’ouvre. → `proxy.test.ts` (Task 1) + e2e Task 3.

---

### Task 1 : lecture du paramètre et retour après connexion

**Files:**
- Create: `lib/lien-cycle.ts`, `lib/lien-cycle.test.ts`
- Modify: `proxy.ts` (bloc `isProtectedRoute && !user`, ~l. 90-97), `proxy.test.ts`

**Interfaces:**
- Produces:
  - `export const PARAM_LIEN_CYCLE = "cycle"`
  - `export function lireLienCycle(valeur: string | null): string | null` : la valeur si `estDateISO`, sinon `null`.
  - `export function estLienProfondCycle(pathname: string, params: URLSearchParams): boolean` : `pathname === "/planning"` et `params.has("cycle")` (même si la date est invalide : la page l’ignorera).

- [ ] **Step 1 : tests qui échouent** (`lib/lien-cycle.test.ts`)
  - `lireLienCycle("2026-11-09")` → `"2026-11-09"` ; `lireLienCycle(null)`, `""`, `"2026-13-01"`, `"2026-02-30"`, `"9/11/2026"`, `"2026-11-09T00:00"` → `null`.
  - `estLienProfondCycle("/planning", new URLSearchParams("cycle=2026-11-09"))` → `true` ; `("/planning", "cycle=abc")` → `true` ; `("/planning", "")` → `false` ; `("/courses", "cycle=2026-11-09")` → `false` ; `("/planningx", "cycle=2026-11-09")` → `false`.
  - `proxy.test.ts` : « /planning?cycle=… non connecté → /login?suivant=/planning?cycle=2026-11-09 » (même forme que le test `/oauth` existant, `cible.searchParams.get("suivant")` vaut `"/planning?cycle=2026-11-09"`) ; « /planning sans cycle non connecté → /login sans suivant » ; « /courses non connecté → /login sans suivant ».
- [ ] **Step 2 :** `npx vitest run lib/lien-cycle.test.ts proxy.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter `lib/lien-cycle.ts` ; dans `proxy.ts`, poser `suivant` si `estCheminOAuth(pathname) || estLienProfondCycle(pathname, request.nextUrl.searchParams)`, commentaire mis à jour (RG-87).
- [ ] **Step 4 :** `npx vitest run lib/lien-cycle.test.ts proxy.test.ts lib/redirection.test.ts components/auth/formulaire-auth.test.tsx` → PASS.
- [ ] **Step 5 : commit** `feat: lien profond /planning?cycle= : lecture et retour après connexion (#320, RG-87)`

### Task 2 : la page ouvre la vue Cycle sur le cycle du lien

**Files:**
- Modify: `app/planning/page.tsx` (vue `vue`/`setVue` ~l. 330-337, rendu vue Cycle ~l. 720-735, export par défaut ~l. 273), `components/planning/vue-cycle.tsx` (props ~l. 124-130, montage ~l. 497-509)
- Modify: `.claude/rules/courses-cycle.md` (section vue Cycle), `CHANGELOG.md`

**Interfaces:**
- Consumes: `lireLienCycle`, `PARAM_LIEN_CYCLE` (Task 1) ; `resoudreAncreCycle(supabase, date, aujourdhui): Promise<{ ok: true; ancre } | { ok: false; motif }>` (`lib/ancre-cycle.ts`) ; `clientParDefaut()` (`lib/supabase/par-defaut.ts`) ; `aujourdhuiParis()` (`lib/semaines.ts`).
- Produces: `VuePlanningCycle({ idsModifiables, lienCycle }: { idsModifiables: ReadonlySet<string>; lienCycle?: string })`.

- [ ] **Step 1 : `VuePlanningCycle` accepte `lienCycle`.** Au montage, si `lienCycle` est fourni : `resoudreAncreCycle(clientParDefaut(), lienCycle, aujourdhuiParis())` ; `ok` → `chargerCycle(ancre)` ; `hors_plage`/`invalide` → ancre par défaut (silencieux) ; exception → `console.error` puis ancre par défaut. Sans `lienCycle` : comportement actuel inchangé (`chargerJourCoursesFoyer` → `ancreParDefaut`). Un seul chargement initial (pas de cycle par défaut affiché puis remplacé).
- [ ] **Step 2 : la page lit le lien une fois.** `useSearchParams().get(PARAM_LIEN_CYCLE)` lu dans un `useState` initialisé une seule fois (`lienCycle = lireLienCycle(brut)`) et un état `lienActif` (vrai si `lienCycle !== null`). Effet de montage : si le paramètre brut est présent (même invalide), `router.replace("/planning", { scroll: false })`. `vue` affichée = `"cycle"` si `lienActif`, sinon la vue enregistrée. `setVue(v)` écrit `storeVuePlanning` (inchangé) **et** passe `lienActif` à faux. Rendu Cycle : `<VuePlanningCycle idsModifiables={…} lienCycle={lienActif ? lienCycle ?? undefined : undefined} />`.
- [ ] **Step 3 : frontière `Suspense`** exigée par `useSearchParams` (Next 16) : extraire le contenu actuel de `PagePlanning` dans un composant interne et l’envelopper, même motif que `app/courses/page.tsx` (~l. 836) et `app/recettes/page.tsx`, avec le même fallback que l’état de chargement existant de la page.
- [ ] **Step 4 : vérifier.** `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → PASS. (Le comportement d’écran est vérifié en e2e, Task 3 ; aucun test de composant n’existe pour `/planning`.)
- [ ] **Step 5 : règles et changelog.**
  - `courses-cycle.md` : une règle « `/planning?cycle=AAAA-MM-JJ` (RG-87) : lu une fois, vue Cycle forcée pour la visite sans écrire `storeVuePlanning`, paramètre retiré par `router.replace`, date résolue par `resoudreAncreCycle` ; un clic sur la bascule écrit la préférence et désactive le lien » + Pourquoi (le lien ne doit pas changer la vue de tous les jours ; une seule résolution pour la route, le MCP et le lien).
  - `CHANGELOG.md` `[Unreleased]` / « Ajouté » : « Lien vers un cycle : `/planning?cycle=AAAA-MM-JJ` ouvre la vue Cycle sur ce cycle, sans changer ta vue préférée, y compris après connexion (#320). »
- [ ] **Step 6 : commit** `feat: /planning?cycle= ouvre la vue Cycle sur ce cycle (#320, RG-87)`

### Task 3 : e2e du lien profond

**Files:**
- Create: `e2e/lien-cycle.spec.ts` (projet `e2e-partage` : ne pas l’ajouter à `SPECS_JETABLE`, aucune écriture en base)
- Modify: `.claude/rules/e2e.md` (une ligne)

**Interfaces:**
- Consumes: `ancreParDefaut`, `cycleDecale`, `libelleCycle` (`lib/cycles.ts`) ; jour de courses du compte partagé = lundi (`reinitialiserJourCoursesDistant` dans `beforeAll`) ; `remplirLogin` (`e2e/oauth.ts`) pour la connexion d’un contexte vierge.

- [ ] **Step 1 : tests**
  - « lien vers le cycle suivant → vue Cycle sur ce cycle, URL nettoyée, vue préférée intacte » : `localStorage.vue_planning` posé à `"semaine"` (init script avant la navigation), `goto(/planning?cycle=<suivant + 2 jours>)` où `suivant = cycleDecale(ancreParDefaut(new Date(), 1), 1)` ; attendre `toHaveURL(/\/planning$/)` ; le libellé `libelleCycle(suivant, 7)` est visible ; le bouton de bascule « Cycle » a `aria-pressed="true"` ; `localStorage.vue_planning` vaut toujours `"semaine"`.
  - « rechargement → vue préférée » (suite du précédent ou test séparé) : `page.reload()` → bascule « Semaine » `aria-pressed="true"`.
  - « date invalide → ignorée sans message » : `goto(/planning?cycle=2026-13-45)` → URL `/planning`, vue préférée (« Semaine » pressée), aucun `role="alert"` ni toast d’erreur.
  - « clic sur Semaine puis Cycle → cycle par défaut » (Review Focus 3) : après le lien, clic « Semaine » puis « Cycle » → libellé `libelleCycle(ancreParDefaut(new Date(), 1), 7)` ; `vue_planning` vaut `"cycle"`.
  - « sans session → connexion → retour sur le lien » : contexte vierge (`storageState` vide), `goto(/planning?cycle=<suivant + 2>)` → `waitForURL(/\/login\?.*suivant=/)` ; `remplirLogin` avec le compte partagé → `waitForURL(/\/planning$/)` (paramètre lu puis retiré) et libellé du cycle suivant visible. Ne pas se déconnecter (cf. `e2e.md`).
- [ ] **Step 2 :** typage et lint (`npx tsc --noEmit`, `npm run lint`). Ne pas lancer Playwright : le contrôleur lance l’e2e contre staging.
- [ ] **Step 3 : règle** `e2e.md` : « `lien-cycle.spec` (#320, RG-87) : compte partagé, lecture seule ; la vue préférée se pose par init script (`vue_planning`), et le libellé attendu se calcule avec `libelleCycle` sur le jour de courses lundi. » + Pourquoi.
- [ ] **Step 4 : commit** `test: e2e du lien profond /planning?cycle= (#320, RG-87)`

## Après le plan (contrôleur)

1. Revue finale de la branche, puis correction de **tous** les constats, mineurs compris.
2. E2E staging : `rm -rf .next/dev`, puis `npm run test:e2e:staging -- e2e/lien-cycle.spec.ts e2e/coherence-semaine-cycle.spec.ts e2e/edition-vue-cycle.spec.ts e2e/oauth-mcp.spec.ts --retries=2` (`E2E_PORT=3001` si le port 3000 est pris).
3. `graphify update .`, push, PR `Refs #320`, merge sur CI verte.
