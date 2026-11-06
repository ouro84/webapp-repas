# Écrire le planning = une intention (#363) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seul un geste de l'utilisateur (écriture d'intention de `lib/stockage.ts`) déclenche un push du planning. Les écritures internes de la synchro n'ont plus à désarmer le push sous la garde `hydratationEnCours`.

**Architecture:** `lib/stockage.ts` gagne un canal `surEditionPlanning(rappel)`. Il est notifié par les trois écritures d'intention (`sauvegarderPlanningComplet`, `sauvegarderRemplacementSlot`, `restaurerSnapshotAnnulation`) et, comme l'ancien abonnement, par l'event `storage` des autres onglets. `storePlanning` redevient un simple cache que la synchro écrit sans effet de bord. `lib/sync.ts` s'abonne à ce canal à la place de `storePlanning.sAbonner(planifierPush)`.

**Tech Stack:** Next.js 16, Vitest + jsdom (`lib/sync.test.ts`, `tests/stockage.test.ts`), Playwright staging.

**Spec:** issue #363 ; revue d'architecture 2026-11-06 (candidat 03) ; auto-grill Q1 à Q7 (session du 2026-11-06, après le merge de #364) ; `.claude/rules/sync-planning.md`.

## Décisions d'auto-grill

1. **Abandon de la phase A (comptabilité commune `ecrituresPlanningEnVol++` / `terminerEcriturePlanning`).** Dans `pousser`, le re-push repart dans le `finally` AVANT `terminerEcriturePlanning` : le compteur ne retombe jamais à 0 entre deux pushes, donc les events différés ne sont pas jugés entre eux. Un wrapper commun inverserait cet ordre. Le gain (3 paires de lignes) ne passe pas le test de suppression.
2. **Asymétrie des patchs jumeaux conservée.** `reporterGenerationSurSemaineAffichee` sort tôt si le cache vise une autre semaine (ni `CLE_MAJ`, ni confirmé) et écrit le store même sans cache local. `modifierSlotDistant` pose `CLE_MAJ` et le confirmé dès que la semaine est affichée, et n'écrit le store que si le cache porte cette semaine. Les unifier changerait le comportement ; c'est hors périmètre, à décider avec Arnaud.
3. **`chargerSemaineDansCache` garde `hydratationEnCours` pendant son `await` (iso).** Bug latent : un geste fait pendant cette lecture n'est pas poussé et le cache est remplacé par le distant. C'est la même famille que #339 côté coches. Le corriger touche au chemin de relecture US-21 (#355) : issue séparée.
4. **Iso multi-onglet** : l'ancien abonnement écoutait aussi `window` `storage` (toute clé). Le canal garde cet écouteur tel quel.

## Global Constraints

- Français ; commentaires citant US-21, RG-19, #301, #355.
- Comportement iso. Seule différence : une écriture directe de `storePlanning` ne pousse plus rien (contrat nouveau, documenté dans `sync-planning.md`).
- `hydratationEnCours` ne sert plus qu'à `chargerSemaineDansCache` (et à `planifierPush`, qui l'honore).

## Review Focus

- Undo (`restaurerSnapshotAnnulation`) après une régénération : le planning restauré est bien poussé (dirty + push).
- Génération de `/bienvenue` (`sauvegarderPlanningComplet`, `useSync` monté) : poussée.
- Écriture d'un autre onglet (`storage`) : `planifierPush` appelé comme avant.
- `modifierSlotDistant`, `appliquerGenerationCycle` et la fusion US-21 : aucun `sauvegarder_planning` déclenché.
- `reinitialiserCacheFoyer` : aucun push planifié.

---

### Task 1: canal `surEditionPlanning` dans `lib/stockage.ts`

**Files:**
- Modify: `lib/stockage.ts`
- Test: `tests/stockage.test.ts`

**Interfaces:**
- Produces: `export function surEditionPlanning(rappel: () => void): () => void` : abonne `rappel` aux trois écritures d'intention ET à `window` `storage` ; renvoie le désabonnement (les deux).

- [ ] **Step 1: Tests qui échouent** :
  - `sauvegarderRemplacementSlot`, `sauvegarderPlanningComplet` et `restaurerSnapshotAnnulation` (snapshot valide) appellent le rappel une fois ;
  - `storePlanning.ecrire` seul ne l'appelle pas ;
  - un `StorageEvent` sur `window` l'appelle ;
  - après désabonnement, plus aucun appel.
- [ ] **Step 2:** `npx vitest run tests/stockage.test.ts` → échec.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Vert.
- [ ] **Step 5:** Commit `refactor: canal d'édition du planning dans stockage (#363)`.

### Task 2: la synchro s'abonne au canal ; gardes retirées

**Files:**
- Modify: `lib/sync.ts` (`demarrerSync` ≈ l. 2380 ; gardes ≈ l. 1442, 1808, 2270 ; commentaires des fonctions concernées)
- Test: `lib/sync.test.ts` (8 sites qui simulent un geste par `storePlanning.ecrire` → `sauvegarderRemplacementSlot`, via `await import("@/lib/stockage")` comme les tests existants ; nouveau test)
- Doc: `.claude/rules/sync-planning.md` (première puce de « Planning » et puce « Tout patch de `storePlanning`… sous la garde `hydratationEnCours` »), `CHANGELOG.md` : aucune entrée (refactor sans effet visible).

**Interfaces:**
- Consumes: `surEditionPlanning` (Task 1).

- [ ] **Step 1: Test qui échoue** : synchro démarrée (`useSync`), `storePlanning.ecrire(...)` direct → après 1 200 ms, `sauvegarderPlanningDistant` non appelé et `planning_dirty` absent ; `sauvegarderRemplacementSlot(...)` → appelé.
- [ ] **Step 2:** Basculer les 8 sites des tests existants sur `sauvegarderRemplacementSlot` ; `npx vitest run lib/sync.test.ts` → seul le nouveau test échoue.
- [ ] **Step 3:** `demarrerSync` : `surEditionPlanning(planifierPush)` ; retirer les trois `gardeAvant` (écriture directe du store).
- [ ] **Step 4:** `npx vitest run lib/sync.test.ts tests` vert ; `npx tsc --noEmit` ; `npx eslint lib/sync.ts lib/stockage.ts`.
- [ ] **Step 5:** E2E staging, spec par spec : `planning`, `planning-edition`, `planning-grille`, `edition-vue-cycle`, `alerte-planning`, `coherence-semaine-cycle`, `cycle-courses`, `lien-cycle` (`--retries=2`).
- [ ] **Step 6:** Commit `refactor: seul un geste de l'utilisateur pousse le planning (#363)` ; issue pour le bug latent de la décision 3 ; `graphify update .`.
