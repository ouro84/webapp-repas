# DepotPlanning (#363) : grill et plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Statut :** grill et plan rédigés le 2026-11-06, pendant une session autonome. **Pas de code.** Ce chantier change le déclencheur de push du planning, cœur de la synchro, couvert surtout en e2e. Pas sous auto-merge sans relecture humaine du plan.

**Goal:** Écrire le planning devient un appel d'intention à un module `DepotPlanning`. Écrire dans `storePlanning` ne déclenche plus de push. La comptabilité d'écriture (en vol, horodatage retenu, instantané confirmé, patch du cache, fin d'écriture) n'existe qu'une fois.

**Spec:** issue #363 ; revue d'architecture 2026-11-06 (candidat 03) ; `.claude/rules/sync-planning.md` (l. 59-62, « jumeaux »).

## Auto-grill (décisions retenues)

1. **Le push implicite disparaît-il d'un coup ?** Non. En phase A, on garde `storePlanning.sAbonner(planifierPush)` et on fait passer les écrivains un par un par le dépôt. En phase B, on retire l'abonnement quand plus aucun écrivain n'écrit le store directement. Pourquoi : chaque étape reste e2e-testable et réversible.
2. **Interface.** `ecrireSemaine(planning)` (édition locale débouncée, aujourd'hui `sauvegarderPlanning` / `sauvegarderRemplacementSlot` puis `pousser`), `ecrireSlots(semaine, slots)` (`modifierSlotDistant`), `ecrireCycle(ancre, semaines)` (`appliquerGenerationCycle`), plus `appliquerDistant(planning)` pour hydratation et relecture, qui ne pousse jamais. Elle remplace les 4 `hydratationEnCours = true … gardeAvant`.
3. **Où vit le module ?** Il reste dans `lib/sync.ts` tant que le chantier 07 (seams internes) n'est pas fait. Un fichier à part exigerait d'exporter ~15 singletons. Le module est une section avec une interface exportée réduite ; les pages n'importent plus `storePlanning` en écriture.
4. **Comptabilité commune.** Une fonction interne `avecEcriturePlanning(semaine, ecrire: () => Promise<majServeur>)` fait `ecrituresPlanningEnVol++`, `retenirHorodatageEcrit`, `ecrireConfirme` / `patcherConfirme`, `terminerEcriturePlanning`. Les trois écrivains l'appellent.
5. **Annuler (6 s, `stockage.ts:137-181`).** Il passe par `ecrireSemaine(snapshot)`. C'est une écriture locale ordinaire.
6. **`app/recettes/page.tsx:69`** (renommage d'une recette présente au planning) passe par `ecrireSemaine`.
7. **Tests.** Un `describe` « contrat d'écriture » par sorte d'écrivain, avec les cas « écho avant réponse » (#352), « édition pendant l'écriture » et « semaine partielle » (#355). Les `describe` nommés par bug restent tant qu'ils passent (filet).
8. **E2E staging obligatoire :** `planning*.spec.ts`, `edition-vue-cycle.spec.ts`, `synchro*.spec.ts`, avec `--retries=2`.

## Phase A : comptabilité commune (iso-comportement)

### Task A1 : `avecEcriturePlanning`
- Modify: `lib/sync.ts` (`pousser` 712-759, `appliquerGenerationCycle` ~1730, `modifierSlotDistant` 2219-2251).
- Tests d'abord : pour chaque écrivain, un écho Realtime portant l'`updated_at` renvoyé, arrivé AVANT la résolution de la RPC, n'ouvre pas l'alerte US-21 et ne déclenche pas de relecture.
- Commit `refactor: comptabilité d'écriture du planning commune (#363)`.

### Task A2 : `appliquerDistant`
- Remplace les 4 sites `hydratationEnCours = true; storePlanning.ecrire(...); hydratationEnCours = gardeAvant` (1412, 1778, 2016, 2240).
- Test : `appliquerDistant` pendant une hydratation en cours ne lève pas la garde de l'appelant (garde réentrante, revue #301).

## Phase B : écrire = intention

### Task B1 : `ecrireSemaine` et migration des pages
- `app/planning/page.tsx` (643, 704, 725, 747), `app/recettes/page.tsx:69`, `lib/stockage.ts` (annuler) passent par `ecrireSemaine`. `sauvegarderRemplacementSlot` est supprimée (test de suppression : simple relais).

### Task B2 : retrait de `storePlanning.sAbonner(planifierPush)`
- `ecrireSemaine` appelle `planifierPush` explicitement ; `hydratationEnCours` disparaît.
- `grep -rn "storePlanning\.ecrire" app components lib` → seulement dans le dépôt.
- Règle `sync-planning.md` : remplacer l'entrée « jumeaux » par « toute écriture du planning passe par le dépôt ».
