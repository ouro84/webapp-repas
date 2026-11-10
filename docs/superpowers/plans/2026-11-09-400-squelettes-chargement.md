# Squelettes de chargement (#400) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le texte « Chargement… » des écrans Planning (Semaine, Cycle), Ce soir, Courses, Recettes, Profil et Réglages par des squelettes calqués sur l'état chargé, et supprimer le faux état vide de la vue Semaine.

**Architecture:** Des primitives partagées (`components/ui/squelette.tsx`) et une coque (`EcranChargement`, qui garde ses garde-fous CLS) portent l'accessibilité et l'animation. Chaque écran a son squelette, construit avec les **mêmes classes** que son état chargé. Les textes fixes (titres, intitulés) restent en vrai texte ; seules les données et les contrôles deviennent des blocs. La vue Semaine gagne un store `semaineLue` dans `lib/sync.ts` pour distinguer « pas encore lu » de « vide ».

**Tech Stack:** Next.js 16 (App Router), React, Tailwind CSS v4 (tokens dans `app/globals.css`), Vitest + Testing Library, Playwright (staging).

**Spec:** issue GitHub #400 (`gh issue view 400`) + maquette validée par Arnaud : `C:\Users\Arnaud\AppData\Local\Temp\claude\7bbdee54802e2464\b637b0ee-a57e-4f8f-8b40-16b3f64e7f57\scratchpad\maquette-squelettes.html` (publiée : https://claude.ai/artifact/7LVTEw1ctFQhLiSsKqP4eA). La maquette montre, écran par écran, quels éléments sont des blocs et lesquels restent du vrai texte : l'ouvrir avant chaque tâche d'écran.

## Global Constraints

- Lire `CLAUDE.md` et `.claude/rules/ui.md` (sections « Stabilité visuelle au chargement (CLS) » et « Composants partagés ») avant de coder. `graphify-out/graph.json` existe : s'orienter avec `graphify query "<question>"` avant de lire des fichiers bruts.
- Tout en français : identifiants, commentaires (citer `RG-09`, `#400`), textes. Apostrophe typographique `’` dans le texte JSX.
- **Textes fixes = vrai texte** (titres `h1`, intitulés de section, « Déjeuner » / « Dîner », légende des badges, libellés de réglages). **Données = `TexteSquelette`** (nom de plat, jours, quantités, compteurs, noms de catégories de courses). **Contrôles = `Squelette`** de la taille du contrôle (boutons, segments, interrupteurs, cases, pastilles, navigateur de période).
- Un squelette reprend **les classes de boîte de son état chargé** (largeur du `<main>`, paddings, gaps, bordures, hauteurs `min-h-11`, `size-*`). Pourquoi : React réutilise le `<main>`, et toute différence décale la page (CLS, cf. `ui.md`).
- Teintes : `bg-squelette` sur le fond de page, `bg-squelette-carte` dans une carte `bg-surface` (tokens créés en Tâche 1).
- Animation : `motion-safe:animate-pulse` uniquement, jamais d'autre animation ni de délai d'apparition. Le squelette s'affiche immédiatement (il est prérendu).
- Accessibilité : chaque zone en chargement expose **un** `role="status"` contenant le texte « Chargement… » en `sr-only` ; tous les blocs du squelette sont sous un conteneur `aria-hidden="true"`. Pourquoi : annonce vocale conservée, et les tests qui détectent l'état de chargement par le texte « Chargement… » (`e2e/coherence-semaine-cycle.spec.ts`, `e2e/edition-vue-cycle.spec.ts`, `e2e/reglages.spec.ts`, `tests/vue-cycle-erreur.test.tsx`) gardent leur sens sans réécriture.
- Hors périmètre : `/bienvenue`, `/oauth/consent`, libellés de boutons en cours d'envoi (« Envoi… », « Connexion… »), rechargements de la vue Cycle (ils gardent l'état affiché estompé), navigation entre semaines déjà chargées.
- Ne pas lancer `npm run test:e2e` (pointe la prod) ; e2e uniquement via `npm run test:e2e:staging -- <spec>`.
- Commits : `feat:` / `refactor:` / `docs:` + description, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push (fait en fin de vague par l'humain ou le contrôleur).

## Review Focus

1. **Lecture de la semaine en échec ou hors ligne** : le squelette ne doit jamais rester affiché indéfiniment ; après l'échec, l'état vide (ou erreur) prend le relais. Test en Tâche 2.
2. **Mouvement réduit** : sous `prefers-reduced-motion`, aucun bloc ne pulse. Test de classe `motion-safe:animate-pulse` en Tâche 1.
3. **Lecteur d'écran** : une seule annonce « Chargement… » par zone et aucun bloc lisible. Test en Tâche 1 (primitives) et dans chaque test d'écran (`getAllByRole("status")` = 1 par zone).
4. **États erreur et vide après chargement** : ils remplacent toujours le squelette (Ce soir erreur, Recettes erreur, Réglages erreur, Semaine vide). Les tests existants de ces états doivent rester verts ; la Tâche 2 en ajoute un pour la Semaine.
5. **Hauteurs réservées du Profil** : `min-h-[15.4rem] md:min-h-[13rem]` (identité) et `min-h-[33.6rem] md:min-h-[30.6rem]` (foyer) conservées sur leurs squelettes. Test en Tâche 7.

---

### Task 1: Primitives `Squelette`, tokens et coque `EcranChargement`

**Files:**
- Create: `components/ui/squelette.tsx`
- Create: `components/ui/squelette.test.tsx`
- Modify: `components/ui/ecran-chargement.tsx`
- Modify: `app/globals.css` (bloc `@theme` vers la l. 17-70 et bloc `:root[data-theme="dark"]` vers la l. 192)
- Modify: `.claude/rules/ui.md` (section « Stabilité visuelle au chargement (CLS) »), `DESIGN.md`

**Interfaces:**
- Produces :
  - `Squelette({ className, sur }: { className?: string; sur?: "fond" | "carte" }): JSX.Element` : `<span>` en `block`, `rounded-md` par défaut, `bg-squelette` (ou `bg-squelette-carte` si `sur="carte"`), `motion-safe:animate-pulse`. L'appelant donne taille et forme via `className` (ex. `"h-10 w-28 rounded-full"`).
  - `TexteSquelette({ children, sur }: { children: string; sur?: "fond" | "carte" }): JSX.Element` : `<span>` inline, `rounded-md text-transparent select-none box-decoration-clone` + teinte + `motion-safe:animate-pulse`. `children` est un texte factice de longueur plausible : la barre a donc la métrique exacte du texte qu'elle remplace.
  - `ZoneChargement({ children, className, as }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" }): JSX.Element` : conteneur `role="status"` (classe `className`), premier enfant `<span className="sr-only">Chargement…</span>`, puis `<div aria-hidden="true" className="contents">{children}</div>`.
  - `EcranChargement({ largeur, espacement, children }: { largeur?: "etroite" | "pleine"; espacement?: string; children?: ReactNode })` : garde `main#contenu`, la boîte (`largeur`), `min-h-dvh flex-1 flex-col` ; `espacement` remplace `"p-4 md:p-8"` (défaut inchangé). Avec `children` : pas de centrage, `ZoneChargement` autour des enfants. Sans `children` : rendu actuel inchangé (texte visible centré), **provisoire**, supprimé en Tâche 9.
  - Tokens Tailwind `squelette` et `squelette-carte` (classes `bg-squelette`, `bg-squelette-carte`).

- [ ] **Step 1: Écrire les tests** dans `components/ui/squelette.test.tsx` :
  - `ZoneChargement` : `getByRole("status")` contient le texte « Chargement… » ; le contenu enfant est sous un ancêtre `aria-hidden="true"`.
  - `Squelette` : a les classes `bg-squelette` et `motion-safe:animate-pulse`, et pas `animate-pulse` seule ; `sur="carte"` → `bg-squelette-carte`.
  - `TexteSquelette` : rend le texte factice, avec la classe `text-transparent`.
  - `EcranChargement` avec enfants : un seul `role="status"`, `main#contenu`, classes `min-h-dvh` et `max-w-2xl` (`largeur` par défaut) ; `espacement="px-4 py-6"` remplace `p-4`.
- [ ] **Step 2:** `npx vitest run components/ui/squelette.test.tsx` → ÉCHEC (module absent).
- [ ] **Step 3: Tokens** dans `app/globals.css` : `--color-squelette: var(--color-brand-100);` et `--color-squelette-carte: var(--color-brand-50);` dans `@theme` ; dans `:root[data-theme="dark"]` : `--color-squelette-carte: var(--color-brand-200);`. `squelette` suit `brand-100`, qui est déjà redéfini en sombre. Vérifier que le bloc sombre est aussi appliqué sous `prefers-color-scheme` comme les autres tokens, en suivant le motif existant du fichier.
- [ ] **Step 4: Implémenter** `components/ui/squelette.tsx` (les trois exports ci-dessus), puis adapter `EcranChargement`.
- [ ] **Step 5:** `npx vitest run components/ui/` → VERT ; `npx tsc --noEmit` et `npx eslint components/ui` propres.
- [ ] **Step 6: Docs.**
  - `ui.md` : remplacer l'entrée « « Chargement… » d'une page = `EcranChargement` » par la coque + les primitives : règles « textes fixes en vrai / données en `TexteSquelette` / contrôles en `Squelette` », teintes `fond`/`carte`, `ZoneChargement` = une annonce, et pourquoi (CLS, lecteurs d'écran, tests qui lisent « Chargement… »).
  - `DESIGN.md` : un court paragraphe « Squelettes de chargement » (teintes, pulsation `motion-safe`, pas de délai).
- [ ] **Step 7: Commit** `feat: primitives de squelette et coque EcranChargement (#400)`.

### Task 2: Vue Semaine — `semaineLue` et `SquelettePlanning`

**Files:**
- Modify: `lib/sync.ts` (près de `hydrater`, l. ~2625, et des stores exportés)
- Modify: `lib/sync.test.ts`
- Create: `components/planning/squelette-planning.tsx`
- Create: `components/planning/squelette-planning.test.tsx`
- Modify: `components/planning/grille-jours.tsx`
- Modify: `app/planning/page.tsx` (branche état vide l. ~784, repli Suspense l. ~949)
- Modify: `.claude/rules/sync-planning.md`, `.claude/rules/ui.md` (supprimer l'entrée « **Limite connue** : `/planning` sans cache local… »)

**Interfaces:**
- Consumes : `Squelette`, `TexteSquelette`, `ZoneChargement`, `EcranChargement` (Tâche 1).
- Produces :
  - `lib/sync.ts` : `export const storeSemaineLue: { sAbonner(cb: () => void): () => void; lire(): boolean; lireServeur(): boolean }` (`lireServeur` → `false`) et `export function useSemaineLue(): boolean`. Passe à `true`, et notifie, quand `hydrater()` a fini sa première lecture, **qu'elle réussisse, échoue ou lève** (`try/finally`), et tout de suite dans la branche « le local fait foi ». Ne repasse jamais à `false` (navigation SPA : `dejaHydrate`).
  - `GrilleJours` : nouvelle prop `squelette?: boolean`. Si vraie, le libellé de jour rend `<TexteSquelette>` avec un texte factice (« Mercredi 11 novembre » en mobile, « Mer. 11 » en desktop), sans pastille « Aujourd’hui », et `dateISO` est ignoré.
  - `SquelettePlanning({ titre }: { titre: string | null }): JSX.Element` : contenu **sans** `<main>` ni padding extérieur, enveloppé dans `ZoneChargement`. Il comprend :
    - l'en-tête aux classes d'`EntetePlanning` : `h1` réel si `titre`, sinon `TexteSquelette` « Mon planning de la semaine » ; bascule, bouton réglages, « Régénérer » et « Liste de courses → » en `Squelette` de leurs tailles ;
    - `<LegendeBadges />` réelle ;
    - le navigateur de période en `Squelette` : deux `size-8 rounded-full` et un centre `h-11 min-w-[11rem] rounded-lg`, dans un `div.mb-6` ;
    - `<GrilleJours squelette>` avec 7 jours. Chaque jour porte deux `SlotSquelette`, dont le libellé « Déjeuner » / « Dîner » est réel.
  - `SlotSquelette({ libelle }: { libelle: string })`, interne au fichier : mêmes classes de carte, d'actions et de stepper que `SlotRepas` (`components/planning/slot-repas.tsx:136-248`) ; nom du plat en `TexteSquelette sur="carte"` ; chips et boutons du stepper en `Squelette sur="carte"`.

- [ ] **Step 1: Tests du store** dans `lib/sync.test.ts`, en suivant le motif du fichier (module sync rechargé vierge) :
  - `storeSemaineLue.lire()` vaut `false` avant `hydrater`, puis `true` après une lecture réussie ;
  - `true` après une lecture qui rejette (client Supabase mocké qui lève), sans propager d'état « lu » erroné ;
  - `true` immédiatement dans la branche cache local `dirty` ;
  - `lireServeur()` vaut `false`.
- [ ] **Step 2: Tests du squelette** dans `components/planning/squelette-planning.test.tsx` :
  - un seul `role="status"` ;
  - « Déjeuner » et « Dîner » présents 14 fois chacun (7 jours × grilles mobile et desktop, toutes deux dans le DOM) ;
  - `titre="Mon planning de la semaine"` → `h1` de ce texte ; `titre={null}` → aucun `heading` de niveau 1 ;
  - la légende « Végétarien » est présente.
- [ ] **Step 3:** `npx vitest run lib/sync.test.ts components/planning/squelette-planning.test.tsx` → ÉCHEC.
- [ ] **Step 4: Implémenter** `storeSemaineLue` et `useSemaineLue`, le prop `squelette` de `GrilleJours`, puis `SquelettePlanning`.
- [ ] **Step 5: Brancher la page** `app/planning/page.tsx` :
  - dans la branche Semaine, si `planning === null && !semaineLue`, rendre `<main id="contenu" className="flex-1 p-4 md:p-8"><SquelettePlanning titre="Mon planning de la semaine" /></main>` à la place de l'état vide ;
  - repli Suspense : `<main id="contenu" className="flex-1 p-4 md:p-8"><SquelettePlanning titre={null} /></main>`. La vue préférée (`vue_planning`, localStorage) n'est pas connue au prérendu, d'où le titre en barre.

  Garder l'état vide inchangé une fois la semaine lue (« Aucun planning pour cette semaine. » est lu par `auth.setup` et `planning.spec`).
- [ ] **Step 6:** `npx vitest run lib/ components/planning/ tests/` → VERT ; `npx tsc --noEmit`, `npx eslint app/planning components/planning lib/sync.ts` propres.
- [ ] **Step 7: Docs.**
  - `sync-planning.md` : entrée `storeSemaineLue` (règle, puis pourquoi : `planning === null` confondait « pas encore lu » et « vide », d'où un faux état vide sur un nouvel appareil).
  - `ui.md` : supprimer l'entrée « Limite connue ».
- [ ] **Step 8: Commit** `feat: squelette de la vue Semaine, fin du faux état vide (#400)`.

### Task 3: Vue Cycle — premier chargement

**Files:**
- Modify: `components/planning/vue-cycle.tsx` (bloc l. ~683-690)
- Test: `tests/vue-cycle-erreur.test.tsx` (lecture seule, doit rester vert) ; ajouter un cas dans le test existant de la vue Cycle s'il existe (`graphify query "tests de VuePlanningCycle"`), sinon dans `components/planning/squelette-planning.test.tsx`.

**Interfaces:**
- Consumes : `SquelettePlanning` (Tâche 2).

- [ ] **Step 1: Test** : au premier chargement (lecture du cycle en attente), la vue Cycle rend un seul `role="status"`, un `h1` « Mon planning du cycle » et « Déjeuner » 14 fois (7 jours × grilles mobile et desktop) ; une fois le cycle lu, plus aucun `role="status"`.
- [ ] **Step 2:** lancer ce test → ÉCHEC.
- [ ] **Step 3:** remplacer le `p.animate-pulse` du premier chargement par `<SquelettePlanning titre="Mon planning du cycle" />` dans le même `div.flex-1 p-4 md:p-8`. Les rechargements (`opacity-50`) ne changent pas. 7 jours dans tous les cas (décision : cas le plus probable).
- [ ] **Step 4:** `npx vitest run tests/vue-cycle-erreur.test.tsx components/planning/` → VERT.
- [ ] **Step 5: Commit** `feat: squelette du premier chargement de la vue Cycle (#400)`.

### Task 4: Ce soir

**Files:**
- Create: `components/ce-soir/squelette-ce-soir.tsx` (+ `components/ce-soir/squelette-ce-soir.test.tsx`)
- Modify: `app/ce-soir/page.tsx` (l. ~106)

**Interfaces:**
- Consumes : primitives et `EcranChargement` (Tâche 1).
- Produces : `SqueletteCeSoir(): JSX.Element`, contenu sans `<main>`. Il comprend :
  - le moment en `TexteSquelette` « Ce soir » (`text-base`) ;
  - le `h1` en `TexteSquelette` aux classes `mt-1 font-display text-3xl md:text-4xl font-semibold` ;
  - deux badges en `Squelette` (`h-6 w-16 rounded-full`) et « pour 4 personnes » en `TexteSquelette` ;
  - « Ingrédients » réel (`h2` de `ContenuRecette` variante `"cuisine"`), puis 6 lignes `min-h-11` : case `size-4` en `Squelette`, nom et quantité en `TexteSquelette` ;
  - « Préparation » réel, puis 3 étapes : pastille `size-8 rounded-full` et texte `text-lg leading-relaxed` en `TexteSquelette`, sur deux lignes environ ;
  - le pied `mt-10 border-t pt-6` : « Ensuite… » et le lien en `TexteSquelette`.

  Reprendre les libellés exacts des `h2` depuis `components/planning/contenu-recette.tsx`.

- [ ] **Step 1: Test** : un seul `role="status"`, présence des intitulés réels de `ContenuRecette`, 6 cases (`Squelette`).
- [ ] **Step 2:** ÉCHEC.
- [ ] **Step 3:** implémenter, puis remplacer dans la page `<EcranChargement />` par `<EcranChargement espacement="px-4 py-6 md:py-10"><SqueletteCeSoir /></EcranChargement>`. Ce sont les paddings du `main` chargé (l. ~197).
- [ ] **Step 4:** `npx vitest run components/ce-soir tests/` → VERT, tsc + eslint propres.
- [ ] **Step 5: Commit** `feat: squelette de la page Ce soir (#400)`.

### Task 5: Courses

**Files:**
- Create: `components/courses/squelette-courses.tsx` (+ test)
- Modify: `app/courses/page.tsx` (l. ~466 et repli Suspense l. ~822)

**Interfaces:**
- Produces : `SqueletteCourses(): JSX.Element`, contenu sans `<main>`. Il comprend :
  - l'en-tête aux classes l. ~546 : `h1` « Liste de courses » réel ; navigateur en `Squelette` comme en Tâche 2 ; « Couvre 7 j » en `TexteSquelette` et deux `size-6 rounded-full` ; progression en `TexteSquelette` ; les deux lignes `mt-1 text-xs` toujours montées gardent leur hauteur (vides) ;
  - les boutons « Ajouter un article » et « ← Planning » en `Squelette` de leur taille ;
  - 3 catégories : titre en `TexteSquelette` dans le bouton `min-h-11` (**donnée** : la liste réelle peut ne pas avoir ces catégories ; c'est un écart volontaire avec la maquette, qui les montrait en vrai), puis `ul` bordée `bg-surface` de 5, 3 et 4 lignes (`min-h-11 px-4 py-2.5`, case + nom + quantité, `sur="carte"`) ;
  - le fond de placard : `section.rounded-lg bg-accent-50 p-4`, titre « Fond de placard » réel, 3 lignes.

  Ne pas réserver la carte Panier Chronodrive (conditionnelle, sous la liste).
- [ ] **Step 1: Test** : un seul `role="status"`, `h1` « Liste de courses », « Fond de placard » réel, 15 lignes de liste.
- [ ] **Step 2:** ÉCHEC.
- [ ] **Step 3:** implémenter et brancher sur **les deux** emplacements, via `<EcranChargement><SqueletteCourses /></EcranChargement>` (boîte étroite identique au `main` chargé l. ~542).
- [ ] **Step 4:** tests de `app/courses` et `components/courses` → VERT, tsc + eslint propres.
- [ ] **Step 5: Commit** `feat: squelette de la liste de courses (#400)`.

### Task 6: Recettes

**Files:**
- Create: `components/recettes/squelette-recettes.tsx` (+ test)
- Modify: `app/recettes/page.tsx` (chargement inline l. ~353-360, repli Suspense l. ~533-541)

**Interfaces:**
- Produces : `SqueletteListeRecettes(): JSX.Element`, enveloppé dans `ZoneChargement`. Il comprend :
  - la recherche en `Squelette` `mb-3 h-10 w-full rounded-full` ;
  - la bascule de portée en `Squelette` (`mb-3 h-9 w-64 rounded-full`) ;
  - la ligne de filtres (case et select en `Squelette`) ;
  - une `ul` bordée `bg-surface` de 10 lignes aux classes l. ~466 : nom en `TexteSquelette sur="carte"`, un badge, trois boutons texte en `Squelette`.

  `min-h-dvh` est conservé sur le conteneur (règle CLS de `ui.md`).
- [ ] **Step 1: Test** : un seul `role="status"`, 10 lignes.
- [ ] **Step 2:** ÉCHEC.
- [ ] **Step 3:** implémenter.
  - **Chargement inline** : l'en-tête réel reste rendu, avec le bouton « Nouvelle recette » **actif** (décision Arnaud), et `SqueletteListeRecettes` remplace le `p.animate-pulse`.
  - **Repli Suspense** : même `main`, `h1` « Mes recettes » réel, bouton en `Squelette` (pas encore hydraté), puis `SqueletteListeRecettes`, avec `min-h-dvh` (il manquait).
- [ ] **Step 4:** tests de `app/recettes` → VERT (l'état erreur l. ~346 inchangé), tsc + eslint propres.
- [ ] **Step 5: Commit** `feat: squelette de la liste des recettes (#400)`.

### Task 7: Profil — identité, foyer, assistants connectés

**Files:**
- Create: `components/profil/squelettes-profil.tsx` (+ test)
- Modify: `components/profil/edition-identite.tsx` (l. ~28-36), `components/profil/panneau-foyer.tsx` (l. ~215-220), `components/profil/assistants-connectes.tsx` (l. ~73)

**Interfaces:**
- Produces : `SqueletteIdentite()`, `SqueletteFoyer()`, `SqueletteAssistants()`. Chacun est une `ZoneChargement as="section"` qui garde le `h2` réel de son composant (même `id`, même classe).
  - Identité : `mb-8 min-h-[15.4rem] md:min-h-[13rem]`, avatar `size-20 rounded-full`, champ et bouton `rounded-full`, 8 pastilles `size-9 rounded-full`.
  - Foyer : `mb-8 min-h-[33.6rem] md:min-h-[30.6rem]`, phrase en `TexteSquelette`, deux cartes `rounded-2xl border p-4 bg-surface` aux contrôles en `Squelette sur="carte"`.
  - Assistants : deux lignes de la hauteur d'une ligne chargée de `ul.flex flex-col gap-3`.
- [ ] **Step 1: Test** : chaque squelette a un `role="status"`, son `h2` réel, et les classes `min-h-[15.4rem]` et `min-h-[33.6rem]` (Review Focus 5).
- [ ] **Step 2:** ÉCHEC.
- [ ] **Step 3:** implémenter et remplacer les trois états de chargement.
- [ ] **Step 4:** tests `components/profil` → VERT, tsc + eslint propres.
- [ ] **Step 5: Commit** `feat: squelettes des blocs différés du profil (#400)`.

### Task 8: Réglages

**Files:**
- Modify: `app/reglages/page.tsx` (retour anticipé l. ~198 et sections l. ~295-505)
- Test: test existant de `/reglages` (`graphify query "tests de la page reglages"`) ou nouveau `app/reglages/page.test.tsx`

**Interfaces:**
- Consumes : primitives (Tâche 1).

- [ ] **Step 1: Test** : pendant le chargement (lecture des réglages en attente), un seul `role="status"`, et les cinq titres réels sont présents : « Temps de préparation maximum », « Privilégier les repas végétariens », « Équilibre des accompagnements », « Recettes de saison », et le titre de la section `id="section-personnes"`. Aucun interrupteur (`role="switch"`) n'est encore rendu.
- [ ] **Step 2:** ÉCHEC.
- [ ] **Step 3:** supprimer le retour anticipé. Les cinq cartes et leurs libellés sont rendus **une seule fois** (pas de copie des textes dans un fichier de squelette). Chaque contrôle est remplacé par un `Squelette sur="carte"` de sa taille tant que les réglages ne sont pas lus : segment `h-9 w-48 rounded-full`, interrupteur `h-6 w-11 rounded-full`, stepper. Les compteurs (« N repas ») passent en `TexteSquelette`. Toute la zone sous le `h1` est une `ZoneChargement` pendant le chargement ; les boutons d'action restent masqués jusqu'au chargement. L'état erreur est inchangé.
- [ ] **Step 4:** tests → VERT, tsc + eslint propres.
- [ ] **Step 5: Commit** `feat: squelette des réglages de génération (#400)`.

### Task 9: Finalisation — coque stricte, spécifications, vérification

**Files:**
- Modify: `components/ui/ecran-chargement.tsx` (`children` devient obligatoire, rendu texte visible supprimé)
- Modify: `SPECS_FONCTIONNELLES.md` (RG-09, l. ~1147), `CHANGELOG.md` (`[Unreleased]` › `### Modifié`)

- [ ] **Step 1:** rendre `children` obligatoire. `npx tsc --noEmit` doit passer : toute page non migrée casserait ici.
- [ ] **Step 2:** `grep -rn "Chargement…" app components --include=*.tsx`. Seules les occurrences hors périmètre (`/bienvenue`, `/oauth`) et le texte `sr-only` de `ZoneChargement` restent visibles.
- [ ] **Step 3: RG-09** : préciser que l'état *Loading* d'un écran est un squelette calqué sur l'état chargé, annoncé aux lecteurs d'écran, et qu'un écran ne montre jamais son état vide avant d'avoir lu ses données. **CHANGELOG** : une entrée utilisateur (« Pendant le chargement, les pages affichent leur silhouette… », sans jargon), citant #400.
- [ ] **Step 4:** `npm run test:run` → VERT ; `npx eslint .` propre.
- [ ] **Step 5: E2E staging** :
  - `npm run test:e2e:staging -- coherence-semaine-cycle edition-vue-cycle reglages foyer planning --retries=2`
  - `npm run test:e2e:staging -- courses prochain-repas recettes profil --retries=2`

  Noms de specs à confirmer par `ls e2e`. Tout échec : investiguer avant de continuer (règle « pas de push sur rouge connu », timebox 1 h).
- [ ] **Step 6: Captures de contrôle** en dev, réseau bridé (Playwright `route` qui retarde les appels Supabase de ~2 s, script jetable hors dépôt). Pour chaque écran : squelette puis chargé, 390 px et 1280 px, clair et sombre. Comparer à la maquette. Signaler tout écart à l'humain, sinon joindre à la PR.
- [ ] **Step 7: Commit** `docs: RG-09 et changelog des squelettes de chargement (#400)`, puis `graphify update .`.
