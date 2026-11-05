# Vues Semaine et Cycle au même gabarit (#352) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur `/planning`, les vues Semaine et Cycle partagent le même en-tête, la même légende, le même navigateur de période et le même rendu des jours (liste mobile, grille 7 colonnes alignée en desktop), avec le jour courant marqué.

**Architecture:** On extrait des composants partagés dans `components/planning/` (navigateur de période, en-tête + légende, état vide, grille des jours) et un module pur `lib/planning-affichage.ts` (libellés de dates, rangées, décalage de cycles). La vue Semaine (`app/planning/page.tsx`) et la vue Cycle (`components/planning/vue-cycle.tsx`) les consomment ; `/courses` reprend le navigateur. La grille desktop passe en **CSS subgrid** : chaque jour reste un `<section>` (stagger et halo d'atterrissage #337 intacts) qui s'étend sur 3 rangées partagées (en-tête, Déjeuner, Dîner), ce qui aligne les hauteurs d'une colonne à l'autre.

**Tech Stack:** Next.js 16 (App Router), React, Tailwind v4 (`grid-rows-subgrid`), Vitest + Testing Library, Playwright contre staging.

**Spec:** issue #352 (`gh issue view 352`) ; maquettes validées https://claude.ai/artifact/QgX9bfNuePVcp36ZY1vHed ; décisions du grilling du 2026-11-05 (Q1–Q19).

## Global Constraints

- Titres : « Mon planning de la semaine » (inchangé) et « Mon planning du cycle ».
- En-tête des deux vues, dans cet ordre : bascule `Semaine | Cycle`, icône Réglages (`SlidersHorizontal`, lien `/reglages`), bouton secondaire, lien primaire « Liste de courses → ».
- Bouton secondaire du cycle : « Régénérer » quand le cycle a des repas (confirmation `ConfirmationModale` « Régénérer ce cycle ? » conservée, #334) ; cycle vide = état vide hero avec le gros bouton « Générer mon cycle » et la phrase « Aucun repas planifié sur ce cycle. ».
- Navigateur : ligne 1 libellé relatif, ligne 2 dates « du 2 au 8 novembre » (« du 30 octobre au 5 novembre » si deux mois), pastille `bg-brand-50` sur la période courante, bornes −12/+6. Libellés cycle : « Ce cycle », « Cycle suivant », « Cycle précédent », « Dans N cycles », « Il y a N cycles ». Noms accessibles des flèches inchangés (« Semaine précédente/suivante », « Cycle précédent/suivant »).
- Jours : mobile « Lundi 3 nov. », desktop « LUN 3 » (majuscules par CSS). Les **noms accessibles des actions de slot ne changent pas** (`jourLabel` = « Lundi » en semaine, date longue en cycle comme aujourd'hui) : 15+ e2e les ciblent.
- Desktop ≥ `lg` : grille 7 colonnes pour les deux vues ; cycle > 7 jours = rangées de 7 alignées à gauche ; < 7 jours = colonnes vides, pas d'étirement.
- Carte de slot : libellé + nom en haut (nom `line-clamp-3`, `title` = nom complet), badges + actions + stepper ancrés en bas (`mt-auto`). Cartes Restes et « Pas de repas prévu » à hauteur pleine.
- Actions de slot : référence mobile (Changer en icône seule, Sélectionner et Restes libellés). À `lg` : pile verticale, un bouton par ligne, « Changer » libellé.
- Aujourd'hui : bordure `border-2 border-brand-600` (carte du jour en mobile, cartes de la colonne en desktop), pastille « Aujourd'hui » (`bg-primary text-white`) dans l'en-tête du jour ; rien si le jour n'est pas affiché. Calculé **après hydratation** (`navPret` / `useHydratation`), jamais au rendu serveur.
- `libelleCycle` (« Courses du … ») garde sa sortie exacte : les outils MCP (`lib/mcp/lecture.ts`, `lib/mcp/executeur.ts`) la renvoient à l'assistant.
- Hors périmètre : chorégraphie de génération côté cycle (#353).
- Français partout, `’` en JSX texte, tokens sémantiques (`bg-surface`, `bg-primary`…), icônes `lucide-react`, mobile-first.
- E2E staging avant la PR ; `npm run test:e2e` jamais en local.

## Review Focus

1. **Week-end** : la semaine et le cycle par défaut sont ceux de la semaine suivante ; « Aujourd'hui » ne doit alors apparaître nulle part (pas de faux marquage sur le lundi suivant).
2. **Cycle à 2 semaines ISO avec une semaine non générée** : les jours sans `JourPlanning` s'affichent avec deux cartes « Pas de repas prévu », sans casser l'alignement des rangées.
3. **Nom de plat très long / zoom texte 200 %** : la carte grandit, la rangée entière s'aligne, rien ne déborde de la colonne à 1024 px.
4. **Bornes du navigateur sur `/courses`** : le relais `?ancre=` (lien depuis le planning, lien profond, panier #320) vers un cycle hors −12/+6 doit rester affiché, seules les flèches se désactivent.
5. **Hydratation** : aucune différence serveur/client due à la date (pastille, libellé relatif, dates) ; pas d'avertissement d'hydratation dans la console e2e.

---

### Task 1: Libellés et découpage purs (`lib/planning-affichage.ts`)

**Files:**
- Create: `lib/planning-affichage.ts`
- Modify: `lib/cycles.ts` (exporter `versISO`, ajouter `datesCycle`, réécrire `libelleCycle` dessus)
- Test: `tests/planning-affichage.test.ts`, `tests/cycles.test.ts`

**Interfaces:**
- Produces (`lib/planning-affichage.ts`) :
  - `libellePlageDates(debutISO: string, finISO: string): string` → `"du 2 au 8 novembre"` / `"du 30 octobre au 5 novembre"`
  - `libelleRelatifCycle(offset: number): string`
  - `decalageCycles(ancre: string, ancreReference: string): number` (écart en pas de 7 jours, arrondi)
  - `datesDeSemaine(semaine: string): string[]` (7 dates ISO, lundi → dimanche, via `lundiDeSemaine`)
  - `libelleJourComplet(dateISO: string): string` → `"Lundi 3 nov."`
  - `libelleJourAbrege(dateISO: string): string` → `"Lun 3"`
  - `enRangees<T>(items: readonly T[], taille?: number): T[][]` (défaut 7)
- Produces (`lib/cycles.ts`) : `export function versISO(d: Date): string` ; `datesCycle(ancre: string, longueur: number): string` = `libellePlageDates(premier jour, dernier jour)` ; `libelleCycle` = `` `Courses ${datesCycle(…)}` `` (sortie inchangée).

- [ ] **Step 1: Créer la branche**

```bash
git checkout main && git pull && git checkout -b feat/352-planning-gabarit-unique
```

- [ ] **Step 2: Écrire les tests**

`tests/planning-affichage.test.ts` :
- `libellePlageDates("2026-11-02", "2026-11-08")` → `"du 2 au 8 novembre"` ; `("2026-10-30", "2026-11-05")` → `"du 30 octobre au 5 novembre"` ; `("2026-12-28", "2027-01-03")` → `"du 28 décembre au 3 janvier"`.
- `libelleRelatifCycle` : `0` → `"Ce cycle"`, `1` → `"Cycle suivant"`, `-1` → `"Cycle précédent"`, `3` → `"Dans 3 cycles"`, `-2` → `"Il y a 2 cycles"`.
- `decalageCycles("2026-11-19", "2026-11-05")` → `2` ; `("2026-10-29", "2026-11-05")` → `-1` ; même date → `0`.
- `datesDeSemaine("2026-W45")` → `["2026-11-02", …, "2026-11-08"]` (7 éléments) ; `datesDeSemaine("2026-W53")` commence au `"2026-12-28"`.
- `libelleJourComplet("2026-11-02")` → `"Lundi 2 nov."` ; `libelleJourAbrege("2026-11-02")` → `"Lun 2"` ; `libelleJourComplet("2026-08-15")` → `"Samedi 15 août"` (mois court sans point si le mot est court : suivre `toLocaleDateString("fr-FR", { month: "short" })`, figer la sortie réelle observée dans le test).
- `enRangees([1..10])` → `[[1..7],[8,9,10]]` ; `enRangees([])` → `[]` ; `enRangees([1..5])` → `[[1..5]]`.

`tests/cycles.test.ts` : ajouter `datesCycle("2026-07-09", 7)` → `"du 9 au 15 juillet"` ; le test existant `libelleCycle(…)` → `"Courses du 9 au 15 juillet"` reste inchangé.

- [ ] **Step 3: Lancer et voir échouer**

Run: `npx vitest run tests/planning-affichage.test.ts tests/cycles.test.ts`
Expected: FAIL (module `@/lib/planning-affichage` introuvable, `datesCycle` non exporté).

- [ ] **Step 4: Implémenter**

Heure locale comme `lib/cycles.ts` (`depuisISO`/`versISO`), pas d'UTC. `libelleJourComplet` : `toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })`, majuscule initiale. `libelleJourAbrege` : `weekday: "short"` sans point final + jour. Déplacer `libelleJourDate` de `vue-cycle.tsx` vers `libelleJourComplet` (supprimer la copie locale).

- [ ] **Step 5: Lancer et voir passer**

Run: `npx vitest run tests/planning-affichage.test.ts tests/cycles.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/planning-affichage.ts lib/cycles.ts tests/planning-affichage.test.ts tests/cycles.test.ts components/planning/vue-cycle.tsx
git commit -m "feat: libellés de dates et de cycles partagés par les vues du planning (#352)"
```

---

### Task 2: Navigateur de période unique (semaine, cycle, `/courses`)

**Files:**
- Create: `components/planning/navigateur-periode.tsx`
- Modify: `app/planning/page.tsx` (supprimer `NavigateurSemaine` et `ChevronSemaine`), `components/planning/vue-cycle.tsx` (barre l. ~558-600), `app/courses/page.tsx` (`NavigateurCycle`, partie flèches + libellé ; le stepper « Couvre N j » reste)
- Test: `tests/navigateur-periode.test.tsx`
- Modify e2e : `e2e/coherence-semaine-cycle.spec.ts` (l. 65), `e2e/cycle-courses.spec.ts` (l. 116, 132), `e2e/planning.spec.ts` (l. 108), `e2e/lien-cycle.spec.ts` (l. 22, 94)

**Interfaces:**
- Consumes: `libelleRelatif` (`lib/semaines.ts`), `libelleRelatifCycle`, `libellePlageDates`, `decalageCycles` (Task 1), `datesCycle`, `ancreCourante`, `cyclesSelectionnables` (`lib/cycles.ts`).
- Produces: `NavigateurPeriode(props: { unite: "semaine" | "cycle"; libelle: string; dates: string; courante: boolean; peutReculer: boolean; peutAvancer: boolean; onPrecedente: () => void; onSuivante: () => void; disabled?: boolean })`. Rendu : `role="group"` nommé « Naviguer entre les semaines » / « Naviguer entre les cycles », flèches nommées « Semaine précédente/suivante » / « Cycle précédent/suivant », bloc central `aria-live="polite"` contenant le libellé puis les dates, `data-courante` posé quand `courante`.

- [ ] **Step 1: Test du composant**

`tests/navigateur-periode.test.tsx` (Testing Library) :
- `unite="cycle"`, `libelle="Ce cycle"`, `dates="du 5 au 14 novembre"`, `courante` → `getByRole("group", { name: "Naviguer entre les cycles" })` contient « Ce cycle » et « du 5 au 14 novembre » ; boutons « Cycle précédent » / « Cycle suivant » présents.
- `peutReculer={false}` → « Cycle précédent » `disabled` ; clic sur « Cycle suivant » appelle `onSuivante` une fois.
- `unite="semaine"` → boutons « Semaine précédente » / « Semaine suivante ».
- `disabled` → les deux flèches désactivées.

- [ ] **Step 2: Voir échouer** — Run: `npx vitest run tests/navigateur-periode.test.tsx` — Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le composant** en reprenant le style de l'actuel `NavigateurSemaine` (flèches `ChevronLeft`/`ChevronRight` lucide, `size-8`, zone tactile `after:-inset-1`, bloc central `min-w-[11rem] rounded-lg px-3 py-1`, `bg-brand-50` si courant).

- [ ] **Step 4: Voir passer** — même commande — PASS.

- [ ] **Step 5: Brancher les trois consommateurs**
- Semaine : `libelle={libelleRelatif(offset)}`, `dates={libellePlageDates(premier, dernier de datesDeSemaine(semaine))}`, `courante={offset === 0}`, bornes existantes.
- Cycle : garder `jourCourses` en état (déjà lu dans `ancreInitiale`) ; `offset = decalageCycles(ancre, ancreCourante(new Date(), jourCourses))`, `libelle={libelleRelatifCycle(offset)}`, `dates={datesCycle(ancre, longueur)}`, `courante={offset === 0}`, `peutReculer={offset > -12}`, `peutAvancer={offset < 6}`. Le navigateur passe dans l'en-tête de la vue (position identique à la semaine : sous la légende).
- `/courses` : même calcul que le cycle (`jourCourses` du foyer déjà chargé par la page). Un cycle hors plage atteint par `?ancre=` reste affiché ; seules les flèches se désactivent.

- [ ] **Step 6: Mettre à jour les e2e qui lisaient « Courses du »**
- `coherence-semaine-cycle.spec.ts` l. 65 : lire le texte de `getByRole("group", { name: "Naviguer entre les cycles" })` des deux côtés et comparer.
- `cycle-courses.spec.ts` l. 116/132 et `planning.spec.ts` l. 108 : remplacer `getByText(/Courses du/)` par `getByRole("group", { name: "Naviguer entre les cycles" })` visible.
- `lien-cycle.spec.ts` : attendre `datesCycle(suivant, LONGUEUR)` (et `datesCycle(ancreParDefaut(…), LONGUEUR)` l. 94) au lieu de `libelleCycle`.

- [ ] **Step 7: Unitaires + e2e ciblés**

Run: `npm run test:run` puis `npm run test:e2e:staging -- e2e/coherence-semaine-cycle.spec.ts e2e/cycle-courses.spec.ts e2e/lien-cycle.spec.ts e2e/planning.spec.ts --retries=2`
Expected: tout vert.

- [ ] **Step 8: Commit** — `feat: navigateur de période unique pour la semaine, le cycle et les courses (#352)`

---

### Task 3: En-tête, légende et état vide partagés

**Files:**
- Create: `components/planning/entete-planning.tsx`, `components/planning/etat-vide-planning.tsx`
- Modify: `app/planning/page.tsx` (déplacer `BasculeVue`, légende, en-tête l. ~972-1047, état vide l. ~910-954 ; branche `vue === "cycle"` l. ~885-904 réduite à `<main><VuePlanningCycle …/></main>`), `components/planning/vue-cycle.tsx`
- Modify e2e : `e2e/coherence-semaine-cycle.spec.ts`, `e2e/edition-vue-cycle.spec.ts`

**Interfaces:**
- Produces:
  - `BasculeVue({ vue, onChange })` (déplacé tel quel, export nommé).
  - `LegendeBadges()` : la ligne Végétarien / Féculents / Légumes / De saison actuelle.
  - `EntetePlanning(props: { titre: string; vue: VuePlanning; onChangerVue: (v: VuePlanning) => void; libelleRegenerer: string; onRegenerer: () => void; regenerationEnCours: boolean; hrefCourses: string; statut?: ReactNode; navigateur?: ReactNode })` : en-tête (h1 display + `statut` sous le titre) + rangée d'actions + `LegendeBadges` + `navigateur` (`mb-6`). Le type `VuePlanning` est celui déjà utilisé par `storeVuePlanning`.
  - `EtatVidePlanning(props: { titre: string; vue; onChangerVue; navigateur?: ReactNode; enAttente: boolean; message: string; libelleBouton: string; libelleAttente: string; onGenerer: () => void; generationEnCours: boolean })` : hero actuel de la semaine (logo, baseline, `ApercuPlanning enAttente`, bouton `px-8 py-4 text-lg`).
- `VuePlanningCycle` reçoit en plus `vue` et `onChangerVue` (bascule rendue par la vue elle-même).

- [ ] **Step 1: Adapter d'abord les e2e au comportement voulu (rouges)**
- `coherence-semaine-cycle.spec.ts` test 1 : vue Cycle vide → `getByRole("heading", { name: "Mon planning du cycle" })` visible, `getByText("Aucun repas planifié sur ce cycle.")` visible, clic « Générer mon cycle » → recette visible.
- test #334 : après génération, régénérer via `getByRole("button", { name: "Régénérer" })` (plus « Générer mon cycle ») ; ajouter `await expect(page.getByRole("link", { name: "Réglages de génération" })).toBeVisible()`.
- test « lien Liste de courses » : générer le cycle d'abord (le lien n'existe pas dans l'état vide, comme en semaine).
- `edition-vue-cycle.spec.ts` : chaque « Générer mon cycle » cliqué sur un cycle **déjà rempli** devient « Régénérer » + confirmation ; ceux sur un cycle vide restent. Lire chaque contexte (l. 40, 62, 93, 179, 207, 238) avant de choisir.

- [ ] **Step 2: Voir échouer**

Run: `npm run test:e2e:staging -- e2e/coherence-semaine-cycle.spec.ts -g "accessible"`
Expected: FAIL (titre « Mon planning » au lieu de « Mon planning du cycle »).

- [ ] **Step 3: Extraire les composants et brancher la semaine** (rendu de la semaine inchangé : mêmes classes, mêmes textes, `statut` = indicateur de synchro existant).

- [ ] **Step 4: Brancher le cycle**
- Chargement : inchangé (« Chargement… »).
- `!aDesRepas` : `EtatVidePlanning` titre « Mon planning du cycle », message « Aucun repas planifié sur ce cycle. », bouton « Générer mon cycle », attente « Génération… », navigateur de cycle.
- Sinon : `EntetePlanning` titre « Mon planning du cycle », `libelleRegenerer` = « Régénérer » (« Génération… » pendant `enGeneration || verrouAffiche`), `onRegenerer` ouvre la confirmation existante, `hrefCourses = /courses?ancre=${ancre}`.
- La barre actuelle (flèches + « Générer mon cycle » + lien) disparaît.

- [ ] **Step 5: e2e ciblés**

Run: `npm run test:e2e:staging -- e2e/coherence-semaine-cycle.spec.ts e2e/edition-vue-cycle.spec.ts e2e/planning.spec.ts e2e/auth.setup.ts --retries=2`
Expected: vert.

- [ ] **Step 6: `npm run lint && npx tsc --noEmit && npm run test:run`** — Expected: 0 erreur, suite verte.

- [ ] **Step 7: Commit** — `feat: en-tête, légende et état vide communs aux vues Semaine et Cycle (#352)`

---

### Task 4: Carte de slot ancrée en bas, actions identiques mobile/desktop

**Files:**
- Modify: `components/planning/slot-repas.tsx`
- Test: `tests/slot-repas.test.tsx`

**Interfaces:**
- Produces: `SlotRepas` gagne `accentue?: boolean` (bordure `border-2 border-brand-600`, padding compensé), et occupe toute la hauteur de sa cellule (`flex h-full flex-col`). Props existantes inchangées.

- [ ] **Step 1: Tests** (`tests/slot-repas.test.tsx`)
- Le bouton nommé « Changer le déjeuner de lundi » contient un élément de texte « Changer » portant `hidden lg:inline` (libellé desktop seulement).
- Les boutons « Sélectionner le … » et « Marquer le … en restes » contiennent les textes « Sélectionner » et « Restes » **sans** classe `lg:hidden`.
- Le bouton du nom porte `title` = nom de la recette et la classe `line-clamp-3`.
- Le conteneur des actions porte `lg:flex-col` ; le bloc badges+actions+stepper porte `mt-auto`.
- `accentue` → la carte porte `border-brand-600`.
- Variantes `restes` et sans recette : racine `h-full`.

- [ ] **Step 2: Voir échouer** — Run: `npx vitest run tests/slot-repas.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implémenter** : racine `flex h-full flex-col` ; libellé + nom en haut ; badges, actions, stepper et alerte « Pas de recette disponible » dans un bloc `mt-auto` ; actions `flex flex-wrap lg:flex-col lg:items-start` ; retirer `lg:hidden` des libellés ; ajouter `<span className="hidden lg:inline">Changer</span>` ; supprimer les `title` devenus redondants sauf celui de Changer en mobile. Mettre à jour le commentaire d'en-tête des actions (fin de « libellés masqués à lg »).

- [ ] **Step 4: Voir passer** — même commande — PASS ; puis `npm run test:run` vert.

- [ ] **Step 5: Commit** — `feat: carte de slot ancrée en bas, actions libellées en desktop (#352)`

---

### Task 5: Grille des jours partagée (mobile, desktop subgrid, aujourd'hui, rangées)

**Files:**
- Create: `components/planning/grille-jours.tsx`
- Modify: `app/planning/page.tsx` (grilles l. ~1065-1190), `components/planning/vue-cycle.tsx` (liste l. ~602-652), `e2e/helpers.ts`
- Create e2e: `e2e/planning-grille.spec.ts`

**Interfaces:**
- Consumes: `libelleJourComplet`, `libelleJourAbrege`, `enRangees`, `datesDeSemaine` (Task 1) ; `SlotRepas` + `accentue` (Task 4).
- Produces:
  - `type JourGrille = { cle: string; dateISO: string; slots: ReactNode[] }` — `slots` = les deux `SlotRepas` déjà construits par la vue (Déjeuner puis Dîner), qui gardent leurs callbacks et leur `jourLabel` actuel.
  - `GrilleJours(props: { jours: JourGrille[]; aujourdhuiISO: string | null; cleAnimation?: string | number; enAttente?: boolean; animerEntree?: boolean; decor?: (jour: JourGrille, index: number, palier: "mobile" | "desktop") => ReactNode })`.
  - Mobile (`lg:hidden`) : `ul.space-y-4 > li` carte (`rounded-lg border border-brand-100 bg-surface p-4`, `border-2 border-brand-600` si aujourd'hui), `h2` = pastille « Aujourd'hui » éventuelle + `libelleJourComplet`, slots en `grid gap-3 sm:grid-cols-2`.
  - Desktop (`hidden lg:flex flex-col gap-8`) : une `div` par rangée (`data-testid="rangee-jours"`, `grid grid-cols-7 grid-rows-[auto_auto_auto] gap-3`), chaque jour = `section` `row-span-3 grid grid-rows-subgrid` : `h2` centré (`libelleJourAbrege`, `uppercase`, pastille au-dessus si aujourd'hui), puis les deux slots.
  - `animerEntree` : `motion-safe:animate-entree-jour` + `animationDelay: delaiJour(i)` sur chaque jour (index global) ; `enAttente` : `opacity-50` ; `cleAnimation` sert de `key` aux deux paliers (remplace `genNonce` actuel) ; `decor` accueille `PulsationAtterrissage` (desktop : `-inset-2 rounded-xl`).
  - La vue passe `accentue` aux `SlotRepas` du jour courant.
- e2e helpers : `definirLongueurCycleDistant(request, ancre: string, longueur: number)` (upsert REST `cycle_courses` `on_conflict=foyer_id,ancre`, modèle `definirJourCoursesDistant`) et `nettoyerLongueursCycleDistantes(request)` (DELETE `cycle_courses?foyer_id=not.is.null`).

- [ ] **Step 1: Écrire `e2e/planning-grille.spec.ts` (rouge)**

`beforeEach` : `nettoyerEtatDistant`, `nettoyerLongueursCycleDistantes`, `reinitialiserJourCoursesDistant` ; `afterAll` : idem.
1. « desktop : rangées Déjeuner et Dîner alignées » — viewport 1280×900, générer la semaine, puis pour chaque rangée (déjeuners = 2ᵉ enfant de chaque `section`, dîners = 3ᵉ) : toutes les `boundingBox().height` égales à ±1 px, et les `y` des boutons « Changer le déjeuner de … » égaux à ±1 px.
2. « desktop 1024 : actions libellées comme en mobile » — viewport 1024×800 : le bouton « Changer le dîner de lundi » a pour texte visible « Changer », « Sélectionner le dîner de lundi » → « Sélectionner », « Marquer le dîner de lundi en restes » → « Restes » ; aucun débordement horizontal (`scrollWidth - clientWidth === 0`).
3. « aujourd'hui marqué, sauf le week-end » — si `semaineParDefaut() === semaineISO()` : exactement un texte « Aujourd'hui » visible (390 px) et son `li` porte `border-brand-600` ; sinon (week-end) : aucun « Aujourd'hui ».
4. « cycle de 10 jours sur deux rangées » — `definirJourCoursesDistant(request, 4)`, `definirLongueurCycleDistant(request, ancreParDefaut(new Date(), 4), 10)`, vue Cycle à 1280 px, « Générer mon cycle » : `getByTestId("rangee-jours")` → 2 ; 7 `section` dans la 1re, 3 dans la 2e.
5. « cycle de 5 jours : une rangée, colonnes vides » — longueur 5 : 1 rangée, 5 `section`, et la largeur d'une `section` égale à celle de la vue Semaine (±1 px).
6. « mobile 320 : pas de débordement » — `/planning` généré, vue Semaine puis Cycle : `scrollWidth - clientWidth === 0`.

- [ ] **Step 2: Voir échouer**

Run: `npm run test:e2e:staging -- e2e/planning-grille.spec.ts`
Expected: FAIL (pas de `rangee-jours`, hauteurs inégales, libellés masqués à 1024).

- [ ] **Step 3: Implémenter `GrilleJours` puis brancher la semaine**

Semaine : `jours` construits depuis `planningAffiche.jours` + `datesDeSemaine(semaineAffichee)` (index du jour ISO) ; `aujourdhuiISO` = date locale du jour **si `navPret`**, sinon `null` ; chorégraphie #337 conservée via `animerEntree`, `enAttente={attenteVisible}`, `cleAnimation={genNonce}`, `decor` (pulsation sur `choregraphie.jour`).

- [ ] **Step 4: Brancher le cycle**

`jours` = `cellules` (date, `jp` éventuellement `null` → deux `SlotRepas` sans recette, rendus « Pas de repas prévu ») ; `aujourdhuiISO` après hydratation ; ni `animerEntree` ni `decor` (#353). Supprimer « Rien de prévu. » et adapter `edition-vue-cycle.spec.ts` l. 216-222 : `getByText("Pas de repas prévu")` → `toHaveCount(0)` (réglages par défaut, tous créneaux actifs).

- [ ] **Step 5: Voir passer**

Run: `npm run test:e2e:staging -- e2e/planning-grille.spec.ts e2e/planning.spec.ts e2e/planning-edition.spec.ts e2e/edition-vue-cycle.spec.ts e2e/reglages.spec.ts --retries=2`
Expected: vert. Vérifier dans les logs l'absence d'avertissement d'hydratation.

- [ ] **Step 6: `npm run lint && npx tsc --noEmit && npm run test:run`** — vert.

- [ ] **Step 7: Commit** — `feat: grille des jours commune, alignée en desktop, jour courant marqué (#352)`

---

### Task 6: Règles, changelog, doc utilisateur, passe e2e complète

**Files:**
- Modify: `.claude/rules/ui.md` (section « Carte de slot » : actions libellées + pile `lg`, ancrage bas, `accentue` ; nouvelle entrée grille subgrid + `GrilleJours` + aujourd'hui après hydratation ; navigateur unique `NavigateurPeriode` ; stagger : `cleAnimation` remplace `genNonce` comme `key`), `.claude/rules/courses-cycle.md` (vue Cycle : en-tête commun, « Régénérer » rempli / hero vide, bornes −12/+6 aussi sur `/courses`, `libelleCycle` réservé au MCP), `CHANGELOG.md` (`[Unreleased]` › `### Modifié`), `content/aide/*` seulement via Notion (cf. ci-dessous).

- [ ] **Step 1: Règles** — chaque entrée : la règle, puis une ligne « Pourquoi ». Corriger les phrases devenues fausses (« libellés masqués à `lg` », « `genNonce` … sert de `key` aux deux grilles », « bouton exposé seulement sans risque … dans la vue Cycle, un cycle déjà rempli passe par une `ConfirmationModale` » → préciser « Régénérer » dans l'en-tête).

- [ ] **Step 2: CHANGELOG** — « Planning : les vues Semaine et Cycle partagent le même en-tête, le même navigateur et la même grille ; sur ordinateur, les repas Déjeuner et Dîner sont alignés d'une colonne à l'autre, les actions gardent leurs libellés, et le jour courant est mis en évidence (#352). »

- [ ] **Step 3: Doc `/aide`** — `grep -rn "Courses du\|Générer mon cycle\|vue Cycle\|icône" content/aide` ; si un texte décrit l'ancien rendu, mettre à jour la page Notion source via l'API REST (`NOTION_TOKEN`, cf. mémoire « MCP Notion indisponible ») puis `npm run pull:aide` et committer `content/aide`. Sinon, noter « aucun impact /aide » dans la PR.

- [ ] **Step 4: Passe e2e des specs impactées**

Run: `npm run test:e2e:staging -- e2e/planning.spec.ts e2e/planning-edition.spec.ts e2e/planning-grille.spec.ts e2e/coherence-semaine-cycle.spec.ts e2e/edition-vue-cycle.spec.ts e2e/cycle-courses.spec.ts e2e/lien-cycle.spec.ts e2e/courses.spec.ts e2e/reglages.spec.ts e2e/nav-mobile.spec.ts --retries=2`
Expected: vert (un flaky préexistant se prouve par `--repeat-each`, cf. mémoire).

- [ ] **Step 5: Commit** — `docs: règles, changelog et aide du planning unifié (#352)` ; puis `graphify update .`.

---

### Task 7: PR et merge

- [ ] **Step 1:** `git push -u origin feat/352-planning-gabarit-unique` ; `gh pr create` (titre `feat: vues Semaine et Cycle du planning au même gabarit (#352)`, `Closes #352`, lien maquettes, liste des e2e passés, captures 390/1280 si utiles), label `enhancement` + `ux/ui`.
- [ ] **Step 2:** `gh pr checks <n> --watch` ; échec → ne pas merger, remonter check, lien, extrait de log, cause probable.
- [ ] **Step 3:** CI verte + accord d'Arnaud → `gh pr merge <n> --squash --delete-branch`.
