# Onboarding calé sur le cycle de courses (#386) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le tunnel `/bienvenue` demande les midis de semaine et (en solo) le jour de courses, puis génère le premier **cycle** de courses à partir d'aujourd'hui et ouvre `/planning` en vue Cycle ; `ancreParDefaut` passe à la règle « ≤ 2 jours restants → cycle suivant ».

**Architecture :** la logique pure (filtre des jours passés, réglages initiaux, URL de sortie) vit dans un nouveau `lib/onboarding.ts` testé par Vitest ; la page `/bienvenue` l'orchestre et réutilise `appliquerGenerationCycle` (`lib/sync.ts`) déjà employé par « Générer mon cycle ». Le sélecteur de jour de `PanneauFoyer` est extrait en composant partagé. Le correctif d'`ancreParDefaut` est isolé dans son propre commit car il touche `/courses`, la vue Cycle, le MCP et le panier Chronodrive.

**Tech Stack :** Next.js 16 (App Router), React, Supabase, Tailwind v4, Vitest, Playwright, sonner.

**Spec :** issue GitHub #386 (décisions du grilling du 2026-11-07). Règles à lire : `.claude/rules/foyer-compte.md`, `courses-cycle.md`, `sync-planning.md`, `e2e.md`, `ui.md`, `aide-notion.md`.

## Global Constraints

- Branche `feat/386-onboarding-cycle` depuis `main` à jour ; **un commit par tâche**, une seule PR, un seul push (minutes CI).
- Tout en français (identifiants, commentaires, UI) ; apostrophe typographique `’` dans le texte JSX ; commentaires citent `US-23`, `RG-90`, `RG-91`, `#386`.
- Libellés exacts :
  - écran 1, sous-titre : « Quelques questions pour calibrer ton premier planning. »
  - interrupteur : « On mange à la maison le midi en semaine » ; description : « Désactivé, pas de déjeuner prévu du lundi au vendredi (ajustable dans les réglages). »
  - écran 3, titre : « Tu fais tes courses quel jour ? » ; sous-titre : « Ta liste couvrira les 7 jours suivants. Tu pourras le changer dans ton profil. » ; bouton : « Générer mon planning »
  - toast d'arrivée : « Ta liste de courses est prête », action « Voir » → `/courses`
  - barre : « Étape X sur 3 » (la branche « rejoindre » s'arrête à 2)
- Jour de courses présélectionné : **6 (samedi)**. Longueur du premier cycle : `LONGUEUR_DEFAUT` (7).
- Interrupteur midi **activé** par défaut ; désactivé → `plafonds.dejeunerSemaine = "aucun"` (les 3 autres plafonds restent ceux de `REGLAGES_DEFAUT`).
- « Aujourd'hui » = date **locale du navigateur** (`new Date()`), comme `hydraterCycle` de `/courses`.
- Préférence `vue_planning = "cycle"` posée pour **tout** nouvel inscrit (solo et rejoindre).
- Aucun changement de schéma SQL, de route API ni du serveur MCP.

## Review Focus

1. **Génération échouée (429, réseau, catalogue vide)** : l'onboarding se termine quand même, mais la redirection se fait **sans** `?bienvenue=1` (pas de toast « liste prête » mensonger) → test `urlFinOnboarding` (Task 3).
2. **Reprise du tunnel après rechargement** : l'interrupteur midi est pré-rempli depuis les réglages déjà enregistrés (`dejeunerSemaine === "aucun"` → désactivé) → test `midiSemaineDepuisReglages` (Task 3).
3. **Cycle par défaut entièrement futur** (cas « ≤ 2 jours restants », ex. inscription un jeudi avec jour de courses samedi) : le filtre ne retire rien et ne renvoie jamais de liste vide → test `joursAPartirDe` (Task 3).
4. **Inscription le jour même du jour de courses** : le cycle commence aujourd'hui et couvre 7 jours, aucun jour filtré → cas `recul 0` de la table `ancreParDefaut` (Task 1) + test `joursAPartirDe` (Task 3).
5. **Double clic sur « Générer mon planning » / « Suivant »** : une seule génération ; le bouton est désactivé et l'étape passe à `generation` avant tout `await` → garde `enCours` vérifiée en revue (Task 4) ; l'e2e (Task 5) clique une seule fois et attend un unique `/planning`.

Note acceptée (non testée) : pour un jour de courses ≠ lundi, la génération en vue **Semaine** du week-end (`semaineParDefaut`, inchangée) n'est plus forcément couverte par le cycle par défaut de `/courses` ; c'était déjà partiel avant. À documenter dans `courses-cycle.md` (Task 6).

---

### Task 1 : `ancreParDefaut` — règle « ≤ 2 jours restants » (RG-91)

**Files :**
- Modify : `lib/cycles.ts:42-67` (`ancreParDefaut` + son commentaire)
- Modify : `lib/semaines.ts:~150-157` (commentaire « règle du jumeau » : la règle n'est plus identique hors lundi)
- Test : `tests/cycles.test.ts:31-48` (bloc `describe("ancreParDefaut")`)

**Interfaces :**
- Produces : `ancreParDefaut(aujourdhui: Date, jourCourses: number): string` (signature inchangée) ; `export const JOURS_RESTANTS_BASCULE = 2` dans `lib/cycles.ts`.

- [ ] **Step 1 : Remplacer les 3 tests existants par une table** (semaine du lundi 6 au dimanche 12 juillet 2026, heure 10:00 locale) :

```ts
describe("ancreParDefaut (RG-91 : ≤ 2 jours restants → cycle suivant)", () => {
  const jours = ["06", "07", "08", "09", "10", "11", "12"] // lun → dim
  const attendus: Record<number, string[]> = {
    1: ["07-06", "07-06", "07-06", "07-06", "07-06", "07-13", "07-13"], // lundi : inchangé
    4: ["07-02", "07-09", "07-09", "07-09", "07-09", "07-09", "07-09"], // jeudi
    6: ["07-04", "07-04", "07-04", "07-11", "07-11", "07-11", "07-11"], // samedi
  }
  for (const [jourCourses, ancres] of Object.entries(attendus)) {
    jours.forEach((j, i) => {
      it(`jour de courses ${jourCourses}, le 2026-07-${j} → 2026-${ancres[i]}`, () => {
        expect(ancreParDefaut(new Date(`2026-07-${j}T10:00:00`), Number(jourCourses))).toBe(`2026-${ancres[i]}`)
      })
    })
  }
})
```

- [ ] **Step 2 : Lancer** `npx vitest run tests/cycles.test.ts` → FAIL sur jeudi (sam./dim. → `07-16` au lieu de `07-09`), samedi (sam. → `07-18`, dim. → `07-18`, jeu./ven. → `07-04`).
- [ ] **Step 3 : Implémenter.** `recul` = jours écoulés depuis `ancreCourante` (même formule que `ancreCourante`) ; restants = `7 - recul` (cadence de 7 jours, longueur étirée ignorée comme avant) ; si `restants <= JOURS_RESTANTS_BASCULE` → `cycleDecale(ancre, 1)`. Réécrire le commentaire (citer RG-91, #386, et l'ancien bug samedi/dimanche).
- [ ] **Step 4 : Audit des consommateurs** (règle du jumeau, CLAUDE.md) : `npx vitest run` complet ; vérifier en particulier `app/api/panier/demande/route.test.ts`, `components/courses/panier-chronodrive.test.tsx`, `tests/ancre-initiale-cycle.test.ts`, `lib/sync.test.ts`, et tout test MCP (`grep -rln "ancreParDefaut\|ancreCycle\|resoudreCycle" lib app tests`). Corriger un test seulement s'il figeait l'ancien décalage week-end pour un jour ≠ lundi (le justifier dans le commit).
- [ ] **Step 5 : Commit** `fix: ancre de cycle par défaut selon les jours restants, plus le week-end (#386)`.

---

### Task 2 : Extraire `SelecteurJourCourses`

**Files :**
- Create : `components/ui/selecteur-jour-courses.tsx`
- Modify : `components/profil/panneau-foyer.tsx:58-68` (supprimer `JOURS_SEMAINE`) et `:261-288` (remplacer le JSX)
- Test : `components/ui/selecteur-jour-courses.test.tsx`

**Interfaces :**
- Produces :
  - `export const JOURS_SEMAINE: readonly { valeur: number; lettre: string; nom: string }[]` (déplacé tel quel, 1 = lundi … 7 = dimanche)
  - `export function SelecteurJourCourses(props: { valeur: number | null; onChange: (jour: number, nom: string) => void; desactive?: boolean; libelle?: string }): JSX.Element` — `role="radiogroup"`, `aria-label={libelle ?? "Jour de courses"}`, boutons `role="radio"` + `aria-checked` + `aria-label={nom}`, classes reprises à l'identique de `PanneauFoyer`.

- [ ] **Step 1 : Test** (Testing Library, comme les autres `*.test.tsx`) :
  - `it("coche le jour courant")` : `valeur={6}` → `getByRole("radio", { name: "samedi" })` a `aria-checked="true"`, les 6 autres `"false"`.
  - `it("signale le jour choisi")` : clic sur « jeudi » → `onChange` appelé avec `(4, "jeudi")`.
  - `it("désactivé, ne signale rien")` : `desactive` → boutons `disabled`, clic sans appel.
- [ ] **Step 2 :** `npx vitest run components/ui/selecteur-jour-courses.test.tsx` → FAIL (module absent).
- [ ] **Step 3 :** créer le composant ; `PanneauFoyer` l'utilise avec `valeur={etat.jourCourses}` et `onChange={choisirJourCourses}`.
- [ ] **Step 4 :** `npx vitest run components/ui components/profil` → PASS.
- [ ] **Step 5 : Commit** `refactor: sélecteur de jour de courses partagé (#386)`.

---

### Task 3 : Logique pure de l'onboarding (`lib/onboarding.ts`)

**Files :**
- Create : `lib/onboarding.ts`
- Test : `tests/onboarding.test.ts`

**Interfaces :**
- Consumes : `ancreParDefaut`, `LONGUEUR_DEFAUT` (`lib/cycles.ts`), `lundiDeSemaine` (`lib/semaines.ts`), `versISO` (`lib/dates-iso.ts`), `ORDRE_JOURS` (`lib/generateur.ts`), `REGLAGES_DEFAUT` (`lib/reglages.ts`), types `SemaineGeneree`, `ReglagesGeneration`.
- Produces :
  - `export const JOUR_COURSES_PROPOSE = 6`
  - `export const PARAM_BIENVENUE = "bienvenue"`
  - `export type SaisieOnboarding = { personnes: number; vege: boolean; midiSemaine: boolean }`
  - `export function reglagesInitiaux(saisie: SaisieOnboarding): ReglagesGeneration` — reprend `reglagesSaisis()` de la page (végé = semaine seulement) + `plafonds.dejeunerSemaine = "aucun"` si `!midiSemaine`.
  - `export function midiSemaineDepuisReglages(r: ReglagesGeneration | null): boolean` — `true` si `r` nul ou `r.plafonds.dejeunerSemaine !== "aucun"`.
  - `export function joursAPartirDe(semaines: SemaineGeneree[], aujourdhuiISO: string): SemaineGeneree[]` — garde les jours dont la date (lundi de la semaine + rang dans `ORDRE_JOURS`) est ≥ `aujourdhuiISO` ; retire les semaines devenues vides.
  - `export function premierCycle(aujourdhui: Date, jourCourses: number): { ancre: string; longueur: number }` — `{ ancre: ancreParDefaut(aujourdhui, jourCourses), longueur: LONGUEUR_DEFAUT }`.
  - `export function urlFinOnboarding(r: { solo: boolean; generationReussie: boolean }): string` — `"/planning?bienvenue=1"` si solo et génération réussie, sinon `"/planning"`.

- [ ] **Step 1 : Tests** (`describe` par fonction) :
  - `reglagesInitiaux({ personnes: 4, vege: false, midiSemaine: false })` → `plafonds` = `{ ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" }`, `personnesDefaut` 4, pas de `vegetarienPrefere`.
  - `reglagesInitiaux({ personnes: 2, vege: true, midiSemaine: true })` → `plafonds` identiques à `REGLAGES_DEFAUT.plafonds` ; `vegetarienPrefere` = `{ dejeunerSemaine: true, dinerSemaine: true, dejeunerWeekend: false, dinerWeekend: false }`.
  - `midiSemaineDepuisReglages(null)` → `true` ; avec `dejeunerSemaine: "aucun"` → `false` ; avec `"normal"` → `true`.
  - `joursAPartirDe` : cycle samedi 4 → vendredi 10 juillet 2026 (semaines `2026-W27` [samedi, dimanche] et `2026-W28` [lundi…vendredi]), `aujourdhuiISO = "2026-07-08"` → une seule semaine `2026-W28` avec `mercredi, jeudi, vendredi`.
  - `joursAPartirDe` même entrée, `aujourdhuiISO = "2026-07-04"` → entrée inchangée (Review Focus 4).
  - `joursAPartirDe` même entrée, `aujourdhuiISO = "2026-07-02"` (cycle entièrement futur) → entrée inchangée, jamais `[]` (Review Focus 3).
  - `premierCycle(new Date("2026-07-09T10:00:00"), 6)` → `{ ancre: "2026-07-11", longueur: 7 }`.
  - `urlFinOnboarding` : 4 combinaisons ; seule `{ solo: true, generationReussie: true }` → `"/planning?bienvenue=1"` (Review Focus 1).
- [ ] **Step 2 :** `npx vitest run tests/onboarding.test.ts` → FAIL (module absent).
- [ ] **Step 3 :** implémenter `lib/onboarding.ts` (pur, sans import client Supabase).
- [ ] **Step 4 :** `npx vitest run tests/onboarding.test.ts` → PASS.
- [ ] **Step 5 : Commit** `feat: logique pure du premier cycle d'onboarding (#386)`.

---

### Task 4 : Tunnel `/bienvenue` en 3 étapes + toast d'arrivée

**Files :**
- Modify : `app/bienvenue/page.tsx` (tout le flux)
- Modify : `app/planning/page.tsx:~283-310` (lecture/retrait de `?bienvenue=1`, toast)

**Interfaces :**
- Consumes : Task 2 (`SelecteurJourCourses`), Task 3 (toutes les exportations) ; `definirJourCoursesFoyer(jour: number): Promise<void>` (`lib/foyer.ts:92`) ; `appliquerGenerationCycle(ancre: string, semaines: SemaineGeneree[]): Promise<void>` (`lib/sync.ts:2000`) ; `storeVuePlanning.ecrire("cycle")` (`lib/stockage.ts:90`).

- [ ] **Step 1 : Écran 1.** `type Etape = "chargement" | "identite" | "foyer" | "courses" | "generation"`. Nouvel état `midiSemaine` (défaut `true`, pré-rempli par `midiSemaineDepuisReglages(reglages)` au chargement). Interrupteur `Interrupteur` sous le végé, libellés des Global Constraints. `validerIdentite` enregistre `reglagesInitiaux({ personnes, vege, midiSemaine })` (supprimer `reglagesSaisis`). Nouveau sous-titre.
- [ ] **Step 2 : Barre.** `BarreProgression({ etape: 1 | 2 | 3 })`, texte « Étape {etape} sur 3 », 3 segments ; `identite` = 1, `foyer` = 2, `courses` = 3.
- [ ] **Step 3 : Écran 2.** « Démarrer seul·e » → `setEtape("courses")` (plus de génération ici). Branche « rejoindre » : inchangée hormis `finaliserRejoindre()` = `reinitialiserCacheFoyer()` → `marquerOnboardingComplete()` → `storeVuePlanning.ecrire("cycle")` → `window.location.assign(urlFinOnboarding({ solo: false, generationReussie: false }))`. L'échec du marquage garde le comportement #167 (toast, retour à `foyer`).
- [ ] **Step 4 : Écran 3 (`courses`).** État `jourCourses` initialisé à `JOUR_COURSES_PROPOSE`, `SelecteurJourCourses` (`onChange={(j) => setJourCourses(j)}`), libellés des Global Constraints, bouton « Générer mon planning » → `demarrerSolo()` :
  1. garde `enCours`, puis `setEnCours(true)` et `setEtape("generation")` **avant** tout `await` (Review Focus 5) ;
  2. `definirJourCoursesFoyer(jourCourses)` ; en cas d'échec : `toast.error(message)`, `setEtape("courses")`, `setEnCours(false)`, arrêt ;
  3. `const { ancre, longueur } = premierCycle(new Date(), jourCourses)` ; `fetch("/api/planning/generer", { body: { ancre, longueur } })` ; si `ok` : `appliquerGenerationCycle(ancre, joursAPartirDe(semaines, versISO(new Date())))` ; toute erreur de cette étape est `console.error`-ée et donne `generationReussie = false` (on continue) ;
  4. `marquerOnboardingComplete()` (échec → comportement #167 : toast, retour à `courses`) ;
  5. `storeVuePlanning.ecrire("cycle")` puis `window.location.assign(urlFinOnboarding({ solo: true, generationReussie }))`.
- [ ] **Step 5 : `/planning`.** Lire `paramsUrl.has(PARAM_BIENVENUE)` une fois (état lazy, comme `PARAM_LIEN_CYCLE`) ; l'ajouter au `replaceState` existant ; si présent, au montage : `toast.success("Ta liste de courses est prête", { action: { label: "Voir", onClick: () => router.push("/courses") } })` (une seule fois, garde `useRef` contre le double montage en dev).
- [ ] **Step 6 :** `npm run lint`, `npx tsc --noEmit`, `npm run test:run` → verts.
- [ ] **Step 7 : Commit** `feat: onboarding — midis, jour de courses et premier cycle (#386)`.

---

### Task 5 : E2E `onboarding.spec`

**Files :**
- Modify : `e2e/onboarding.spec.ts`

**Interfaces :**
- Consumes : `ancreParDefaut`, `datesCycle` (`lib/cycles.ts`) ; `lireReglagesDistants` (`e2e/helpers.ts:419`) ; libellés Task 4.

- [ ] **Step 1 : Test 1 (« le tunnel mène un nouvel inscrit à un premier cycle »).** Après « Démarrer seul·e » : `getByText("Étape 3 sur 3")` visible ; `getByRole("radio", { name: "samedi" })` a `aria-checked="true"` ; clic « Générer mon planning » ; `waitForURL("**/planning", { timeout: 60_000 })` (l'URL est nettoyée) ; toast « Ta liste de courses est prête » visible ; vue Cycle active et libellé `datesCycle(ancreParDefaut(new Date(), 6), 7)` visible (même assertion que `e2e/lien-cycle.spec.ts:95`) ; avatar « Profil de Camille » visible. Remplacer l'assertion `main ul > li` = 7 (vue Semaine) par celles-ci.
- [ ] **Step 2 : Test 2 (calibration RG-37).** Ajouter un clic sur `getByRole("switch", { name: "On mange à la maison le midi en semaine" })` ; après génération : `reglages?.max_dejeuner_semaine` = `"aucun"` en plus des assertions existantes ; dans la vue Cycle, aucun créneau « Déjeuner » rempli sur un jour du lundi au vendredi (sélecteur à caler sur la grille de `components/planning/vue-cycle.tsx`).
- [ ] **Step 3 :** `npm run test:e2e:staging -- e2e/onboarding.spec.ts` → PASS ; puis `npm run test:e2e:staging -- e2e/onboarding.spec.ts e2e/acquisition.spec.ts e2e/rgpd-signup.spec.ts e2e/oauth-mcp.spec.ts e2e/cycle-courses.spec.ts e2e/lien-cycle.spec.ts e2e/planning-grille.spec.ts e2e/panier-demande.spec.ts e2e/courses.spec.ts --retries=2` → PASS. Rouge sans lien évident : appliquer `pas-de-push-sur-rouge-connu` (timebox ≈ 1 h).
- [ ] **Step 4 : Commit** `test: e2e onboarding sur le premier cycle (#386)`.

---

### Task 6 : Specs, règles, changelog, aide

**Files :**
- Modify : `SPECS_FONCTIONNELLES.md` — US-23 (l. 494-514) ; nouvelles RG-90 et RG-91 après RG-89 (l. ~1042) ; renvoi depuis RG-36/RG-37 (l. ~1379)
- Modify : `.claude/rules/foyer-compte.md` (section « Tunnel d'onboarding »), `.claude/rules/courses-cycle.md:27` (règle de l'ancre + note de la Review Focus)
- Modify : `CHANGELOG.md` (`[Unreleased]`)
- Create (hors repo) : brouillons Markdown d'aide dans le scratchpad

- [ ] **Step 1 : SPECS.** US-23 : écran 1 (midis), écran 2, écran 3 solo (jour de courses → premier cycle → `/planning` vue Cycle + toast), branche rejoindre. **RG-90** : fenêtre du premier planning = `ancreParDefaut(aujourd'hui, jour)`, 7 jours, jours < aujourd'hui non générés, vue Cycle, toast seulement si génération réussie. **RG-91** : ancre par défaut = cycle suivant s'il reste ≤ 2 jours dans le cycle courant ; s'applique à `/courses`, vue Cycle, lien profond, MCP, panier.
- [ ] **Step 2 : Règles.** `foyer-compte.md` : trois écrans, `lib/onboarding.ts`, `SelecteurJourCourses`, `?bienvenue=1`. `courses-cycle.md:27` : remplacer « le week-end, elle avance d'un cycle » par la règle RG-91 et la note de désalignement Semaine/Cycle hors lundi. Format : la règle, puis une ligne de pourquoi.
- [ ] **Step 3 : CHANGELOG** (`[Unreleased]`, ton utilisateur) — *Modifié* : accueil des nouveaux inscrits (midis, jour de courses, premier cycle à partir d'aujourd'hui, vue Cycle) ; *Corrigé* : avec un jour de courses le samedi ou le dimanche, la liste et la vue Cycle affichaient le week-end le cycle de la semaine suivante.
- [ ] **Step 4 : Aide Notion.** Le `NOTION_TOKEN` est en lecture seule (mémoire `notion-mcp-indisponible`) : rédiger avec la skill `ecrire-comme-arnaud` deux brouillons Markdown complets dans le scratchpad — « Démarrer » (nouvelles questions, premier cycle, vue Cycle, toast, coquille `**Planning **` corrigée, section 5 « cycle de courses » au lieu de « la semaine ») et « Cycle de courses » (l. 45 : la vue Cycle du planning existe ; règle des 2 jours restants). Les remettre à Arnaud avec leurs propriétés Notion ; après publication par lui : `npm run pull:aide` et commit des `content/aide/*.md`.
- [ ] **Step 5 :** `graphify update .`
- [ ] **Step 6 : Commit** `docs: specs, règles et changelog de l'onboarding cycle (#386)` (+ commit `docs: aide…` après le pull).

---

### Clôture

- [ ] `npm run test:run`, `npm run lint`, `npx tsc --noEmit` verts ; e2e de la Task 5 verts sur staging.
- [ ] Un seul push, PR « Onboarding calé sur le cycle de courses (#386) » (`Closes #386`), attendre `gh pr checks <n> --watch` ; merge seulement sur CI verte.
