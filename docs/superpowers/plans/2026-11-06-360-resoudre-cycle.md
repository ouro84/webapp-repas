# Résolveur de cycle visé (#360) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule décision « quel cycle ? » pour les outils MCP, la route du panier, l'exécuteur et le lien profond de la vue Cycle, toujours en lecture stricte du jour de courses.

**Architecture:** `lib/ancre-cycle.ts` devient un module profond, `resoudreCycle`. Il renvoie le cycle complet (ancre, longueur, jours, semaines, du, au), ou un refus métier typé. Une lecture du foyer en échec lève. Côté MCP, un adaptateur `cycleVise` (`lib/mcp/cycle.ts`) traduit le refus en `ErreurOutil`. `chargerListeCoursesCycle` et `cocherArticleDansCycle` reçoivent un cycle déjà résolu : le repli « lundi » disparaît par construction.

**Tech Stack:** Next.js 16, Supabase, Vitest (`tests/fixtures/supabase-mock`), Playwright staging.

**Spec:** issue #360 ; revue d'architecture 2026-11-06 (candidat 01) ; décisions d'auto-grill Q1 à Q9 (session) ; `.claude/rules/mcp.md:38-39,57`.

## Global Constraints

- Français partout ; commentaires citant RG-85 / RG-83.
- Plage −12 / +6 semaines (`semaineDansPlage`) ; une date dans le trou d'un cycle raccourci désigne le cycle suivant (`cycleDecale(resolue, 1)`).
- Jour de courses : **toujours** `chargerJourCoursesStrict` dans le module. `chargerJourCoursesFoyer` ne reste utilisé que par les pages client (`/courses`, `/planning`, vue Cycle via `jourCoursesOuLundi`), hors périmètre.
- Messages MCP inchangés : `CYCLE_HORS_PLAGE`, `MESSAGE_DATE_INVALIDE` (via `validerDate`).
- Route panier : 400 « Cycle invalide. » pour un refus, 500 générique si la lecture lève (inchangé).

## Review Focus

- Outil MCP **sans** `ancre` quand `foyers` renvoie une erreur → l'outil lève (`Error`, masquée par `executer`), aucune écriture ni RPC. Concerne `lire_planning`, `lire_liste_courses`, `generer_cycle`, `ajouter_article_courses`, `cocher_article`.
- Date dans le trou d'un cycle raccourci : `cycle.longueur` est celle du cycle **suivant** (relue après décalage), pas celle du cycle d'origine.
- Exécuteur : jour de courses changé entre demande et prise → `echec` « cycle changé » (inchangé).
- Lien profond vue Cycle : refus ou lecture en échec → ancre par défaut (inchangé).
- `cocher_article_demande` coche toujours `demande.ancre` sans re-résolution.

---

### Task 1: module `resoudreCycle`

**Files:**
- Modify: `lib/ancre-cycle.ts`
- Test: `lib/ancre-cycle.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CycleResolu = { ancre: string; longueur: number; jours: string[]; semaines: string[]; du: string; au: string }
  export type ResolutionCycle = { ok: true; cycle: CycleResolu } | { ok: false; motif: "invalide" | "hors_plage" }
  export async function resoudreCycle(supabase: ClientSupabase, demande: { date?: string }, aujourdhui: Date): Promise<ResolutionCycle>
  ```
  `resoudreAncreCycle` reste exportée jusqu'à la Task 3 (implémentée par délégation : `r.ok ? { ok: true, ancre: r.cycle.ancre } : r`).

- [ ] **Step 1:** Réécrire les tests existants contre `resoudreCycle({ date })` (mêmes attentes sur `cycle.ancre`), et ajouter :
  - sans date, jeudi 29/10/2026, foyer jeudi → `ancre` 2026-10-29, `longueur` 7, `jours` 29/10→04/11, `semaines` `["2026-W44","2026-W45"]`, `du`/`au` cohérents ;
  - sans date, foyer en erreur (`foyers: { data: null, error: { message: "x" } }`) → rejette ; foyer absent (`data: null`) → rejette ;
  - avec date, foyer en erreur → rejette ;
  - trou d'un cycle raccourci (29/10 de longueur 5, date 03/11) → `ancre` 2026-11-05 et `longueur` lue pour le 05/11 (7 dans le mock) ;
  - `invalide` sans aucune lecture (existant).
- [ ] **Step 2:** `npx vitest run lib/ancre-cycle.test.ts` → échec.
- [ ] **Step 3:** Implémenter (lecture stricte, une lecture de longueur, une seconde seulement après décalage).
- [ ] **Step 4:** Test vert.
- [ ] **Step 5:** Commit `refactor: resoudreCycle, résolution stricte et cycle complet (#360)`.

### Task 2: outils MCP et exécuteur sur `cycleVise`

**Files:**
- Create: `lib/mcp/cycle.ts` (`CYCLE_HORS_PLAGE` déplacé depuis `lecture.ts`, `cycleVise`)
- Modify: `lib/mcp/lecture.ts` (supprimer `ancreDemandee`, `CYCLE_HORS_PLAGE`, `depuisISO` local → `lib/cycles` `depuisISO`), `lib/mcp/ecriture-planning.ts`, `lib/mcp/ecriture-courses.ts` (supprimer la recomposition, `cocherArticle` résout puis délègue), `lib/mcp/panier.ts`, `lib/mcp/executeur.ts`, `lib/liste-courses-cycle.ts`
- Test: `lib/mcp/{lecture,ecriture-planning,ecriture-courses,panier,executeur}.test.ts`, `lib/liste-courses-cycle.test.ts`

**Interfaces:**
- Consumes: `resoudreCycle`, `CycleResolu` (Task 1).
- Produces:
  ```ts
  // lib/mcp/cycle.ts
  export const CYCLE_HORS_PLAGE: string
  export async function cycleVise(supabase: ClientSupabase, ancre: string | undefined, aujourdhui: Date): Promise<CycleResolu>
  // invalide → ErreurOutil(MESSAGE_DATE_INVALIDE via validerDate) ; hors_plage → ErreurOutil(CYCLE_HORS_PLAGE)
  // lib/liste-courses-cycle.ts
  export async function chargerListeCoursesCycle(supabase: ClientSupabase, cycle: { ancre: string; longueur: number }): Promise<ListeCoursesCycle>
  // lib/mcp/ecriture-courses.ts
  export async function cocherArticleDansCycle(supabase: ClientSupabase, args: { libelle: string; coche?: boolean; quantite?: string }, cycle: { ancre: string; longueur: number }): Promise<CochageMcp>
  ```
  L'exécuteur : `preparerPrise` compare `resoudreCycle(..., { date: demande.ancre })` à `demande.ancre`, puis passe `resolution.cycle` à `chargerListeCoursesCycle` ; `cocher_article_demande` lit `chargerLongueurCycle(demande.ancre)` et passe `{ ancre, longueur }`.

- [ ] **Step 1:** Adapter les tests aux nouvelles signatures et ajouter la non-régression « foyer illisible sans `ancre` » pour `lirePlanning`, `lireListeCourses`, `genererCycle`, `ajouterArticleCourses`, `cocherArticle` : la promesse rejette, ce n'est **pas** une `ErreurOutil`, et le mock n'enregistre ni RPC ni écriture (`insert`/`upsert`).
- [ ] **Step 2:** `npx vitest run lib/mcp lib/liste-courses-cycle.test.ts` → échecs attendus.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npx vitest run lib/mcp lib/liste-courses-cycle.test.ts lib/ancre-cycle.test.ts` vert ; `npx tsc --noEmit` vert.
- [ ] **Step 5:** Commit `fix: outils MCP sans ancre en lecture stricte du jour de courses (#360)`.

### Task 3: route panier, lien profond, suppression de `resoudreAncreCycle`, docs

**Files:**
- Modify: `app/api/panier/demande/route.ts`, `lib/ancre-initiale-cycle.ts` (`resoudreLien: (date) => Promise<ResolutionCycle>`), `components/planning/vue-cycle.tsx:570`, `lib/ancre-cycle.ts` (supprimer `resoudreAncreCycle` et `ResolutionAncre`)
- Test: `app/api/panier/demande/route.test.ts`, `tests/ancre-initiale-cycle.test.ts`, `tests/vue-cycle-erreur.test.tsx`
- Doc: `.claude/rules/mcp.md` (l. 38-39, 56-57 : `cycleVise`/`resoudreCycle`, plus de chemin tolérant côté serveur), `.claude/rules/chronodrive.md:114`, `.claude/rules/courses-cycle.md:54`, `.claude/rules/supabase.md:62` si elles nomment `resoudreAncreCycle` ; `CHANGELOG.md` `[Unreleased] > Corrigé`.

- [ ] **Step 1:** Adapter les tests (mocks `resoudreLien` au nouveau type) ; `npx vitest run` complet → échecs attendus uniquement là.
- [ ] **Step 2:** Implémenter ; `grep -rn "resoudreAncreCycle\|ancreDemandee" lib app components tests .claude` → vide.
- [ ] **Step 3:** `npm run test:run`, `npx tsc --noEmit`, `npm run lint` verts.
- [ ] **Step 4:** Entrée CHANGELOG : « Assistant (MCP) : si le jour de courses du foyer ne peut pas être lu, générer un cycle, lire le planning ou la liste, cocher ou ajouter un article échoue avec un message, au lieu de viser par erreur le cycle commençant le lundi (#360). »
- [ ] **Step 5:** E2E staging : `npm run test:e2e:staging -- e2e/mcp-ecriture.spec.ts e2e/panier-demande.spec.ts e2e/oauth-mcp.spec.ts --retries=2`.
- [ ] **Step 6:** Commit `refactor: route panier et lien profond sur resoudreCycle (#360)` ; `graphify update .`.
