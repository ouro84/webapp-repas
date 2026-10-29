# Vue Cycle optimiste (#301) — plan d'implémentation

> **Pour les agents :** sous-compétence REQUISE : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases (`- [ ]`) pour le suivi.

**Objectif :** une édition en vue Cycle (changer, sélectionner, personnes, restes, annuler) s'affiche immédiatement, sans démonter la grille ; la sauvegarde part en arrière-plan, une seule écriture distante par édition.

**Architecture :** l'état local `parSemaine` de `VuePlanningCycle` est patché tout de suite par une fonction pure (`remplacerJourDansSemaines`, `lib/cycles.ts`). Les écritures passent par une file par jour (`creerFileEcritureSlots`, nouveau `lib/file-ecriture-slots.ts`) : débounce paramétrable (0 ms pour les actions ponctuelles, 800 ms pour le stepper), une seule écriture en vol par `(semaine, jour)`, retour à l'état confirmé en cas d'échec. Le `chargerCycle` post-édition disparaît. Dans `modifierSlotDistant`, le patch de `storePlanning` passe sous la garde `hydratationEnCours`, ce qui supprime le `sauvegarder_planning` redondant.

**Stack :** Next.js 16 / React (`useState`, `useEffect`), Vitest + jsdom (`vi.useFakeTimers`), Playwright (`page.route`).

**Spec :** issue GitHub #301 (`gh issue view 301`) : cause, correctif attendu, critères d'acceptation. Arbitrée en grilling le 2026-10-29. Le design n'est pas rouvert.

## Contraintes globales

- Code, identifiants, commentaires et messages en français. Les commentaires citent les règles concernées : US-07 (personnes), US-09/RG-19 (undo), US-21 (alerte), US-49/RG-57 (vue Cycle), RG-24 (jour passé), #301.
- Apostrophe typographique `’` dans le texte JSX.
- Branche `fix/301-vue-cycle-optimiste`, aucun commit sur `main`. Commits `type: description` avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Jamais `npm run test:e2e` en local** (`.env.local` pointe la prod). Seul `npm run test:e2e:staging` est autorisé.
- Délai du stepper : `800` ms, aligné sur `DELAI_DEBOUNCE_MS` de `lib/sync.ts` (le push de la vue Semaine).
- Message d'échec, repris tel quel de l'existant : `"Impossible d'enregistrer la modification. Réessaie."`.
- « Générer mon cycle » et la navigation ‹ › gardent leur `setChargement(true)` / « Chargement… ».
- Ne pas toucher aux épopées #302 et #303.

## Points d'attention en revue

1. **Rafale de stepper puis navigation ‹ › ou « Générer mon cycle » avant la fin des 800 ms.** On attend que l'écriture soit en base avant que la relecture ou la génération démarre ; sinon une écriture tardive écraserait le cycle généré. Couvert par Tâche 2 (test `vider()`) et Tâche 3 (`await file.vider()` avant `chargerCycle` et `genererCycle`).
2. **Clics « + » sur le déjeuner puis sur le dîner du même jour, dans la même rafale.** Les deux changements doivent être écrits : un seul `JourPlanning` combiné, la dernière valeur l'emporte. Couvert par Tâche 2 (test « la dernière valeur de la rafale part »). Le jour complet est reconstruit depuis `parSemaine` déjà patché.
3. **Échec après une rafale : on revient à la valeur d'avant la rafale, pas à une valeur intermédiaire.** Couvert par Tâche 2 (test « échec ») et Tâche 4 (e2e réseau coupé).
4. **« Annuler » cliqué pendant que l'écriture initiale est encore en vol.** Il ne faut pas deux RPC concurrentes sur la même clé dont l'ordre d'arrivée serait aléatoire. Couvert par Tâche 2 (test « sérialisation par jour »).
5. **Édition en vue Cycle d'un jour de la semaine affichée en vue Semaine.** Le cache `storePlanning` est patché sans `planning_dirty` ni `sauvegarder_planning`, et l'anti-écho US-21 (`planning_courant_maj`) reste posé. Couvert par Tâche 1 (test sync) et Tâche 4 (compteur de `sauvegarder_planning` = 0).

---

### Tâche 0 : branche

- [ ] **Étape 1 : créer la branche depuis `main` à jour**

```bash
git checkout main && git pull && git checkout -b fix/301-vue-cycle-optimiste
```

Résultat attendu : `Switched to a new branch 'fix/301-vue-cycle-optimiste'`. Le fichier de ce plan part dans le premier commit.

---

### Tâche 1 : supprimer la double écriture dans `modifierSlotDistant` (règle du jumeau)

**Fichiers :**
- Modifier : `lib/sync.ts:1541-1558` (`modifierSlotDistant`)
- Test : `lib/sync.test.ts` (dans le `describe("modifierSlotDistant — …")` existant, l.249)

**Interfaces :**
- Produit : `modifierSlotDistant(semaine: string, jourPlanning: JourPlanning): Promise<void>`. La signature ne change pas. Elle n'appelle plus `planifierPush` : pas de `planning_dirty`, pas de `sauvegarder_planning`.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
it("patche storePlanning SANS planifier de push sauvegarder_planning (pas de double écriture, #301)", async () => {
  const { semaineParDefaut } = await import("@/lib/semaines");
  const semaine = semaineParDefaut();
  persistance.chargerPlanningDistant.mockResolvedValue({
    planning: { semaine, jours: [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })] },
    updatedAt: "2026-07-16T10:00:00.000Z",
  });
  persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T15:00:00.000Z");
  const { useSync, modifierSlotDistant } = await chargerSync();
  const { renderHook } = await import("@testing-library/react");
  renderHook(() => useSync()); // abonne planifierPush à storePlanning
  await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));

  await modifierSlotDistant(semaine, jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }));

  expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].diner.id).toBe("nouveau");
  expect(localStorage.getItem("planning_courant_maj")).toBe("2026-07-16T15:00:00.000Z"); // anti-écho US-21
  expect(localStorage.getItem("planning_dirty")).toBeNull();
  await new Promise((r) => setTimeout(r, 900)); // > DELAI_DEBOUNCE_MS (800)
  expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run lib/sync.test.ts -t "double écriture"`
Attendu : FAIL. `planning_dirty` vaut `"1"`, ou `sauvegarderPlanningDistant` a été appelé.

- [ ] **Étape 3 : implémenter**

Dans `modifierSlotDistant`, entourer `storePlanning.ecrire(...)` de `hydratationEnCours = true; try { … } finally { hydratationEnCours = false; }`, sur le modèle de `chargerSemaineDansCache`. La notification du store est synchrone, donc `planifierPush` voit la garde. Mettre à jour la JSDoc : la base est déjà à jour via `sauvegarder_slots`, un push de toute la semaine serait redondant (#301). Une édition locale déjà en attente (`planning_dirty`) garde son propre minuteur et repoussera la semaine patchée.

- [ ] **Étape 4 : audit du jumeau**

Commande : `grep -n "storePlanning\.\(ecrire\|effacer\)" lib/*.ts`
Attendu, aucune autre modification nécessaire :
- `lib/stockage.ts:99/109/181` : chemin vue Semaine. Le push est voulu (une seule écriture, `sauvegarder_planning`).
- `lib/sync.ts:92` : `reinitialiserCacheFoyer`.
- `lib/sync.ts:1367/1370` : déjà sous garde.
- `lib/sync.ts:1555` : la ligne corrigée.

Noter le résultat dans le corps de la PR.

- [ ] **Étape 5 : vérifier le passage**

Commande : `npx vitest run lib/sync.test.ts`
Attendu : PASS, y compris les deux tests `modifierSlotDistant` existants.

- [ ] **Étape 6 : commit**

```bash
git add docs/superpowers/plans/2026-10-29-vue-cycle-optimiste.md lib/sync.ts lib/sync.test.ts
git commit -m "fix: modifierSlotDistant ne déclenche plus de sauvegarder_planning redondant (#301)"
```

---

### Tâche 2 : logique pure (patch local + file d'écriture par jour)

**Fichiers :**
- Modifier : `lib/cycles.ts` (ajout d'une fonction)
- Créer : `lib/file-ecriture-slots.ts`
- Test : `tests/cycles.test.ts` (ajout), `lib/file-ecriture-slots.test.ts` (nouveau)

**Interfaces :**
- Produit (`lib/cycles.ts`) :
  `remplacerJourDansSemaines(parSemaine: ReadonlyMap<string, Planning>, semaine: string, jour: JourPlanning): Map<string, Planning>`.
  Renvoie une nouvelle Map où le `JourPlanning` de même `jour` est remplacé dans le planning de `semaine`. L'entrée n'est jamais mutée. Si la semaine est absente ou si le jour n'y figure pas, renvoie une copie au contenu identique.
- Produit (`lib/file-ecriture-slots.ts`) :
  ```ts
  export const DELAI_STEPPER_MS = 800;
  export type FileEcritureSlots = {
    planifier(semaine: string, jour: JourPlanning, options: { delaiMs: number; precedent: JourPlanning }): void;
    vider(): Promise<void>;
  };
  export function creerFileEcritureSlots(deps: {
    ecrire: (semaine: string, jour: JourPlanning) => Promise<void>;
    surEchec: (semaine: string, jourConfirme: JourPlanning, erreur: unknown) => void;
  }): FileEcritureSlots;
  ```
  Sémantique, par clé `${semaine}|${jour.jour}` :
  - Le premier `planifier` d'une rafale mémorise `precedent` comme **état confirmé** ; les suivants l'ignorent.
  - Chaque `planifier` remplace la valeur en attente et relance le minuteur. `delaiMs: 0` déclenche l'envoi immédiatement, sans timer.
  - Au plus une écriture en vol par clé. Si une valeur attend quand le minuteur expire pendant un vol, elle part au retour de ce vol.
  - Succès sans rien en attente : l'entrée est oubliée. Succès avec une valeur en attente : la valeur écrite devient l'état confirmé.
  - Échec : le minuteur et la valeur en attente sont abandonnés, puis `surEchec(semaine, étatConfirmé, erreur)` est appelé et l'entrée oubliée.
  - `vider()` déclenche tout de suite les minuteurs en cours et se résout quand plus rien n'est en attente ni en vol. Elle ne rejette jamais : les échecs passent par `surEchec`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`tests/cycles.test.ts`, nouveau `describe("remplacerJourDansSemaines (#301)")` :
- `it("remplace le jour ciblé sans muter l'entrée ni toucher les autres jours/semaines")` : Map à deux semaines (`2026-W12` avec lundi + mardi, `2026-W13` avec lundi). On remplace le lundi de `W12`. Attendu : `résultat.get("2026-W12")!.jours.find(j => j.jour === "lundi")` vaut le nouveau jour, le mardi est inchangé (`toBe` même référence), `résultat.get("2026-W13")` est la même référence, et l'entrée garde l'ancien lundi.
- `it("semaine absente → contenu identique")` : `[...résultat.entries()]` est égal (`toEqual`) à `[...entrée.entries()]`.

`lib/file-ecriture-slots.test.ts` (`vi.useFakeTimers()` en `beforeEach`, `vi.useRealTimers()` en `afterEach`). Fixtures : `jp(jour, personnes)` construit un `JourPlanning` avec `diner` et `personnes: { diner: personnes }`.
- `it("délai 0 : écrit immédiatement")` : `planifier("W12", jp("lundi",3), {delaiMs:0, precedent: jp("lundi",2)})`, puis `expect(ecrire).toHaveBeenCalledWith("W12", jp("lundi",3))`.
- `it("rafale débouncée : une seule écriture, avec la dernière valeur")` : trois `planifier` à 3, 4, 5 personnes, avec `advanceTimersByTime(100)` entre chacun. Puis `advanceTimersByTime(799)` → `ecrire` non appelé. Puis `advanceTimersByTime(1)` → appelé **1 fois**, avec `jp("lundi",5)`.
- `it("échec : surEchec reçoit l'état d'AVANT la rafale")` : `ecrire` rejette `new Error("réseau")`. Deux `planifier` (precedent 2 puis precedent 3), puis `await vi.advanceTimersByTimeAsync(800)`. Attendu : `surEchec` appelé avec `("W12", jp("lundi",2), expect.any(Error))`.
- `it("sérialisation par jour : pas de 2e écriture tant que la 1re est en vol")` : `ecrire` renvoie une promesse résolue à la main. `planifier(…3, delai 0)` puis `planifier(…4, delai 0)` → `ecrire` appelé 1 fois. On résout la 1re et on laisse les microtâches s'écouler (`await vi.advanceTimersByTimeAsync(0)`) → 2e appel avec `jp("lundi",4)`.
- `it("clés indépendantes : deux jours partent séparément")` : lundi et mardi en délai 0 → 2 appels.
- `it("succès puis échec : on revient à la dernière valeur écrite")` : écriture 3 réussie, puis nouvelle rafale (precedent 3) à 4 qui échoue → `surEchec` reçoit `jp("lundi",3)`.
- `it("vider() envoie immédiatement les écritures débouncées et attend leur fin")` : `planifier(…, delai 800)` puis `const p = vider()`. `ecrire` est appelé sans avancer le temps, et `await p` se résout.

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run tests/cycles.test.ts lib/file-ecriture-slots.test.ts`
Attendu : FAIL, `remplacerJourDansSemaines` et le module `@/lib/file-ecriture-slots` sont introuvables.

- [ ] **Étape 3 : implémenter `remplacerJourDansSemaines` dans `lib/cycles.ts` et `creerFileEcritureSlots` dans `lib/file-ecriture-slots.ts`**

Fermeture sur une `Map<string, { semaine; confirme; enAttente: JourPlanning | null; minuteur; enVol: Promise<void> | null }>`. Pas d'import React ni Supabase : le module reste pur et injectable. En-tête de fichier : pourquoi la file existe (#301, une écriture par rafale de stepper, ordre garanti par jour, revert US-07). `sauvegarder_slots` upserte le **jour complet**, ce qui explique la clé par jour et non par slot.

- [ ] **Étape 4 : vérifier le passage**

Commande : `npx vitest run tests/cycles.test.ts lib/file-ecriture-slots.test.ts`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add lib/cycles.ts tests/cycles.test.ts lib/file-ecriture-slots.ts lib/file-ecriture-slots.test.ts
git commit -m "feat: file d'écriture par jour débouncée et patch local pur pour la vue Cycle (#301)"
```

---

### Tâche 3 : vue Cycle optimiste

**Fichiers :**
- Modifier : `components/planning/vue-cycle.tsx`. Concerne l'en-tête (l.8-23), le commentaire de la génération (l.197-201), `genererMonCycle` (l.206), `toastAnnulable` (l.235), `appliquerEdition` (l.250), `changerPersonnesSlot` (l.318) et les boutons ‹ › (l.459, l.473).

**Interfaces :**
- Consomme : `remplacerJourDansSemaines` (`@/lib/cycles`), `creerFileEcritureSlots`, `DELAI_STEPPER_MS`, `FileEcritureSlots` (`@/lib/file-ecriture-slots`), `modifierSlotDistant` (`@/lib/sync`).
- Produit : rien de nouveau à l'extérieur. `VuePlanningCycle` garde ses props.

Pas de test unitaire de composant : le repo n'en a pas pour `vue-cycle.tsx`, et la logique est couverte en Tâche 2. Le test de cette tâche est l'e2e de la Tâche 4, qui est écrit et qui échoue d'abord (ordre TDD : faire la Tâche 4, étapes 1-2, avant l'étape 1 ci-dessous).

- [ ] **Étape 1 : instancier la file**

`const [file] = useState<FileEcritureSlots>(() => creerFileEcritureSlots({ ecrire: modifierSlotDistant, surEchec }))`. `surEchec` fait trois choses :
- `console.error("Édition du slot échouée.", erreur)` ;
- `setParSemaine((m) => remplacerJourDansSemaines(m, semaine, jourConfirme))` ;
- `toast.dismiss(ID_TOAST_ANNULATION_CYCLE)` puis `toast.error("Impossible d'enregistrer la modification. Réessaie.")`.

Déplacer la constante `ID_TOAST_ANNULATION_CYCLE` au niveau module. Ajouter un `useEffect(() => () => { void file.vider(); }, [file])` : le basculement vers la vue Semaine ne perd rien.

- [ ] **Étape 2 : édition optimiste**

Ajouter `appliquerLocal(semaine, jour)`, qui fait `setParSemaine((m) => remplacerJourDansSemaines(m, semaine, jour))`.
- `appliquerEdition` devient synchrone (`: void`) : `appliquerLocal`, puis `file.planifier(semaine, nouveau, { delaiMs: 0, precedent: ancien })`, puis `toastAnnulable(message, semaine, ancien, nouveau)` si un message est fourni. Plus de `chargerCycle` ni de `try/catch` : l'échec passe par `surEchec`. Les appels `void appliquerEdition(…)` deviennent `appliquerEdition(…)`.
- `toastAnnulable(message, semaine, ancienJour, nouveauJour)` : `onClick` fait `appliquerLocal(semaine, ancienJour)` puis `file.planifier(semaine, ancienJour, { delaiMs: 0, precedent: nouveauJour })`. Plus de `.then(chargerCycle)`.
- `changerPersonnesSlot` : récupère `ancien` (comme `changerSlot`), puis `appliquerLocal(semaine, nouveau)` et `file.planifier(semaine, nouveau, { delaiMs: DELAI_STEPPER_MS, precedent: ancien })`. Commentaire : US-07, débounce #301, stepper non undoable.

- [ ] **Étape 3 : vider la file avant toute relecture**

- Boutons ‹ › : `onClick={() => void file.vider().then(() => chargerCycle(cycleDecale(ancre, ±1)))}`.
- `genererMonCycle` : `await file.vider()` avant `await genererCycle()`. Sinon une écriture débouncée tardive écraserait le cycle généré.
- `chargerCycle` garde son `setChargement(true)`. Il n'est plus appelé que par le montage, la navigation et la génération.

- [ ] **Étape 4 : commentaires**

- En-tête du fichier : ajouter un paragraphe « Édition optimiste (#301) ». Il dit que `parSemaine` est patché immédiatement, que la file par jour écrit en arrière-plan, et qu'il n'y a jamais de `chargerCycle` après une édition (il démonte la grille via « Chargement… »).
- l.197-201 : supprimer « ne contredit donc pas la lecture seule de l'ÉDITION de slot », devenu faux depuis #283.

- [ ] **Étape 5 : vérifications statiques**

Commandes : `npx tsc --noEmit` puis `npm run lint`
Attendu : 0 erreur.

- [ ] **Étape 6 : commit**

```bash
git add components/planning/vue-cycle.tsx
git commit -m "fix: édition optimiste en vue Cycle, plus de rechargement de la grille (#301)"
```

---

### Tâche 4 : e2e « la grille reste affichée »

**Fichiers :**
- Modifier : `e2e/edition-vue-cycle.spec.ts` (deux tests ajoutés après le test « personnes », l.74)

**Interfaces :**
- Consomme : l'UI de la Tâche 3. Libellés : bouton `/^Plus de personnes/`, texte `"N pers."`, toast `"Impossible d'enregistrer la modification. Réessaie."`.

- [ ] **Étape 1 : écrire les tests (avant la Tâche 3)**

Préambule commun : `goto("/planning")`, clic « Cycle », « Générer mon cycle », attendre `main li`. Avec le jour de courses à lundi (défaut du `beforeEach`), le cycle coïncide avec la semaine affichée, donc la double écriture serait observable.

`test("édition en vue Cycle : la grille reste affichée, une seule écriture après une rafale de clics (#301)")` :
- Après la génération seulement, poser les routes :
  - `**/rest/v1/rpc/sauvegarder_slots` : incrémente `appelsSlots`, attend 1 500 ms, puis `route.continue()`. Le délai rend la fenêtre d'attente observable.
  - `**/rest/v1/rpc/sauvegarder_planning` : incrémente `appelsPlanning`, puis `route.continue()`.
- Observer « Chargement… » via `page.evaluate` : un `MutationObserver` sur `document.body` (`subtree`, `childList`, `characterData`) pose `window.__chargementVu = true` dès que `document.body.innerText` contient `"Chargement…"`.
- `const carte = page.locator("main li").nth(4)`, puis `await carte.scrollIntoViewIfNeeded()` et `const scrollAvant = await page.evaluate(() => window.scrollY)`, avec `expect(scrollAvant).toBeGreaterThan(0)`.
- Lire `n` dans le premier texte `/\d+ pers\./` de `carte`.
- Trois clics `carte.getByRole("button", { name: /^Plus de personnes/ }).first()` enchaînés.
- `await expect(carte.getByText(`${n + 3} pers.`).first()).toBeVisible({ timeout: 1_000 })`. Le délai est inférieur au délai RPC : la mise à jour est donc optimiste.
- `await expect.poll(() => appelsSlots, { timeout: 5_000 }).toBe(1)`, puis `await page.waitForTimeout(2_500)` (débounce de 800 ms + RPC de 1 500 ms + marge).
- Attendus : `appelsSlots` vaut toujours `1`, `appelsPlanning` vaut `0`, `window.__chargementVu` vaut `false`, et `Math.abs(scrollY - scrollAvant) <= 2`.
- `page.reload()` → `${n + 3} pers.` est visible dans `main li` n° 4 (persisté).

`test("édition en vue Cycle : échec réseau → valeur précédente restaurée + toast (#301)")` :
- Route `**/rest/v1/rpc/sauvegarder_slots` → `route.abort()`.
- Un clic « Plus de personnes » sur la 1re carte. `${n + 1} pers.` est visible, puis `${n} pers.` revient (timeout 5 000 ms). Le toast `"Impossible d'enregistrer la modification. Réessaie."` est visible.

- [ ] **Étape 2 : vérifier l'échec sur le code actuel**

Prérequis : aucune migration dans cette PR, rien à appliquer sur staging. Port 3000 libre.
Commande : `npm run test:e2e:staging -- e2e/edition-vue-cycle.spec.ts -g "#301"`
Attendu : FAIL sur les deux tests. Le premier échoue sur `n + 3 pers.` non visible en moins de 1 s, ou sur `__chargementVu`. Le second échoue parce que la valeur n'est jamais appliquée de façon optimiste.

- [ ] **Étape 3 : faire la Tâche 3, puis relancer**

Commande : `npm run test:e2e:staging -- e2e/edition-vue-cycle.spec.ts -g "#301"`
Attendu : 2 passed.

- [ ] **Étape 4 : commit**

```bash
git add e2e/edition-vue-cycle.spec.ts
git commit -m "test: e2e vue Cycle — grille conservée, écriture unique, revert sur échec (#301)"
```

---

### Tâche 5 : documentation (même PR)

**Fichiers :**
- Modifier : `SPECS_FONCTIONNELLES.md:612-613` (US-49) et `:1013` (RG-57)
- Modifier : `.claude/rules/sync-planning.md` et `.claude/rules/courses-cycle.md` (section « Vue Cycle »)
- Modifier : `CHANGELOG.md` (`[Unreleased]` › `### Corrigé`, l.36)

- [ ] **Étape 1 : US-49**

Remplacer le critère « lecture seule » de la l.613 par : *Given la vue « Cycle » est affichée, Then je peux consulter une recette et éditer chaque repas (changer, sélectionner, personnes, restes, annuler) ; l'édition s'applique immédiatement, la sauvegarde part en arrière-plan (RG-57)*. Ajouter « édition depuis #283 » au titre.

- [ ] **Étape 2 : RG-57**

Renommer en « Vue planning cycle, éditable (US-49, #260, #283) ». Remplacer « Elle est en lecture seule… cohérente. » par trois points :
- l'édition écrit directement en base la semaine ISO du jour édité (`sauvegarder_slots`), sans passer par `storePlanning` ;
- la mise à jour est optimiste, avec une seule écriture par édition (stepper débouncé à 800 ms) et un retour à la valeur précédente accompagné d'un toast en cas d'échec ;
- l'undo passe par le toast « Annuler ».

Garder la justification du chevauchement 1-2 semaines ISO, qui explique pourquoi on écrit hors de `storePlanning`. Garder la phrase sur « Générer mon cycle ».

- [ ] **Étape 3 : règles `.claude/rules/`**

- `sync-planning.md`, nouvelle section « Rechargements » : **jamais de `setChargement(true)` sur un rechargement post-édition**. Une édition met l'état local à jour de façon optimiste ; seuls le montage, la navigation et la génération affichent « Chargement… ». Pourquoi : il démonte la grille (scroll, menus, stepper perdus) le temps d'un aller-retour réseau (#301).
- Même fichier : tout patch de `storePlanning` qui reflète une écriture **déjà faite en base** passe sous la garde `hydratationEnCours`. Pourquoi : sinon `planifierPush` relance un `sauvegarder_planning` de toute la semaine (double écriture).
- `courses-cycle.md`, puce « Édition complète » : remplacer la fin par « mise à jour optimiste de `parSemaine` (`remplacerJourDansSemaines`) + `creerFileEcritureSlots` (`lib/file-ecriture-slots.ts`) : une écriture en vol par jour, stepper débouncé à 800 ms, revert + toast sur échec, `vider()` avant navigation ou génération ». Ajouter `lib/file-ecriture-slots*.ts` aux `paths:` de `courses-cycle.md`.

- [ ] **Étape 4 : CHANGELOG**

Sous `### Corrigé` de `[Unreleased]`, en tête :
« Vue Cycle — chaque modification (changer, choisir une recette, nombre de personnes, restes, annuler) rechargeait toute la grille avec un écran « Chargement… » : le défilement sautait et les menus se refermaient (#301). La modification s'affiche désormais instantanément et s'enregistre en arrière-plan ; le nombre de personnes accepte plusieurs clics d'affilée et n'est enregistré qu'une fois. En cas d'échec réseau, la valeur précédente revient avec un message d'erreur. »

- [ ] **Étape 5 (à valider, cf. question ci-dessous) : CHANGELOG l.18**

L'entrée `[Unreleased]` « Vue planning « Cycle » (#260) » affirme aussi la « lecture seule ». Remplacer la phrase par « Tu peux y modifier chaque repas comme en vue Semaine. »

- [ ] **Étape 6 : commit**

```bash
git add SPECS_FONCTIONNELLES.md .claude/rules/sync-planning.md .claude/rules/courses-cycle.md CHANGELOG.md
git commit -m "docs: vue Cycle éditable (US-49/RG-57), piège rechargement post-édition, changelog (#301)"
```

---

### Tâche 6 : livraison

- [ ] **Étape 1 : tests unitaires**

Commande : `npm run test:run`
Attendu : tous verts.

- [ ] **Étape 2 : e2e ciblé sur staging**

Commande : `npm run test:e2e:staging -- e2e/edition-vue-cycle.spec.ts`
Attendu : tous passés (les 4 tests existants et les 2 nouveaux).

- [ ] **Étape 3 : specs impactées sur staging**

Commande : `npm run test:e2e:staging -- e2e/edition-vue-cycle.spec.ts e2e/coherence-semaine-cycle.spec.ts e2e/cycle-courses.spec.ts e2e/alerte-planning.spec.ts e2e/planning-edition.spec.ts e2e/planning.spec.ts --retries=2`
Attendu : tout vert. `alerte-planning` vérifie que l'anti-écho US-21 est intact, `planning-edition` le jumeau Semaine.

- [ ] **Étape 4 : push et PR**

```bash
git push -u origin fix/301-vue-cycle-optimiste
gh pr create --title "fix: vue Cycle optimiste, plus de rechargement de la grille (#301)" --body "<résumé, audit du jumeau (Tâche 1 étape 4), résultats e2e staging, Closes #301, ligne 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
```

- [ ] **Étape 5 : CI**

Commande : `gh pr checks <n> --watch`
Attendu : tous les checks verts. Si un check est rouge, ne pas merger. Remonter le check, le lien du run, l'extrait de log et la cause probable (PR ou flaky), puis laisser l'humain trancher. Merger seulement sur CI verte.
