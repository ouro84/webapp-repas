# PR3 — Vue planning calée sur le cycle — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Steps en checkbox (`- [ ]`).
>
> **Prérequis : PR1 (#258) mergée** (consomme `lib/cycles.ts` : `joursDuCycle`, `dateVersSemaineJour`, `planningDuCycle`, `useCycleAffiche`). PR2 non requise. Branche depuis `main` après merge PR1.

**Goal:** Offrir sur `/planning` une bascule « Semaine | Cycle » — la vue cycle affiche les jours de la fenêtre de courses (« ce que j'ai prévu jusqu'à quand »), en réutilisant les cartes planning existantes.

**Architecture:** Projection d'affichage. La vue cycle lit les slots des 1-2 semaines touchées (déjà chargeables) et rend `joursDuCycle` avec les composants de carte existants. L'édition écrit dans les slots de la semaine sous-jacente (gardes « semaine passée » #5 PR3 réutilisées). Lecture d'abord ; minimal.

**Tech Stack:** Next.js 16, TypeScript strict, Tailwind v4, Vitest, Playwright.

## Global Constraints

- Français ; TypeScript strict ; mobile-first ; 3 états UI ; commits `type: desc`.
- Pas de nouvelle migration (PR d'affichage).
- Réutiliser les cartes/dialogs planning existants — ne pas réinventer un style de carte.
- La vue calendaire (Semaine) reste le défaut et le comportement d'aujourd'hui.

---

### Task 1 : Store de préférence de vue + bascule

**Files:**
- Modify: `app/planning/page.tsx` (ou un petit composant `components/planning/bascule-vue.tsx`)

**Interfaces:**
- Produces: état `vue: "semaine" | "cycle"` (local, éventuellement persistant `localStorage` clé `vue_planning`), et un contrôle segmenté (`role="radiogroup"`, patron `SelecteurTheme`).

- [ ] **Step 1 : Ajouter la bascule** « Semaine | Cycle » dans l'en-tête de `/planning`, défaut « Semaine ». Contrôle segmenté (2 options), `aria-label="Vue du planning"`.

- [ ] **Step 2 : Compilation + lint.** Commit :

```bash
git add app/planning/page.tsx components/planning/bascule-vue.tsx
git commit -m "feat: bascule Semaine/Cycle sur /planning (#260)"
```

---

### Task 2 : Rendu de la vue cycle

**Files:**
- Modify: `app/planning/page.tsx`

**Interfaces:**
- Consumes: `useCycleAffiche`, chargement des 1-2 plannings du cycle (réutiliser `semainesDuCycle` + `chargerPlanningDistant`, ou exposer un `chargerPlanningsCycle` dans `lib/sync`) ; `planningDuCycle` pour l'ordre des jours ; cartes planning existantes.

- [ ] **Step 1 : Charger les jours du cycle.** Quand `vue === "cycle"`, charger les plannings des `semainesDuCycle(ancre, longueur)` et projeter via `planningDuCycle` pour obtenir la liste ordonnée des jours (avec leurs dates réelles).

- [ ] **Step 2 : Rendre les cartes.** Réutiliser le composant de carte repas existant pour chaque jour du cycle, en affichant la **date réelle** (ex. « jeudi 9 juil. ») plutôt que le seul nom de jour (un cycle peut contenir deux jeudis). Naviguer entre cycles via le même navigateur que `/courses` (réutiliser `naviguerCycle`/`useCycleAffiche`).

- [ ] **Step 3 : Édition.** L'édition d'un slot (changer / sélectionner / restes / personnes) écrit dans la **semaine sous-jacente** du jour (mapper la date → `dateVersSemaineJour` → semaine cible), en réutilisant les actions existantes de la page planning et leurs gardes « semaine passée » (#5 PR3). Lecture d'abord : si l'édition depuis la vue cycle est trop couplée, la livrer en lecture seule et renvoyer vers la vue Semaine pour éditer (décision à trancher à l'exécution selon le couplage réel — défaut : lecture seule si l'édition demande un refactor lourd).

- [ ] **Step 4 : 3 états** loading/error/empty (cycle sans planning → empty avec CTA « Générer »).

- [ ] **Step 5 : Build + lint.** Commit :

```bash
git add app/planning/page.tsx
git commit -m "feat: vue planning calée sur le cycle (#260)"
```

---

### Task 3 : e2e (CI-only)

**Files:**
- Modify: `e2e/cycle-courses.spec.ts` (ou nouveau `e2e/planning-cycle.spec.ts`)

- [ ] **Step 1 : Test** — basculer en vue Cycle, vérifier que les jours affichés correspondent à la fenêtre (dates réelles), que la navigation cycle fonctionne, et que la vue Semaine reste intacte. Reset `jour_courses` en `afterAll`. CI-only.

- [ ] **Step 2 : Commit**

```bash
git add e2e/planning-cycle.spec.ts
git commit -m "test: e2e vue planning cycle (#260)"
```

---

### Task 4 : Documentation

- [ ] `CLAUDE.md` : piège « `/planning` a 2 vues (Semaine défaut / Cycle) ; la vue cycle affiche des dates réelles (doublons de jour possibles) et édite la semaine sous-jacente ».
- [ ] `CHANGELOG.md` : `[Unreleased]` « Vue planning calée sur le cycle de courses ».
- [ ] Commit `docs: vue planning cycle (#260)`.

---

## Self-Review

- Bascule + rendu + édition + états → Tasks 1-2 ✓ (design §8).
- Dates réelles (doublons de jour) traitées (Task 2 step 2) ✓.
- Décision assumée : édition depuis la vue cycle possiblement lecture seule en V1 si couplage lourd (Task 2 step 3) — bonus, périmètre minimal comme prévu au design (§8 « lecture d'abord »).
- Pas de migration ; réutilise cartes existantes ✓.
</content>
