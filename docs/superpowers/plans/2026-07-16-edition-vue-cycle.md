# Édition en vue Cycle + libellé dynamique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la vue Cycle de `/planning` éditable à parité avec la vue Semaine (changer, sélection manuelle, personnes, restes), sans casser le modèle mono-semaine de `storePlanning`/`useSync` ; rendre le libellé « Ce midi »/« Ce soir » dynamique et cohérent dans toute l'app.

**Architecture:** Chaque édition en vue Cycle écrit **directement en base** pour la semaine ISO du jour édité, via la RPC `sauvegarder_slots` déjà utilisée par la génération fenêtrée (#259) — jamais via `storePlanning`. Un nouveau bookkeeping garde les deux mécanismes anti-écho existants (`majPlanningCycle`, `planning_courant_maj`) synchrones, pour ne jamais déclencher une fausse alerte sur sa propre édition. L'UI d'édition (`SlotRepas`) est extraite en composant partagé entre `/planning` (vue Semaine) et `VuePlanningCycle` (vue Cycle) — DRY, un seul endroit à maintenir.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest.

## Global Constraints

- Code en **français** (identifiants, commentaires, textes UI), cf. CLAUDE.md.
- TypeScript strict.
- Ne pas committer sur `main` — branche `feat/edition-vue-cycle` (déjà créée, spec dessus).
- Avant PR : `npm run test:e2e:staging` (specs touchées : `planning.spec`, `planning-edition.spec`,
  `alerte-planning.spec`, `prochain-repas.spec`, `auth.spec`, + nouveau spec de Task 8).
- Spec de référence : `docs/superpowers/specs/2026-07-16-edition-vue-cycle-design.md`.
- **Changement d'un mécanisme partagé = audit de tous les consommateurs** (règle CLAUDE.md,
  rétro #257) : `SlotRepas` devient partagé entre 2 pages — toute évolution future devra
  vérifier les deux appelants.

---

### Task 1 : Extraire `SlotRepas`/`StepperPersonnes`/`IconeRestes` en composant partagé

**Files:**
- Create: `components/planning/slot-repas.tsx`
- Modify: `app/planning/page.tsx` (retire les définitions locales, importe depuis le nouveau fichier)

**Interfaces:**
- Produit : `export function SlotRepas(props): JSX.Element` (props identiques à l'actuelle,
  `app/planning/page.tsx:1050-1074`), `export function StepperPersonnes(props)`,
  `export function IconeRestes()`.
- Consommé par : `app/planning/page.tsx` (vue Semaine, existant) et `components/planning/vue-cycle.tsx`
  (Task 7).

Ce déplacement est **mécanique** : aucune ligne de logique ne change, seul l'emplacement. Les
imports utilisés par ces 3 fonctions (`useState` de React, `CookingPot`/`RefreshCw`/`Search`/
`MoreHorizontal` de `lucide-react`, `BadgeTemps`/`BadgeVegetarien`/`BadgeAccompagnement`/
`BadgeSaison`, `PERSONNES_MIN`/`PERSONNES_MAX` de `lib/personnes`, `type Recette` de `@/types`)
migrent avec elles.

- [ ] **Step 1: Créer le nouveau fichier avec le contenu déplacé**

Créer `components/planning/slot-repas.tsx` avec, en tête :
```tsx
"use client";

import { useState } from "react";
import { CookingPot, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { PERSONNES_MIN, PERSONNES_MAX } from "@/lib/personnes";
import type { Recette } from "@/types";
```
Puis, **inchangés mot pour mot**, coller le contenu actuel de `app/planning/page.tsx` :
- `function SlotRepas({...}) {...}` (lignes 1050-1253)
- `function IconeRestes() {...}` (lignes 1256-1271)
- `function StepperPersonnes({...}) {...}` (lignes 1276 jusqu'à sa fermeture, juste après le
  fragment lu en Step 2 ci-dessous — lire le fichier pour trouver l'accolade fermante exacte
  avant de couper)
Exporter les 3 : `export function SlotRepas`, `export function StepperPersonnes`,
`export function IconeRestes`.

- [ ] **Step 2: Retirer les définitions de `app/planning/page.tsx`, ajouter l'import**

Supprimer les 3 fonctions de `app/planning/page.tsx` (mêmes plages qu'au Step 1). Ajouter
l'import, près des autres imports de `components/planning/*` :
```tsx
import { SlotRepas } from "@/components/planning/slot-repas";
```

- [ ] **Step 3: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit`
Expected: aucune erreur (en particulier, vérifier qu'aucun import devenu inutile ne traîne dans
`app/planning/page.tsx` — `CookingPot`, `RefreshCw`, `Search`, `MoreHorizontal` peuvent devenir
inutilisés si non référencés ailleurs dans ce fichier ; les retirer si l'ESLint le signale).

Run: `npx eslint app/planning/page.tsx components/planning/slot-repas.tsx`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle**

Run: `npm run dev`, ouvrir `/planning` (vue Semaine), générer un planning, vérifier que
Changer/Sélectionner/Restes/Stepper personnes fonctionnent exactement comme avant (aucune
régression visuelle ni fonctionnelle attendue — c'est un déplacement pur).

- [ ] **Step 5: Commit**

```bash
git add components/planning/slot-repas.tsx app/planning/page.tsx
git commit -m "refactor: extrait SlotRepas/StepperPersonnes en composant partagé (prépare l'édition vue Cycle)"
```

---

### Task 2 : `modifierSlotDistant` (lib/sync.ts)

**Files:**
- Modify: `lib/sync.ts`
- Test: `lib/sync.test.ts`

**Interfaces:**
- Consomme : `sauvegarderSlotsDistant(semaine, jours)` (déjà importée), `storePlanning` (déjà
  importée), constantes privées `CLE_SEMAINE`/`CLE_MAJ` et fonction privée `planningLocal()`
  (déjà dans le même module).
- Produit : `export async function modifierSlotDistant(semaine: string, jourPlanning: JourPlanning): Promise<void>` —
  utilisée par Task 7 (`vue-cycle.tsx`).

- [ ] **Step 1: Étendre le mock du test (préalable)**

Le mock `persistance` de `lib/sync.test.ts` a déjà `chargerPlanningDistant` — `sauvegarderSlotsDistant`
n'y est **pas encore** mocké (le bloc `vi.hoisted` actuel ne le liste pas). Ajouter :
```ts
const persistance = vi.hoisted(() => ({
  // ... entrées existantes ...
  sauvegarderSlotsDistant: vi.fn(),
}));
```
Et dans `beforeEach` :
```ts
  persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T12:00:00.000Z");
```

- [ ] **Step 2: Écrire les tests qui échouent**

Ajouter à `lib/sync.test.ts` (après le bloc `describe("allerAuCycle...")`) :
```ts
function jourPlanningSimple(jour: "lundi" | "mardi", diner: { id: string; nom: string }): JourPlanning {
  return {
    jour,
    diner: { ...diner, tempsPreparation: "rapide", ingredients: [] },
  } as JourPlanning;
}

describe("modifierSlotDistant — édition ponctuelle découplée de storePlanning (#suite #279)", () => {
  it("persiste UNIQUEMENT le jour fourni, sans toucher storePlanning si semaine ≠ affichée", async () => {
    localStorage.setItem("semaine_affichee", "2026-W10"); // autre semaine que celle éditée
    const { modifierSlotDistant } = await chargerSync();

    await modifierSlotDistant("2026-W12", jourPlanningSimple("lundi", { id: "r1", nom: "R1" }));

    expect(persistance.sauvegarderSlotsDistant).toHaveBeenCalledWith(
      "2026-W12",
      [jourPlanningSimple("lundi", { id: "r1", nom: "R1" })]
    );
    expect(localStorage.getItem("planning_courant")).toBeNull(); // storePlanning intact
  });

  it("met à jour storePlanning ET planning_courant_maj si la semaine éditée EST l'affichée", async () => {
    localStorage.setItem("semaine_affichee", "2026-W12");
    localStorage.setItem(
      "planning_courant",
      JSON.stringify({ semaine: "2026-W12", jours: [{ jour: "lundi", diner: { id: "vieux", nom: "Vieux", tempsPreparation: "rapide", ingredients: [] } }] })
    );
    persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T15:00:00.000Z");
    const { modifierSlotDistant } = await chargerSync();

    await modifierSlotDistant("2026-W12", jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }));

    const local = JSON.parse(localStorage.getItem("planning_courant")!);
    expect(local.jours[0].diner.id).toBe("nouveau");
    expect(localStorage.getItem("planning_courant_maj")).toBe("2026-07-16T15:00:00.000Z");
  });
});
```

- [ ] **Step 3: Lancer les tests, vérifier l'échec**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: FAIL — `modifierSlotDistant is not a function`.

- [ ] **Step 4: Implémenter**

Ajouter dans `lib/sync.ts`, juste après la fonction `allerAuCycle` :
```ts
/**
 * Édition ponctuelle d'UN slot depuis la vue Cycle (#279 suite, retour
 * utilisateur post-merge #281) — écrit directement en base pour la semaine ISO
 * du jour édité, SANS jamais toucher `storePlanning` (mono-semaine). Réutilise
 * `sauvegarderSlotsDistant` (RPC `sauvegarder_slots`, #259) qui n'upserte que
 * les `(jour, type_repas)` présents sur `jourPlanning` — passer un seul repas
 * renseigné ne touche pas l'autre repas du même jour.
 *
 * Met à jour les DEUX bookkeeping anti-écho existants, sinon on déclenche une
 * fausse alerte intrusive sur sa propre édition :
 * - `majPlanningCycle` (temps réel de /courses, #259) : toujours, quelle que
 *   soit la semaine — /courses peut avoir sa propre vue cycle ouverte ailleurs.
 * - `planning_courant_maj` + cache `storePlanning` (alerte de /planning, #56
 *   PR5) : UNIQUEMENT si la semaine éditée est la semaine actuellement
 *   affichée — sinon ce cache ne représente pas cette semaine, rien à patcher.
 */
export async function modifierSlotDistant(
  semaine: string,
  jourPlanning: JourPlanning
): Promise<void> {
  const maj = await sauvegarderSlotsDistant(semaine, [jourPlanning]);
  majPlanningCycle.set(semaine, Date.parse(maj));

  if (semaine === localStorage.getItem(CLE_SEMAINE)) {
    localStorage.setItem(CLE_MAJ, maj);
    const local = planningLocal();
    if (local && local.semaine === semaine) {
      const jours = local.jours.map((jp) =>
        jp.jour === jourPlanning.jour ? jourPlanning : jp
      );
      storePlanning.ecrire(JSON.stringify({ semaine, jours }));
    }
  }
}
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: PASS (tous les tests, y compris les 2 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add lib/sync.ts lib/sync.test.ts
git commit -m "feat: modifierSlotDistant — édition de slot découplée de storePlanning (vue Cycle)"
```

---

### Task 3 : `libelleMomentActuel` (lib/prochain-repas.ts)

**Files:**
- Modify: `lib/prochain-repas.ts`
- Test: `tests/prochain-repas.test.ts`

**Interfaces:**
- Produit : `export function libelleMomentActuel(maintenant: Date): "Ce midi" | "Ce soir"` —
  utilisée par Task 4 (`nav.tsx`) et Task 5 (`app/ce-soir/page.tsx`).

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/prochain-repas.test.ts` :
```ts
describe("libelleMomentActuel", () => {
  it("avant le seuil (~15h) → « Ce midi »", () => {
    expect(libelleMomentActuel(new Date("2026-07-16T10:00:00"))).toBe("Ce midi");
  });
  it("après le seuil → « Ce soir »", () => {
    expect(libelleMomentActuel(new Date("2026-07-16T18:00:00"))).toBe("Ce soir");
  });
});
```
Et dans l'import en tête de fichier, ajouter `libelleMomentActuel` :
```ts
import { prochainRepasActif, libelleContexteRepas, libelleMomentActuel } from "@/lib/prochain-repas"
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npm run test:run -- tests/prochain-repas.test.ts`
Expected: FAIL — `libelleMomentActuel is not a function`.

- [ ] **Step 3: Implémenter**

Dans `lib/prochain-repas.ts`, la constante `SEUIL_HEURE_DINER` existe déjà (private). Ajouter,
juste après sa déclaration :
```ts
/** Libellé générique du moment actuel (#suite #279/#280) — même seuil que
 *  prochainRepasActif, réutilisé partout où on n'a pas de date de repas
 *  précise (nav, état vide de /ce-soir). */
export function libelleMomentActuel(maintenant: Date): "Ce midi" | "Ce soir" {
  return maintenant.getHours() < SEUIL_HEURE_DINER ? "Ce midi" : "Ce soir"
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test:run -- tests/prochain-repas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prochain-repas.ts tests/prochain-repas.test.ts
git commit -m "feat: libelleMomentActuel — libellé Ce midi/Ce soir dynamique partagé"
```

---

### Task 4 : Libellé de nav dynamique (components/ui/nav.tsx)

**Files:**
- Modify: `components/ui/nav.tsx`

**Interfaces:** consomme `libelleMomentActuel` (Task 3).

- [ ] **Step 1: Rendre le libellé dynamique**

`components/ui/nav.tsx` est déjà `"use client"`. Le tableau `LIENS` (avec `{ href: "/ce-soir",
label: "Ce soir" }`) est utilisé pour un rendu générique (`{label}`) commun aux 4 liens — il faut
sortir le lien « Ce soir » de cette boucle générique pour lui donner un libellé calculé.

Remplacer :
```tsx
const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
  { href: "/ce-soir", label: "Ce soir" },
];
```
par :
```tsx
const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
];
```
Ajouter l'import :
```tsx
import { libelleMomentActuel } from "@/lib/prochain-repas";
```
Dans `NavBar()`, ajouter (près de `const accueil = ...`) :
```tsx
const libelleCeSoir = libelleMomentActuel(new Date());
```
Puis, dans la boucle `{LIENS.map(...)}`, juste **après** sa fermeture (toujours à l'intérieur du
même conteneur `afficherNavApp ? (<>...` ), ajouter le lien « Ce soir » séparément :
```tsx
<Link
  href="/ce-soir"
  aria-current={estActif(pathname, "/ce-soir") ? "page" : undefined}
  className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
    estActif(pathname, "/ce-soir")
      ? "bg-primary text-white"
      : "text-brand-700 hover:bg-brand-50"
  }`}
>
  {libelleCeSoir}
</Link>
```
(reprend exactement le même style/logique `estActif` que les liens de `LIENS`, juste sorti de la
boucle générique pour porter un libellé calculé au lieu d'un texte statique.)

- [ ] **Step 2: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit && npx eslint components/ui/nav.tsx`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add components/ui/nav.tsx
git commit -m "feat: libellé de nav Ce midi/Ce soir dynamique"
```

---

### Task 5 : `/ce-soir` — état vide dynamique + créneau vide précis

**Files:**
- Modify: `app/ce-soir/page.tsx`

**Interfaces:** consomme `libelleMomentActuel` (Task 3, déjà `libelleContexteRepas` importée).

- [ ] **Step 1: Importer `libelleMomentActuel`**

```tsx
import { prochainRepasActif, libelleContexteRepas, libelleMomentActuel, type ProchainRepas } from "@/lib/prochain-repas";
```

- [ ] **Step 2: Scinder la branche combinée**

Remplacer (lignes 84-91 actuelles) :
```tsx
  if (prochain === null || !prochain.recette) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">Ce soir</h1>
        <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
      </main>
    );
  }
```
par :
```tsx
  if (prochain === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">
          {libelleMomentActuel(new Date())}
        </h1>
        <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
      </main>
    );
  }

  if (!prochain.recette) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())}
        </h1>
        <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
      </main>
    );
  }
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add app/ce-soir/page.tsx
git commit -m "feat: /ce-soir — état vide utilise le libellé dynamique précis"
```

---

### Task 6 : Ajuster les e2e existants sur le libellé de nav

**Files:**
- Modify: `e2e/auth.spec.ts`
- Modify: `e2e/prochain-repas.spec.ts`

**Interfaces:** aucune.

- [ ] **Step 1: Remplacer les matchers figés**

Dans `e2e/auth.spec.ts`, remplacer :
```ts
  await expect(page.getByRole("link", { name: "Ce soir" })).toHaveCount(0);
```
par :
```ts
  await expect(page.getByRole("link", { name: /Ce midi|Ce soir/ })).toHaveCount(0);
```

Dans `e2e/prochain-repas.spec.ts`, remplacer les deux occurrences de
`getByRole("link", { name: "Ce soir" })` (test 1, clic sur le lien ; test « déconnecté ») par
`getByRole("link", { name: /Ce midi|Ce soir/ })`.

- [ ] **Step 2: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit && npx eslint e2e/auth.spec.ts e2e/prochain-repas.spec.ts`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add e2e/auth.spec.ts e2e/prochain-repas.spec.ts
git commit -m "test: e2e acceptent Ce midi OU Ce soir pour le lien de nav (libellé dynamique)"
```

---

### Task 7 : Édition dans `VuePlanningCycle` (components/planning/vue-cycle.tsx)

**Files:**
- Modify: `components/planning/vue-cycle.tsx`

**Interfaces:**
- Consomme : `SlotRepas` (Task 1), `modifierSlotDistant` (Task 2), `remplacerSlot`/
  `remplacerSlotManuel` (`lib/generateur.ts`, déjà existantes), `modifierPersonnes`
  (`lib/personnes.ts`), `marquerRestes` (`lib/restes.ts`), `recettesUtilisees` (`lib/generateur.ts`),
  `chargerRecettesGerees` (`lib/recettes.ts`), `chargerPreferences` (`lib/preferences.ts`),
  `SelecteurRecette` (`components/planning/selecteur-recette.tsx`), `ConfirmationModale`
  (`components/ui/confirmation.tsx`).

C'est la tâche la plus large : elle ajoute l'état et les handlers d'édition à `VuePlanningCycle`,
remplace `CarteLecture` (lecture seule, supprimée) par `SlotRepas` (éditable), et monte
`SelecteurRecette`/`ConfirmationModale`.

- [ ] **Step 1: Étendre les imports**

```tsx
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  recettesUtilisees,
  remplacerSlot,
  remplacerSlotManuel,
  type PreferencesRecettes,
} from "@/lib/generateur";
import { modifierPersonnes } from "@/lib/personnes";
import { estRestes, marquerRestes } from "@/lib/restes";
import { modifierSlotDistant } from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { chargerPreferences } from "@/lib/preferences";
import { SlotRepas } from "@/components/planning/slot-repas";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { ConfirmationModale } from "@/components/ui/confirmation";
```
(`personnesDuSlot` reste importée de `@/lib/personnes` comme avant, à côté de `modifierPersonnes`.)

- [ ] **Step 2: Charger recettes + préférences (comme la vue Semaine)**

Ajouter, à côté de la déclaration de `reglages` :
```tsx
  // Recettes + préférences (#219) : nécessaires pour « Changer » (aléatoire, biaisé
  // par les préférences) et « Sélectionner » (liste complète), même chargement que
  // la vue Semaine (app/planning/page.tsx).
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  const [preferences, setPreferences] = useState<PreferencesRecettes>(new Map());

  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (actif) setRecettesGerees(liste);
      })
      .catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
      });
    chargerPreferences()
      .then((p) => {
        if (actif) setPreferences(p);
      })
      .catch((erreur) => {
        console.error("Chargement des préférences échoué (biais ignoré).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  const recettes = recettesGerees.map((r) => r.recette);
```

- [ ] **Step 3: État d'édition (sélection en cours, confirmation semaine passée)**

Ajouter, à côté de `ficheOuverte` :
```tsx
  // Slot en cours de sélection manuelle (US-06) — { dateISO, jour, typeRepas, semaine }.
  const [slotEnSelection, setSlotEnSelection] = useState<{
    dateISO: string;
    semaine: string;
    jour: JourPlanning["jour"];
    typeRepas: TypeRepas;
  } | null>(null);
  // Confirmation avant d'éditer un jour PASSÉ (US-14, RG-24) — même garde que la
  // vue Semaine, mais jugée par jour édité (comparaison de date directe, pas
  // d'offsetAffiche : la vue Cycle n'a pas de notion de "semaine affichée" unique).
  const [confirmation, setConfirmation] = useState<{ executer: () => void } | null>(null);

  function estPasse(dateISO: string): boolean {
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const [a, m, j] = dateISO.split("-").map(Number);
    return new Date(a, m - 1, j) < aujourdhui;
  }

  function confirmerSiPasse(dateISO: string, executer: () => void): boolean {
    if (estPasse(dateISO)) {
      setConfirmation({ executer });
      return true;
    }
    return false;
  }
```

- [ ] **Step 4: Handlers d'édition**

Ajouter, après `genererMonCycle` :
```tsx
  const ID_TOAST_ANNULATION_CYCLE = "annulation-slot-cycle";

  // Annule la dernière édition en rejouant l'ANCIEN JourPlanning par le même
  // chemin d'écriture — pas de snapshot persistant (contrairement à la vue
  // Semaine) : la fermeture du toast (~5 s) borne naturellement la fenêtre.
  function toastAnnulable(message: string, semaine: string, ancienJour: JourPlanning): void {
    toast(message, {
      id: ID_TOAST_ANNULATION_CYCLE,
      action: {
        label: "Annuler",
        onClick: () => {
          void modifierSlotDistant(semaine, ancienJour).then(() => {
            if (ancre !== null) void chargerCycle(ancre);
          });
        },
      },
      duration: 5000,
    });
  }

  async function appliquerEdition(
    semaine: string,
    jour: JourPlanning["jour"],
    ancienJourPlanning: JourPlanning,
    nouveauJourPlanning: JourPlanning,
    messageToast: string | null
  ): Promise<void> {
    try {
      await modifierSlotDistant(semaine, nouveauJourPlanning);
      if (ancre !== null) void chargerCycle(ancre);
      if (messageToast) toastAnnulable(messageToast, semaine, ancienJourPlanning);
    } catch (erreur) {
      console.error("Édition du slot échouée.", erreur);
      toast.error("Impossible d'enregistrer la modification. Réessaie.");
    }
  }

  function planningDeLaSemaine(semaine: string): Planning | null {
    return parSemaine.get(semaine) ?? null;
  }

  function changerSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    force = false
  ): void {
    if (!force && confirmerSiPasse(dateISO, () => changerSlot(dateISO, semaine, jour, typeRepas, true))) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === jour);
    if (!ancienJourPlanning) return;
    const nouveauPlanning = remplacerSlot(planningSemaine, jour, typeRepas, recettes, reglages, undefined, preferences);
    if (nouveauPlanning === null) {
      toast.error("Pas de recette disponible");
      return;
    }
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    void appliquerEdition(semaine, jour, ancienJourPlanning, nouveauJourPlanning, "Recette remplacée");
  }

  function selectionnerRecette(recette: Recette): void {
    if (slotEnSelection === null) return;
    const cible = slotEnSelection;
    setSlotEnSelection(null);
    const executer = () => {
      const planningSemaine = planningDeLaSemaine(cible.semaine);
      if (!planningSemaine) return;
      const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === cible.jour);
      if (!ancienJourPlanning) return;
      const nouveauPlanning = remplacerSlotManuel(planningSemaine, cible.jour, cible.typeRepas, recette);
      if (nouveauPlanning === null) return;
      const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === cible.jour)!;
      void appliquerEdition(cible.semaine, cible.jour, ancienJourPlanning, nouveauJourPlanning, "Recette remplacée");
    };
    if (confirmerSiPasse(cible.dateISO, executer)) return;
    executer();
  }

  function changerPersonnesSlot(
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    personnes: number
  ): void {
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const nouveauPlanning = modifierPersonnes(planningSemaine, jour, typeRepas, personnes);
    if (nouveauPlanning === null) return;
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    // Pas de toast Annuler (même comportement que la vue Semaine, cf.
    // app/planning/page.tsx#changerPersonnes — action mineure, non undoable).
    void modifierSlotDistant(semaine, nouveauJourPlanning).then(() => {
      if (ancre !== null) void chargerCycle(ancre);
    });
  }

  function changerRestesSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    valeur: boolean,
    force = false
  ): void {
    if (!force && confirmerSiPasse(dateISO, () => changerRestesSlot(dateISO, semaine, jour, typeRepas, valeur, true))) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === jour);
    if (!ancienJourPlanning) return;
    const nouveauPlanning = marquerRestes(planningSemaine, jour, typeRepas, valeur);
    if (nouveauPlanning === null) return;
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    void appliquerEdition(
      semaine,
      jour,
      ancienJourPlanning,
      nouveauJourPlanning,
      valeur ? "Repas marqué « Restes »" : "Repas à cuisiner"
    );
  }
```

- [ ] **Step 5: Remplacer `CarteLecture` par `SlotRepas` dans le rendu, supprimer `CarteLecture`**

Dans la boucle de rendu des cellules, remplacer :
```tsx
                <div className="grid gap-3 sm:grid-cols-2">
                  {slotsDuJour(jp, reglages).map((slot) => (
                    <CarteLecture
                      key={slot.typeRepas}
                      libelle={slot.libelle}
                      recette={slot.recette}
                      personnes={personnesDuSlot(jp, slot.typeRepas)}
                      restes={estRestes(jp, slot.typeRepas)}
                      onVoir={() =>
                        slot.recette &&
                        setFicheOuverte({
                          recette: slot.recette,
                          personnes: personnesDuSlot(jp, slot.typeRepas),
                        })
                      }
                    />
                  ))}
                </div>
```
par :
```tsx
                <div className="grid gap-3 sm:grid-cols-2">
                  {slotsDuJour(jp, reglages).map((slot) => {
                    const { semaine } = dateVersSemaineJour(dateISO);
                    return (
                      <SlotRepas
                        key={slot.typeRepas}
                        libelle={slot.libelle}
                        jourLabel={libelleJourDate(dateISO)}
                        recette={slot.recette}
                        indisponible={false}
                        personnes={personnesDuSlot(jp, slot.typeRepas)}
                        restes={estRestes(jp, slot.typeRepas)}
                        onChanger={() => changerSlot(dateISO, semaine, jp.jour, slot.typeRepas)}
                        onSelectionner={() =>
                          setSlotEnSelection({ dateISO, semaine, jour: jp.jour, typeRepas: slot.typeRepas })
                        }
                        onChangerPersonnes={(p) => changerPersonnesSlot(semaine, jp.jour, slot.typeRepas, p)}
                        onChangerRestes={(v) => changerRestesSlot(dateISO, semaine, jp.jour, slot.typeRepas, v)}
                        onVoir={() =>
                          slot.recette &&
                          setFicheOuverte({
                            recette: slot.recette,
                            personnes: personnesDuSlot(jp, slot.typeRepas),
                          })
                        }
                      />
                    );
                  })}
                </div>
```
Supprimer entièrement la fonction `CarteLecture` (plus utilisée) en fin de fichier.

- [ ] **Step 6: Monter `SelecteurRecette` et `ConfirmationModale`**

Juste avant la fermeture du composant (après le bloc `{ficheOuverte && <FicheRecette ... />}`) :
```tsx
      {slotEnSelection && (
        <SelecteurRecette
          titre={`${slotEnSelection.typeRepas === "diner" ? "Dîner" : "Déjeuner"} de ${libelleJourDate(slotEnSelection.dateISO).toLowerCase()}`}
          recettes={recettes}
          idsAuPlanning={recettesUtilisees(planningDeLaSemaine(slotEnSelection.semaine) ?? { semaine: slotEnSelection.semaine, jours: [] })}
          onSelectionner={selectionnerRecette}
          onRestes={() =>
            changerRestesSlot(
              slotEnSelection.dateISO,
              slotEnSelection.semaine,
              slotEnSelection.jour,
              slotEnSelection.typeRepas,
              true
            )
          }
          onFermer={() => setSlotEnSelection(null)}
        />
      )}
      {confirmation && (
        <ConfirmationModale
          titre="Modifier un jour passé ?"
          message="Ce jour est déjà passé. Veux-tu vraiment modifier ce planning enregistré ?"
          libelleConfirmer="Modifier"
          onConfirmer={() => {
            const action = confirmation.executer;
            setConfirmation(null);
            action();
          }}
          onAnnuler={() => setConfirmation(null)}
        />
      )}
```

- [ ] **Step 7: Mettre à jour le commentaire d'en-tête du fichier**

Le commentaire en tête de `vue-cycle.tsx` (lignes 3-25) affirme encore que l'édition de slot est
réservée à la vue Semaine — le corriger pour refléter la parité désormais atteinte (garder la
justification historique #260/#279 comme contexte, mais noter que l'écriture directe en base,
découplée de `storePlanning`, lève la contrainte d'origine).

- [ ] **Step 8: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit`
Expected: aucune erreur. Porter une attention particulière à `personnesDuSlot`/`estRestes`
toujours importés et utilisés (ils le sont, dans le JSX de rendu).

Run: `npx eslint components/planning/vue-cycle.tsx`
Expected: aucune erreur.

- [ ] **Step 9: Vérification manuelle**

Run: `npm run dev`, ouvrir `/planning`, générer un planning, basculer sur « Cycle », vérifier :
changer un repas persiste (reload confirme), sélection manuelle fonctionne, stepper personnes
persiste, marquer restes fonctionne, toast Annuler restaure l'ancienne recette. Vérifier
qu'éditer un jour appartenant à la semaine actuellement affichée en vue Semaine ne déclenche PAS
l'alerte intrusive (repasser en vue Semaine après édition, vérifier l'absence de modale).

- [ ] **Step 10: Commit**

```bash
git add components/planning/vue-cycle.tsx
git commit -m "feat: édition complète (changer/sélection/personnes/restes) dans la vue Cycle"
```

---

### Task 8 : Nouvelle couverture e2e

**Files:**
- Create: `e2e/edition-vue-cycle.spec.ts`

**Interfaces:** aucune — spec e2e, patron `e2e/coherence-semaine-cycle.spec.ts`.

- [ ] **Step 1: Écrire la spec**

```ts
// e2e/edition-vue-cycle.spec.ts
// Édition complète depuis la vue Cycle (#279 suite, retour post-merge #281) —
// génération réelle, CI-only (catalogue seedé sur staging).

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test("changer un repas depuis la vue Cycle persiste au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Plus d'actions" }).first().click();
  const nomAvant = await page.locator("main button[aria-label^='Voir la recette']").first().textContent();
  await page.getByRole("button", { name: /^Changer/ }).first().click();
  await expect(page.getByText("Recette remplacée")).toBeVisible();

  await page.reload();
  const nomApres = await page.locator("main button[aria-label^='Voir la recette']").first().textContent();
  expect(nomApres).not.toBe(nomAvant);
});

test("modifier le nombre de personnes depuis la vue Cycle persiste au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  const boutonPlus = page.getByRole("button", { name: /Plus de personnes/ }).first();
  await boutonPlus.click();
  await expect(page.getByText("3 pers.").first()).toBeVisible();

  await page.reload();
  await expect(page.getByText("3 pers.").first()).toBeVisible();
});
```

> Sélecteurs à valider/ajuster lors de l'implémentation contre le rendu réel (aria-labels exacts
> de `SlotRepas`, cf. `components/planning/slot-repas.tsx` après Task 1) — ce plan n'a pas
> ré-exécuté ces specs contre un serveur réel avant de les écrire.

- [ ] **Step 2: Lancer contre staging**

Run: `npm run test:e2e:staging -- edition-vue-cycle.spec --retries=2`
Expected: tous verts. Ajuster les sélecteurs si un aria-label diffère de l'hypothèse ci-dessus.

- [ ] **Step 3: Commit**

```bash
git add e2e/edition-vue-cycle.spec.ts
git commit -m "test: e2e édition complète depuis la vue Cycle"
```

---

### Task 9 : Vérification finale avant PR

- [ ] **Step 1: Suite complète**

Run: `npx tsc --noEmit`
Run: `npm run lint`
Run: `npm run test:run`
Expected : tout vert.

- [ ] **Step 2: e2e staging complet des specs touchées**

Run: `npm run test:e2e:staging -- planning.spec planning-edition.spec alerte-planning.spec prochain-repas.spec auth.spec edition-vue-cycle.spec --retries=2`
Expected : tout vert (accepter le flake connu de latence backend documenté dans CLAUDE.md s'il
apparaît isolément et disparaît au retry).

- [ ] **Step 3: Ouvrir la PR**

Titre court, résumé D1-D3, lien vers la spec.

---

## Self-Review (effectué avant remise du plan)

- **Couverture de la spec** : D1 (parité 4 actions) → Task 7. D2 (undo per-édition) → Task 7
  (`toastAnnulable`), sauf personnes (mineur, non undoable — comportement identique à la vue
  Semaine, vérifié en code `app/planning/page.tsx#changerPersonnes`). D3 (libellé dynamique) →
  Tasks 3, 4, 5, 6.
- **Placeholders** : Task 8 note explicitement une incertitude sur les sélecteurs e2e exacts
  (aria-labels) — assumé et documenté, à ajuster à l'implémentation contre le rendu réel, pas un
  oubli silencieux.
- **Cohérence des types** : `JourPlanning`, `Planning`, `Recette` utilisés identiquement entre
  Task 2 (`lib/sync.ts`) et Task 7 (`vue-cycle.tsx`). `modifierSlotDistant(semaine, jourPlanning)`
  a la même signature aux deux endroits.
- **Risque le plus élevé** : Task 7 est dense (4 handlers + 2 composants montés). Le
  self-review recommande, à l'exécution, de committer Task 7 en plusieurs commits internes si un
  exécutant préfère scinder par action (changer / sélection / personnes / restes) plutôt qu'en un
  seul bloc — le plan le présente en un seul Step 4 pour cohérence de lecture, mais rien n'empêche
  de le découper à l'implémentation.
- **Limitation acceptée** : `SlotRepas` en vue Cycle reçoit `indisponible={false}` en dur (Task 7
  Step 5) — la vue Semaine, elle, affiche une alerte inline « Pas de recette disponible » en plus
  du toast d'erreur (état `slotIndisponible` par clé `jour-typeRepas`). Reproduire ce state par
  slot en vue Cycle est possible mais alourdit Task 7 pour un gain mineur (le toast d'erreur
  informe déjà l'utilisateur) — non fait ici, à ajouter dans une itération suivante si jugé
  nécessaire à l'usage.
