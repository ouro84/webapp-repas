# Chantier 05 : un lecteur de cycle unique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule fonction lit la projection d'un cycle (semaines ISO touchées → plannings par semaine → planning recombiné), avec une seule sémantique d'échec, pour `/courses`, la vue Cycle et le MCP.

**Architecture:** Nouveau module `lib/lecture-cycle.ts` (client injecté, défaut `clientParDefaut()`). Il lit toutes les semaines en parallèle ; une semaine absente est ignorée, une lecture en échec fait rejeter l'ensemble (`ErreurLectureCycle`, jamais de projection partielle). Les quatre recettes dupliquées l'appellent ; chaque appelant garde sa politique de présentation (sync : propage ou journalise, vue Cycle : `false` + toast, MCP : propage).

**Tech Stack:** TypeScript, Supabase (PostgREST), Vitest + jsdom, Playwright staging.

**Spec:** auto-grill du 2026-11-06 (session autonome, chantier 05 de la revue d'architecture), décisions ci-dessous.

## Décisions (auto-grill)

- **D1 Périmètre.** Module de lecture seul. Le « store de cycle partagé » entre `/courses` et la vue Cycle est écarté : la vue Cycle a besoin d'une `Map` par semaine pour ses éditions optimistes et sa file d'écriture (#301), `/courses` d'un planning synthétique en localStorage (dirty-first, local fait foi). Les fusionner toucherait deux mécanismes de concurrence pour un gain faible ; #357 est déjà corrigé dans la vue.
- **D2 Interface.** `lireCycle({ ancre, longueur }, supabase = clientParDefaut()): Promise<CycleLu>` avec `CycleLu = { semaines: string[]; parSemaine: Map<string, Planning>; planning: Planning }`. `semaines` = `semainesDuCycle(ancre, longueur)` ; `parSemaine` ne contient que les semaines ayant une ligne ; `planning` = `planningDuCycle([...parSemaine.values()], ancre, longueur)`.
- **D3 Échec.** `Promise.allSettled` ; si au moins une lecture rejette : `throw new ErreurLectureCycle(semainesEnEchec, causes)` (`name = "ErreurLectureCycle"`, message français « Lecture du cycle échouée (semaines : …). » (amendé en revue : message lisible « Certains jours du cycle n'ont pas pu être chargés. », affiché tel quel dans les toasts ; le détail reste dans `semainesEnEchec`, `causes` et `Error.cause`, une cause ou un `AggregateError`)). Pourquoi : la vue Cycle doit savoir quelles semaines ont échoué (log par semaine) et personne ne doit afficher une projection partielle (un `.catch(() => null)` faisait disparaître la semaine minoritaire, cf. `courses-cycle.md`).
- **D4 Consommateurs migrés.** `rechargerProjectionCycle` et `chargerCycleDansCache` (`lib/sync.ts`), `chargerCycle` (`components/planning/vue-cycle.tsx`), `chargerListeCoursesCycle` (`lib/liste-courses-cycle.ts`). Le MCP `planningsAffiches` (`lib/mcp/lecture.ts`) reste : il rend une liste par semaine filtrée par les réglages, sert aussi une semaine seule, et a déjà la même sémantique (propage, semaine absente ignorée).
- **D5 Hors périmètre.** `chargerLongueurCycle` qui retombe sur 7 (#365), le store partagé (D1).
- **D6 Pas d'entrée CHANGELOG** (aucun effet visible).

## Global Constraints

- Identifiants, commentaires, messages en français ; commentaires citant `RG-xx` / `#nnn` quand ils expliquent un pourquoi existant (garder les commentaires existants des sites migrés qui restent vrais).
- Ne jamais lancer `npm run test:e2e` (prod). E2E : `npm run test:e2e:staging -- <spec> --retries=2`, une spec à la fois, au premier plan.
- Vitest : `npx vitest run --maxWorkers=2 --exclude ".claude/**" --exclude "e2e/**"`, une seule instance à la fois (machine à mémoire contrainte).
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Cycle à cheval sur 2 semaines ISO avec une semaine sans ligne : la semaine présente s'affiche, aucune erreur.
- Une des deux semaines en échec réseau : la vue Cycle garde l'état précédent + toast (rechargement) ou état erreur (premier chargement) ; `/courses` journalise sans écraser le cache ; le MCP propage.
- `chargerCycleDansCache` : « local fait foi » toujours appliqué quand le backend n'a rien pour l'ancre.
- Les tests existants qui mockent `chargerPlanningDistant` (`@/lib/persistance`) continuent de piloter les quatre consommateurs à travers le nouveau module.

---

### Task 1: module `lib/lecture-cycle.ts`

**Files:**
- Create: `lib/lecture-cycle.ts`, `lib/lecture-cycle.test.ts`

**Interfaces:**
- Produces: `lireCycle`, `CycleLu`, `ErreurLectureCycle` (`semainesEnEchec: string[]`, `causes: unknown[]`).

- [ ] **Step 1: Tests qui échouent** (`lib/lecture-cycle.test.ts`, `vi.mock("@/lib/persistance")` sur `chargerPlanningDistant`) :
  - cycle `ancre = "2026-11-06"` (vendredi), `longueur = 7` → `semaines` = `["2026-W45", "2026-W46"]`, `chargerPlanningDistant` appelé pour chacune avec le client passé ; `planning.semaine === "2026-11-06"` et `planning.jours` = jours du cycle présents dans les deux plannings fournis ;
  - semaine `2026-W46` sans ligne (`null`) → `parSemaine` n'a que `2026-W45`, pas d'erreur ;
  - `2026-W46` rejette → `lireCycle` rejette une `ErreurLectureCycle` dont `semainesEnEchec` = `["2026-W46"]` et `causes[0]` = l'erreur d'origine ;
  - les deux rejettent → `semainesEnEchec` contient les deux, dans l'ordre du cycle.
- [ ] **Step 2:** `npx vitest run lib/lecture-cycle.test.ts` → échec (module absent).
- [ ] **Step 3:** Implémenter selon D2/D3.
- [ ] **Step 4:** `npx vitest run lib/lecture-cycle.test.ts` → vert.
- [ ] **Step 5:** Commit `feat: lecteur de cycle unique lireCycle (chantier 05)`.

### Task 2: bascule des quatre lecteurs

**Files:**
- Modify: `lib/sync.ts` (`rechargerProjectionCycle`, `chargerCycleDansCache`), `components/planning/vue-cycle.tsx` (`chargerCycle`), `lib/liste-courses-cycle.ts` (`chargerListeCoursesCycle`)
- Doc: `.claude/rules/courses-cycle.md` (puce « Projection propre » de la vue Cycle et section stores : la lecture passe par `lireCycle`, une seule sémantique d'échec ; nouvelle puce courte dans « Cycle de courses = projection » : « Toute lecture de la projection d'un cycle passe par `lireCycle` (`lib/lecture-cycle.ts`) … Pourquoi : quatre copies divergeaient sur l'échec »).
- Test: `lib/sync.test.ts`, `tests/vue-cycle-erreur.test.tsx`, `lib/liste-courses-cycle.test.ts` (existants, doivent rester verts sans réécriture de fond ; ajuster seulement un mock d'import si nécessaire).

**Interfaces:**
- Consumes: `lireCycle`, `ErreurLectureCycle` (Task 1).

- [ ] **Step 1: Test qui échoue** dans `tests/vue-cycle-erreur.test.tsx` : au rechargement, une semaine en échec sur deux journalise `console.error` avec la semaine en échec (comportement actuel conservé), puis toast `ID_TOAST_ECHEC_CYCLE` ; si ce test existe déjà sous une autre forme, le noter et passer.
- [ ] **Step 2:** Basculer les quatre sites :
  - `rechargerProjectionCycle` : `definirCyclePlanning((await lireCycle({ ancre, longueur })).planning)` (propage, comme avant) ;
  - `chargerCycleDansCache` : `projete = (await lireCycle(...)).planning`, reste inchangé (le `try/catch` existant journalise) ;
  - `chargerCycle` (vue) : garder `chargerLongueurCycle(...).catch(() => LONGUEUR_DEFAUT)` ; `lireCycle({ ancre: ancreCible, longueur: long })` dans un `try` ; sur `ErreurLectureCycle`, `console.error` par semaine en échec (même message qu'aujourd'hui : « Chargement du planning de la semaine ${s} échoué. »), puis toast si `!initial`, `return false` ; succès : `setParSemaine(lu.parSemaine)` ; supprimer la reconstruction locale de la liste des semaines (et les imports devenus inutiles) ;
  - `chargerListeCoursesCycle` : `const { planning } = await lireCycle({ ancre, longueur }, supabase)`.
- [ ] **Step 3:** `npx vitest run --maxWorkers=2 --exclude ".claude/**" --exclude "e2e/**"` vert ; `npx tsc --noEmit -p .` ; `npx eslint lib app components`.
- [ ] **Step 4:** E2E staging, une spec à la fois, `--retries=2` : `cycle-courses`, `edition-vue-cycle`, `coherence-semaine-cycle`, `courses`.
- [ ] **Step 5:** Règle `courses-cycle.md` ; commit `refactor: les lecteurs de cycle passent par lireCycle (chantier 05)` ; `graphify update .`.
