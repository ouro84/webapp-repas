# Chantier 06 (restreint) : calcul d'édition de slot partagé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les vues Semaine et Cycle calculent une édition de slot (changer, sélectionner, personnes, restes) par une seule fonction pure, testée sans navigateur ; chaque vue garde sa persistance, son undo et ses gardes.

**Architecture:** Nouveau module pur `lib/edition-slot.ts` : `editerSlot(planning, jour, typeRepas, action)` renvoie le planning modifié, l'ancien et le nouveau `JourPlanning`, et les avertissements dérivés (RG-26/27/28), ou un refus typé. Les deux vues l'appellent ; la vue Semaine toaste les avertissements comme aujourd'hui, la vue Cycle les ignore comme aujourd'hui.

**Tech Stack:** TypeScript pur, Vitest, Playwright staging.

**Spec:** auto-grill du 2026-11-06 (session autonome), décisions ci-dessous.

## Décisions (auto-grill)

- **D1 Hook unique `useEditionSlots(source)` écarté.** Semaine = snapshot mono-niveau planning + coches (RG-19) et push débouncé dirty-first (#363) ; Cycle = file par (semaine, jour) avec revert (#301). Un contrat commun casserait l'un des deux pour ≈ 150 lignes gagnées.
- **D2 Module pur retenu** (`lib/edition-slot.ts`) :
  - `type ActionSlot = { type: "changer"; recettes: Recette[]; reglages: ReglagesGeneration; preferences: Preferences } | { type: "selectionner"; recette: Recette } | { type: "personnes"; personnes: number } | { type: "restes"; valeur: boolean }` (reprendre les types exacts des signatures actuelles de `remplacerSlot` / `remplacerSlotManuel` / `modifierPersonnes` / `marquerRestes`).
  - `type Avertissement = "vege" | "legume" | "saison"`.
  - `editerSlot(planning: Planning, jour: Jour, typeRepas: TypeRepas, action: ActionSlot): { ok: true; planning: Planning; precedent: JourPlanning; jour: JourPlanning; avertissements: Avertissement[] } | { ok: false; motif: "indisponible" | "slot-absent" }`.
  - `indisponible` = `remplacerSlot` renvoie `null` (action `changer`) ; `slot-absent` = jour absent ou fonction métier qui renvoie `null` pour les autres actions.
  - Avertissements calculés **seulement pour `changer`**, avec les règles actuelles de `changerSlot` (`app/planning/page.tsx`) : `vege` si `prefereVegeSlot(jour, typeRepas, reglages)` et le remplaçant n'est pas végétarien ; `legume` si `joursSansLegume(nouveau, reglages).includes(jour)` ; `saison` si `reposNonSaison(nouveau, reglages)` contient le slot.
  - `MESSAGES_EDITION` : `remplacee: "Recette remplacée"`, `indisponible: "Pas de recette disponible"`, `restes(valeur)` = `valeur ? "Repas marqué « Restes »" : "Repas à cuisiner"`, et `avertissements: Record<Avertissement, string>` avec les trois textes exacts actuels de `page.tsx`.
- **D3 Gardes RG-24 non unifiées.** Semaine juge la semaine affichée (`offsetAffiche < 0`), Cycle juge la date du jour ; les unifier changerait le comportement visible. Hors périmètre.
- **D4 Aucun changement visible.** Les écarts Cycle (avertissements non toastés, pas de Ctrl+Z, pas de « Pas de recette disponible » inline) sont des décisions produit à valider par Arnaud (issue), pas embarquées. Pas d'entrée CHANGELOG.

## Global Constraints

- Français partout ; commentaires gardant les `RG-xx` / `US-xx` existants.
- Vitest une instance à la fois, `--maxWorkers=2` max ; e2e `npm run test:e2e:staging -- <spec> --retries=2`, une spec à la fois ; jamais `npm run test:e2e`.
- Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- `changer` sur un créneau sans recette éligible : Semaine affiche toujours le message inline + toast ; Cycle le toast seul.
- `selectionner` sur une semaine passée : la cible figée avant la garde reste celle utilisée après confirmation (les deux vues).
- Stepper personnes en rafale côté Cycle : une seule écriture (débounce de la file inchangé).
- Avertissements : mêmes toasts, même ordre (végé, légume, saison) qu'avant côté Semaine ; aucun côté Cycle.

---

### Task 1: module `lib/edition-slot.ts`

**Files:** Create `lib/edition-slot.ts`, `lib/edition-slot.test.ts`.

- [ ] **Step 1: Tests qui échouent** (fixtures de `tests/fixtures/recettes.ts`, PRNG seedé `rngSeed` si un `remplacerSlot` déréférence un créneau contraint, cf. `generation-recettes.md`) :
  - `changer` : `ok`, `precedent` = ancien jour, `jour` = jour du nouveau planning, slot changé ;
  - `changer` sans recette éligible → `{ ok: false, motif: "indisponible" }` ;
  - `changer` avec `vegetarienPrefere` posé et aucune recette végé → `avertissements` contient `"vege"` (idem un cas `legume`, un cas `saison`) ;
  - `selectionner` → la recette choisie occupe le slot, `avertissements` vide ;
  - `personnes` → `personnes` mis à jour ; `restes` → `estRestes` vrai ;
  - jour absent du planning → `slot-absent` ;
  - `MESSAGES_EDITION.avertissements` = les trois textes actuels exacts.
- [ ] **Step 2:** `npx vitest run lib/edition-slot.test.ts` → échec. **Step 3:** implémenter. **Step 4:** vert.
- [ ] **Step 5:** Commit `feat: calcul d'édition de slot partagé editerSlot (chantier 06)`.

### Task 2: bascule des deux vues

**Files:** Modify `app/planning/page.tsx` (`changerSlot`, `appliquerSelection`, `changerPersonnes`, `changerRestes`), `components/planning/vue-cycle.tsx` (`changerSlot`, `selectionnerRecette`, `changerPersonnesSlot`, `changerRestesSlot`) ; Doc `.claude/rules/sync-planning.md` ou `courses-cycle.md` (une puce : « Le calcul d'une édition de slot passe par `editerSlot` (`lib/edition-slot.ts`) dans les deux vues ; chaque vue garde sa persistance, son undo et sa garde RG-24. Pourquoi : … »).

- [ ] **Step 1:** Remplacer dans chaque handler le calcul (fonction métier + `find` de l'ancien et du nouveau jour + avertissements) par `editerSlot`, sans toucher garde RG-24, snapshot / file, toasts d'undo, verrou `generationVerrouillee`, `setSlotIndisponible`.
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 --exclude ".claude/**" --exclude "e2e/**"` ; `npx tsc --noEmit -p .` ; `npx eslint lib app components`.
- [ ] **Step 3:** E2E staging une à une `--retries=2` : `planning-edition`, `planning`, `edition-vue-cycle`, `coherence-semaine-cycle`.
- [ ] **Step 4:** Commit `refactor: les vues Semaine et Cycle éditent un slot par editerSlot (chantier 06)` ; `graphify update .`.
