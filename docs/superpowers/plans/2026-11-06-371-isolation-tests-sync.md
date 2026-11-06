# #371 recentré : isolation des tests de `lib/sync.ts` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque test de `lib/sync.test.ts` part d'un état propre : aucun hook, écouteur `window`, minuteur ou moteur de coches d'un test précédent ne réagit pendant le test suivant.

**Architecture:** La primitive générique `fileMonoVol` est abandonnée : les cinq files d'écriture du code n'ont pas la même politique d'échec, la même persistance ni les mêmes blocages externes, et une interface commune serait aussi grosse que son implémentation. Le frottement réel est l'isolation des tests : `globals: false` désactive le nettoyage automatique de Testing Library, 58 `renderHook` pour 29 `unmount()`, et `vi.resetModules` crée une instance de module par test dont les écouteurs et minuteurs survivent. On ajoute un démontage systématique en `afterEach` et une fonction d'arrêt du module.

**Tech Stack:** Vitest 4, @testing-library/react, jsdom.

**Spec:** grilling du 2026-11-06 (Q4 a, Q6) — issue #371.

## Global Constraints

- Une seule PR, exécutée en natif ; pas d'entrée CHANGELOG (aucun effet visible).
- Vitest une instance à la fois, au premier plan.
- Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Le `cleanup` doit viser l'instance de Testing Library importée par le test : avec `vi.resetModules`, un import statique en tête de fichier est une autre instance.
- Un minuteur de débounce armé dans un test ne doit plus déclencher de push dans le suivant.
- La fonction d'arrêt ne doit rien changer au comportement en production.

---

### Task 1: démontage systématique et fonction d'arrêt

**Files:** Modify `lib/sync.ts`, `lib/sync.test.ts`, `.claude/rules/sync-planning.md` (une puce de test) ; si utile `vitest.config.ts` / setup global.

- [x] **Step 1: Tests qui échouent** (deux paires dépendantes de l'ordre, `describe("isolation entre tests (#371)")`) : A laisse `useSyncCourses` monté, B déclenche `online` sans rien monter → aucune relecture (rouge sans `cleanup`) ; C laisse `useSync` monté avec un push débouncé armé, D repose le planning local et attend 1 s → aucun push (rouge sans `suspendrePush` dans `arreterSync`). Les boucles d'attente non bornées des tests de rechargement sont bornées (un échec ne contamine plus le test suivant).
- [x] **Step 2:** `export async function arreterSync(): Promise<void>` dans `lib/sync.ts`, documentée « réservée aux tests » : coupe le minuteur de push et les minuteurs de relecture (planning, coches), appelle `arreter()` sur les moteurs instanciés, attend la coupure du temps réel et de la présence. Aucun appel en production.
- [x] **Step 3:** `afterEach` dans `lib/sync.test.ts` : `cleanup()` des deux instances de Testing Library (celle retenue en `beforeEach`, avant `chargerSync()`, et celle du registre courant), puis `await arreterSync()` du module chargé par `chargerSync()` (retenu dans une variable de fichier).
- [x] **Step 4:** Supprimer `capturerRetourEnLigne` si les tests qui l'utilisent passent avec un `window.dispatchEvent(new Event("online"))` ordinaire ; sinon le garder et noter pourquoi.
- [x] **Step 5:** `npx vitest run --maxWorkers=1 lib/sync.test.ts` vert 3 fois de suite ; suite complète verte ; `tsc` ; `eslint .`.
- [x] **Step 6:** Commit `test: isolation des tests de la synchro, démontage et arrêt du module (#371)`.
