# Coches : une interface pour ingrédients et articles manuels (#362, phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/courses` coche, décoche et « Tout décocher » par une seule interface de `lib/sync.ts`, sans connaître les deux moteurs (blob d'ingrédients, colonne `coche` des articles manuels), ni écrire `storeCoches`.

**Architecture:** La seam se pose à l'interface de `lib/sync.ts`, qui porte déjà les deux moteurs : `basculerCocheArticle(ingredient)` et `toutDecocher()`. La bascule d'un ingrédient lit le blob **au moment de l'appel** (`cochesLocales()`), et non l'instantané du rendu. La partie locale reste synchrone avant le premier `await` (contrainte `avecTransition`).

**Tech Stack:** Next.js 16, Vitest + jsdom (`lib/sync.test.ts`, `vi.resetModules`), Playwright staging.

**Spec:** issue #362 ; revue d'architecture 2026-11-06 (candidat 02) ; auto-grill Q1 à Q5 (session) ; `.claude/rules/courses-cycle.md`.

## Hors périmètre (phase 2, à grill-er à part)

Unifier les moteurs eux-mêmes : horodatage serveur des coches d'ingrédients (`updated_at` sur `etat_courses_article`, migration), filtre d'écho commun et primitive mono-vol commune. Cette phase recoupe #358 et demande une migration prod : pas sous auto-merge.

## Global Constraints

- Français ; commentaires citant RG-10, RG-12, RG-41.
- Comportement iso, sauf la lecture du blob au moment de l'appel.
- Erreur réseau d'un article manuel : la promesse rejette (revert déjà fait par le moteur) ; la page garde son toast.
- `toutDecocher()` : effacement du blob ET `viderCochesArticlesManuels()` ; la partie locale des deux est synchrone avant le premier `await`.

## Review Focus

- Deux bascules du même ingrédient dans la même frame (sans re-rendu) : état final = état initial (deux gestes), pas « coché ».
- `toutDecocher()` dans `avecTransition` : blob vidé et articles manuels décochés AVANT la résolution de la promesse.
- Article manuel sans `id` : no-op, pas de crash.
- Échec réseau d'un article manuel : rejet de `basculerCocheArticle` (la page affiche le toast).

---

### Task 1: interface `basculerCocheArticle` / `toutDecocher` dans `lib/sync.ts`

**Files:**
- Modify: `lib/sync.ts` (près de `basculerCocheArticleManuel`)
- Test: `lib/sync.test.ts` (nouveau `describe("basculerCocheArticle / toutDecocher — une interface (#362)")`)

**Interfaces:**
- Produces:
  ```ts
  export function basculerCocheArticle(ingredient: Ingredient): Promise<void>
  // ingrédient dérivé : storeCoches ← basculerCoche(cochesLocales(), ingredient) (lib/coches.ts), synchrone, résout tout de suite
  // article manuel (source === "manuel", id défini) : basculerCocheArticleManuel(id)
  export function toutDecocher(): Promise<void>
  // storeCoches.effacer() synchrone, puis viderCochesArticlesManuels()
  ```

- [ ] **Step 1: Tests qui échouent :**
  - `basculerCocheArticle(ing("lait", 1, "l"))` deux fois de suite sans re-rendu → `localStorage["courses_cochees"]` absent ou `{}` (état initial), et une fois → `{ "lait|l": 1 }` ;
  - article manuel `a1` (préparé comme le `preparer()` existant) → `persistance.basculerCocheArticleManuelDistant` appelé avec `("a1", true)` ;
  - `toutDecocher()` : juste après l'appel synchrone, blob vide et `useArticlesManuels()[0].coche === false`.
- [ ] **Step 2:** `npx vitest run lib/sync.test.ts -t "#362"` → échec (exports absents).
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npx vitest run lib/sync.test.ts` vert.
- [ ] **Step 5:** Commit `refactor: une interface de coche pour ingrédients et articles manuels (#362)`.

### Task 2: `/courses` sur l'interface

**Files:**
- Modify: `app/courses/page.tsx:396-436` (`basculer`, `toutDecocher`) ; imports (`storeCoches` reste importé pour la LECTURE `useSyncExternalStore`, `basculerCoche` et `basculerCocheArticleManuel` retirés s'ils ne servent plus)
- Doc: `.claude/rules/courses-cycle.md` (une entrée : « `/courses` coche par `basculerCocheArticle` / `toutDecocher` (`lib/sync.ts`), jamais en écrivant `storeCoches` ; pourquoi : deux moteurs derrière une interface, lecture du blob à l'appel »), `CHANGELOG.md` `Corrigé` : « Liste de courses : deux touches très rapides sur le même article ne s'annulent plus en une seule (#362). »

- [ ] **Step 1:** Remplacer les deux branches de `basculer` par `void basculerCocheArticle(ingredient).catch(...)` (toast « Impossible d'enregistrer cette coche. Réessaie. »), dans `avecTransition` ; `toutDecocher` appelle `toutDecocher()` de sync (importé sous l'alias `toutDecocherCoches` pour éviter l'homonymie avec la fonction locale).
- [ ] **Step 2:** `npx tsc --noEmit`, `npx eslint app/courses/page.tsx lib/sync.ts`, `npx vitest run lib/sync.test.ts tests` verts.
- [ ] **Step 3:** E2E staging : `npm run test:e2e:staging -- e2e/courses.spec.ts e2e/articles-manuels.spec.ts --retries=2` (adapter aux noms réels des specs `courses*`).
- [ ] **Step 4:** Commit `refactor: /courses coche par l'interface de sync (#362)` ; `graphify update .`.
