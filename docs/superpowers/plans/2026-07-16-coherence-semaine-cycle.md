# Cohérence Semaine/Cycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire disparaître la friction retour utilisateurs entre la vue Cycle de `/planning` et `/courses` : génération accessible depuis la vue Cycle, navigation cohérente entre les deux pages, choix de vue Semaine/Cycle mémorisé.

**Architecture:** Aucun changement de modèle de données. Trois axes indépendants dans `lib/sync.ts`/`lib/cycles.ts`/`lib/stockage.ts` : (1) une fonction de génération partagée entre `/courses` et `VuePlanningCycle` ; (2) un relais one-shot par query param (`?ancre=`) pour que `/courses` s'ouvre sur le cycle qu'on regardait, sans toucher au comportement de `hydraterCycle` (qui reste "reset au défaut du jour à chaque montage", cf. §3.b de la spec) ; (3) un nouveau store localStorage pour persister le choix de vue.

**Tech Stack:** Next.js 16 App Router, React 19 (`useSyncExternalStore`, hooks), TypeScript strict, Vitest.

## Global Constraints

- Tout le code (identifiants, commentaires, messages) est en **français**, cf. CLAUDE.md.
- TypeScript strict : ne jamais contourner une erreur de typage.
- Aucun `try/catch` vide — toute erreur capturée est loggée ou affichée.
- Ne pas committer directement sur `main` — travailler sur une branche (`docs/specs-coherence-cycle-prochain-repas` existe déjà avec les specs ; créer/continuer une branche de travail dédiée pour le code, ex. `feat/279-coherence-semaine-cycle`, à partir de `main`).
- Avant d'ouvrir la PR : lancer `npm run test:e2e:staging` (specs `planning.spec`, `planning-edition.spec`, `courses.spec`, `cycle-courses.spec`, `alerte-planning.spec` a minima — ce chantier touche navigation cycle et génération), cf. règle CLAUDE.md « E2E sur staging avant PR ».
- Spec de référence : `docs/superpowers/specs/2026-07-16-coherence-semaine-cycle-design.md` (lire avant de commencer — ce plan l'implémente).

---

### Task 1: `lundiDeSemaine` exportée + `ancreDeSemaine` (lib/cycles.ts)

**Files:**
- Modify: `lib/semaines.ts:105` (retirer le mot-clé privé, juste ajouter `export`)
- Modify: `lib/cycles.ts` (ajouter `ancreDeSemaine`, en fin de fichier)
- Test: `tests/cycles.test.ts`

**Interfaces:**
- Consomme : `lundiDeSemaine(semaine: string): Date` (déjà existante dans `lib/semaines.ts`, juste rendue publique), `ancreCourante(aujourdhui: Date, jourCourses: number): string` (déjà exportée dans `lib/cycles.ts`).
- Produit : `ancreDeSemaine(semaine: string, jourCourses: number): string` — utilisée par Task 8 (`app/planning/page.tsx`).

- [ ] **Step 1: Exporter `lundiDeSemaine`**

Dans `lib/semaines.ts:105`, remplacer :
```ts
function lundiDeSemaine(semaine: string): Date {
```
par :
```ts
export function lundiDeSemaine(semaine: string): Date {
```

- [ ] **Step 2: Écrire le test qui échoue pour `ancreDeSemaine`**

Ajouter à la fin de `tests/cycles.test.ts` :
```ts
describe("ancreDeSemaine", () => {
  it("trouve l'ancre du cycle qui contient la semaine (jour de courses AVANT jeudi)", () => {
    // Semaine 2026-W28 = lundi 6 juillet → dimanche 12 juillet. Jour de courses
    // lundi (1) : l'ancre de cette semaine est son propre lundi.
    expect(ancreDeSemaine("2026-W28", 1)).toBe("2026-07-06")
  })
  it("trouve l'ancre du cycle qui contient la semaine (jour de courses APRÈS jeudi)", () => {
    // Jour de courses vendredi (5) : le jeudi de 2026-W28 (9 juillet) est APRÈS
    // le dernier vendredi (3 juillet, semaine précédente) → l'ancre est ce
    // vendredi-là, pas un vendredi de cette semaine.
    expect(ancreDeSemaine("2026-W28", 5)).toBe("2026-07-03")
  })
  it("cohérent avec ancreCourante sur la semaine courante", () => {
    const aujourdhui = new Date("2026-07-08T10:00:00") // mercredi 2026-W28
    const semaine = semaineISO(aujourdhui)
    expect(ancreDeSemaine(semaine, 4)).toBe(ancreCourante(aujourdhui, 4))
  })
})
```

Et adapter l'import en tête de fichier (ajouter `ancreDeSemaine` et `semaineISO`) :
```ts
import {
  ancreCourante, ancreDeSemaine, ancreParDefaut, cycleDecale, joursDuCycle, semainesDuCycle,
  dateVersSemaineJour, libelleCycle, cyclesSelectionnables, LONGUEUR_DEFAUT,
  planningDuCycle, planningGenereParSemaine,
} from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

Run: `npm run test:run -- tests/cycles.test.ts`
Expected: FAIL — `ancreDeSemaine is not a function` (ou erreur d'import TypeScript).

- [ ] **Step 4: Implémenter `ancreDeSemaine`**

Ajouter à la fin de `lib/cycles.ts` :
```ts
import { lundiDeSemaine, semaineISO } from "@/lib/semaines"
```
(remplacer la ligne d'import existante `import { semaineISO } from "@/lib/semaines"` par celle-ci, en ajoutant `lundiDeSemaine`.)

Puis, en fin de fichier :
```ts
/**
 * Ancre du cycle qui CONTIENT la semaine ISO donnée (#279, dérivation
 * Semaine → Courses). Référence = jeudi de la semaine (même ancrage que
 * `saisonDeSemaine` de lib/semaines.ts) : le jeudi porte déjà l'année ISO, et
 * comme les ancres sont espacées de 7 j (cadence hebdomadaire fixe, cf. #257
 * D8), il n'existe qu'une seule ancre ≤ jeudi qui couvre effectivement cette
 * semaine — peu importe où tombe jourCourses dans la semaine.
 */
export function ancreDeSemaine(semaine: string, jourCourses: number): string {
  const jeudi = lundiDeSemaine(semaine)
  jeudi.setDate(jeudi.getDate() + 3)
  return ancreCourante(jeudi, jourCourses)
}
```

- [ ] **Step 5: Lancer le test, vérifier le succès**

Run: `npm run test:run -- tests/cycles.test.ts`
Expected: PASS (tous les tests du fichier, y compris les 3 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add lib/semaines.ts lib/cycles.ts tests/cycles.test.ts
git commit -m "feat: ancreDeSemaine — dérive l'ancre du cycle contenant une semaine ISO (#279)"
```

---

### Task 2: `definirCycleAffiche` exportée + `allerAuCycle` (lib/sync.ts)

**Files:**
- Modify: `lib/sync.ts:222` (export de `definirCycleAffiche`), fin de fichier (nouvelle fonction `allerAuCycle`)
- Test: `lib/sync.test.ts`

**Interfaces:**
- Consomme : `attendreSync(): Promise<boolean>`, `chargerLongueurCycle(ancre: string): Promise<number>` (de `lib/persistance.ts`, déjà importée), `chargerCycleDansCache(ancre: string, longueur: number): Promise<void>` (privée, même module).
- Produit : `export function definirCycleAffiche(ancre: string, longueur: number): void` (déjà existait, non exportée) ; `export async function allerAuCycle(ancre: string): Promise<void>` — utilisée par Task 4 et Task 7.

- [ ] **Step 1: Exporter `definirCycleAffiche`**

Dans `lib/sync.ts:222`, remplacer :
```ts
function definirCycleAffiche(ancre: string, longueur: number): void {
```
par :
```ts
export function definirCycleAffiche(ancre: string, longueur: number): void {
```

- [ ] **Step 2: Étendre le mock `persistance` du test (préalable, pour ne pas casser le test à écrire)**

Dans `lib/sync.test.ts`, le `vi.hoisted` en tête de fichier (lignes 15-24) devient :
```ts
const persistance = vi.hoisted(() => ({
  chargerPlanningDistant: vi.fn(),
  chargerCochesDistantes: vi.fn(),
  sauvegarderPlanningDistant: vi.fn(),
  purgerSemainesAvant: vi.fn(),
  chargerFoyerId: vi.fn(),
  cocherArticleDistant: vi.fn(),
  decocherArticleDistant: vi.fn(),
  viderCochesDistantes: vi.fn(),
  chargerLongueurCycle: vi.fn(),
  chargerArticlesManuelsDistants: vi.fn(),
}));
```

Et dans le `beforeEach` (lignes 60-71), ajouter deux lignes :
```ts
  persistance.chargerLongueurCycle.mockResolvedValue(7);
  persistance.chargerArticlesManuelsDistants.mockResolvedValue([]);
```

- [ ] **Step 3: Écrire le test qui échoue pour `allerAuCycle`**

Ajouter à `lib/sync.test.ts`, après le bloc `describe("naviguerVers — flush avant navigation (RG-24)", ...)` (après la ligne 198) :
```ts
describe("allerAuCycle — relais one-shot par query param (#279)", () => {
  it("flushe les écritures en attente PUIS charge l'ancre cible, écrase le cycle affiché", async () => {
    localStorage.setItem(
      "cycle_affiche",
      JSON.stringify({ ancre: "2026-06-29", longueur: 7 })
    );
    persistance.chargerLongueurCycle.mockResolvedValue(9);
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { allerAuCycle } = await chargerSync();

    await allerAuCycle("2026-07-13");

    expect(persistance.chargerLongueurCycle).toHaveBeenCalledWith("2026-07-13");
    expect(JSON.parse(localStorage.getItem("cycle_affiche")!)).toEqual({
      ancre: "2026-07-13",
      longueur: 9,
    });
  });

  it("flushe le planning dirty avant de basculer d'ancre", async () => {
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    persistance.chargerLongueurCycle.mockResolvedValue(7);
    const { allerAuCycle } = await chargerSync();

    await allerAuCycle("2026-07-13");

    expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(); // flush d'abord
  });
});
```

- [ ] **Step 4: Lancer le test, vérifier l'échec**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: FAIL — `allerAuCycle is not a function` (ou undefined).

- [ ] **Step 5: Implémenter `allerAuCycle`**

Juste après la fonction `naviguerCycle` existante (après la ligne 1439, `export async function naviguerCycle(offset: number): Promise<void> { ... }`), ajouter :
```ts
/**
 * Navigue vers une ancre ABSOLUE (#279, relais one-shot `?ancre=` depuis
 * `/planning`) — miroir de `naviguerCycle`, mais sans décalage relatif : pas
 * besoin d'un cycle déjà affiché (contrairement à `naviguerCycle`, qui lit
 * `lireCycleAffiche()` pour calculer le décalage). Flush les écritures en
 * attente PUIS charge l'ancre cible. Appelée par `useSyncCourses` quand une
 * ancre est imposée au montage (cf. Task 4).
 */
export async function allerAuCycle(ancre: string): Promise<void> {
  if (!(await attendreSync())) return; // hors-ligne : ne pas perdre les écritures
  const longueur = await chargerLongueurCycle(ancre);
  await chargerCycleDansCache(ancre, longueur);
}
```

- [ ] **Step 6: Lancer le test, vérifier le succès**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: PASS (tous les tests du fichier, y compris les 2 nouveaux).

- [ ] **Step 7: Commit**

```bash
git add lib/sync.ts lib/sync.test.ts
git commit -m "feat: allerAuCycle — navigation cycle par ancre absolue (#279)"
```

---

### Task 3: `useSyncCourses` accepte une ancre forcée (lib/sync.ts)

**Files:**
- Modify: `lib/sync.ts:1583-1595` (signature et corps de `useSyncCourses`)
- Test: `lib/sync.test.ts`

**Interfaces:**
- Consomme : `allerAuCycle(ancre: string): Promise<void>` (Task 2), `hydraterCycle(): Promise<void>` (existante), `demarrerSyncCoches(): () => void` (existante, privée).
- Produit : `export function useSyncCourses(ancreForcee?: string | null): EtatSync` — signature étendue, **rétro-compatible** (paramètre optionnel, `app/courses/page.tsx` l'appelle aujourd'hui sans argument). Utilisée par Task 5 (`app/courses/page.tsx`).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `lib/sync.test.ts`, dans le même bloc que Task 2 (ou juste après) :
```ts
describe("useSyncCourses — ancre forcée court-circuite le défaut du jour (#279)", () => {
  it("sans ancre forcée : hydrate le défaut du jour (comportement inchangé)", async () => {
    persistance.chargerFoyerId.mockResolvedValue("foyer-1");
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { useSyncCourses } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");

    renderHook(() => useSyncCourses());
    await new Promise((r) => setTimeout(r, 0)); // laisse l'effet async se dérouler

    expect(localStorage.getItem("cycle_affiche")).not.toBeNull();
  });

  it("avec ancre forcée : bascule directement sur cette ancre, sans passer par le défaut du jour", async () => {
    persistance.chargerLongueurCycle.mockResolvedValue(7);
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { useSyncCourses } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");

    renderHook(() => useSyncCourses("2026-07-13"));
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(localStorage.getItem("cycle_affiche")!).ancre).toBe("2026-07-13");
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: FAIL sur le 2ᵉ test — l'ancre affichée vaut le défaut du jour (calculé par `ancreParDefaut`), pas `"2026-07-13"` (`useSyncCourses` ignore encore l'argument).

- [ ] **Step 3: Modifier `useSyncCourses`**

Remplacer (lignes 1583-1595) :
```ts
export function useSyncCourses(): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSyncCoches();
    void hydraterCycle();
    return arreter;
  }, []);
  return etatCourant;
}
```
par :
```ts
/**
 * Hook de page /courses (#257) : démarre la synchro des coches et hydrate le
 * CYCLE courant au montage (au lieu de la semaine). Renvoie l'état de synchro.
 * Ne wire ni le push planning ni le temps réel planning (cf. demarrerSyncCoches).
 *
 * `ancreForcee` (#279) : si fournie (relais one-shot depuis `/planning`, via
 * `?ancre=` sur le lien « Liste de courses → »), bascule DIRECTEMENT sur cette
 * ancre au montage, sans passer par le défaut du jour de `hydraterCycle` —
 * sinon ce défaut écraserait silencieusement l'ancre demandée (`hydraterCycle`
 * ne consulte jamais le cycle déjà affiché, cf. spec §3.b). Lue une seule fois
 * au montage (deps `[]`) : un changement de query param en cours de vie du
 * composant n'est pas un cas d'usage ici (l'appelant nettoie l'URL après coup).
 */
export function useSyncCourses(ancreForcee?: string | null): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSyncCoches();
    if (ancreForcee) {
      void allerAuCycle(ancreForcee);
    } else {
      void hydraterCycle();
    }
    return arreter;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ancreForcee lue une seule fois au montage, volontairement
  }, []);
  return etatCourant;
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npm run test:run -- lib/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync.ts lib/sync.test.ts
git commit -m "feat: useSyncCourses accepte une ancre forcée (relais one-shot #279)"
```

---

### Task 4: Hook `useGenerationCycle` partagé (lib/sync.ts)

**Files:**
- Modify: `lib/sync.ts` (nouveau hook, près de `appliquerGenerationCycle`)

**Interfaces:**
- Consomme : `appliquerGenerationCycle(semaines: Array<{ semaine: string; jours: JourPlanning[] }>): Promise<void>` (déjà existante), `CycleAffiche` (type déjà exporté).
- Produit : `export function useGenerationCycle(cycle: CycleAffiche | null): { enGeneration: boolean; genererCycle: () => Promise<ResultatGenerationCycle> }` où `ResultatGenerationCycle = { vegeNonHonore: number; mixNonHonore: number; saisonNonHonore: number }` (type exporté). `genererCycle` **lève** une `Error` (message déjà lisible via `parseApiError`) en cas d'échec réseau/serveur — à charge de l'appelant (`app/courses/page.tsx`, `components/planning/vue-cycle.tsx`) de `try/catch` et toaster. Utilisée par Task 5 et Task 7.

Ce hook n'a pas de test dédié (il ne fait qu'orchestrer `fetch` + `appliquerGenerationCycle`, déjà couvert indirectement par les e2e de génération réelle, CI-only — cf. contrainte projet : les e2e de génération ne valident qu'en CI). Son extraction est un pur regroupement de code existant (`app/courses/page.tsx:267-308`), sans changement de comportement observable — vérifié par la Task 5 (le bouton `/courses` doit se comporter à l'identique après le remplacement).

- [ ] **Step 1: Ajouter le type `ResultatGenerationCycle` et importer `useState`**

En tête de `lib/sync.ts`, la ligne d'import React devient :
```ts
import { useEffect, useState } from "react";
```

Et la ligne d'import de types :
```ts
import type { ArticleManuel, JourPlanning, Planning } from "@/types";
```

- [ ] **Step 2: Ajouter le hook `useGenerationCycle`**

Juste après la fonction `appliquerGenerationCycle` (après la ligne 1158, avant `rafraichirCycleGenere`) :
```ts
export type ResultatGenerationCycle = {
  vegeNonHonore: number;
  mixNonHonore: number;
  saisonNonHonore: number;
};

/**
 * Génération fenêtrée partagée entre `/courses` (bouton historique, #259) et
 * la vue Cycle de `/planning` (#279, D2) — extrait de l'ancien
 * `genererMonCycle` local à `app/courses/page.tsx`, comportement identique.
 * `genererCycle` lève en cas d'échec (réseau ou réponse non-ok, message déjà
 * formaté via `parseApiError` côté appelant) — pas de toast ici : cette
 * fonction vit dans `lib/`, le feedback UI reste la responsabilité de la page
 * (cf. CLAUDE.md règle 2, « app/ pour l'UI, lib/ pour la logique »).
 */
export function useGenerationCycle(cycle: CycleAffiche | null): {
  enGeneration: boolean;
  genererCycle: () => Promise<ResultatGenerationCycle>;
} {
  const [enGeneration, setEnGeneration] = useState(false);

  async function genererCycle(): Promise<ResultatGenerationCycle> {
    if (!cycle) throw new Error("Aucun cycle affiché.");
    setEnGeneration(true);
    try {
      const reponse = await fetch("/api/planning/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ancre: cycle.ancre, longueur: cycle.longueur }),
      });
      if (!reponse.ok) {
        const { parseApiError } = await import("@/lib/errors");
        throw new Error(await parseApiError(reponse));
      }
      const {
        semaines,
        vegeNonHonore = 0,
        mixNonHonore = 0,
        saisonNonHonore = 0,
      } = (await reponse.json()) as {
        semaines: Array<{ semaine: string; jours: JourPlanning[] }>;
        vegeNonHonore?: number;
        mixNonHonore?: number;
        saisonNonHonore?: number;
      };
      await appliquerGenerationCycle(semaines);
      return { vegeNonHonore, mixNonHonore, saisonNonHonore };
    } finally {
      setEnGeneration(false);
    }
  }

  return { enGeneration, genererCycle };
}
```

> Note : l'import dynamique `await import("@/lib/errors")` évite d'ajouter une dépendance statique de plus en tête de `lib/sync.ts` (fichier déjà volumineux) pour un seul point d'usage rare (chemin d'erreur). Si `parseApiError` est déjà importé statiquement ailleurs dans `lib/sync.ts` au moment de l'implémentation (vérifier), préférer un import statique classique en tête de fichier à la place.

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add lib/sync.ts
git commit -m "feat: useGenerationCycle — génération de cycle partagée /courses + vue Cycle (#279)"
```

---

### Task 5: `/courses` consomme le hook partagé + applique le relais `?ancre=`

**Files:**
- Modify: `app/courses/page.tsx`

**Interfaces:**
- Consomme : `useGenerationCycle(cycle: CycleAffiche | null)` (Task 4), `useSyncCourses(ancreForcee?: string | null)` (Task 3), `useSearchParams` (`next/navigation`).
- Produit : aucune nouvelle interface publique — page terminale.

- [ ] **Step 1: Ajouter les imports nécessaires**

En tête de `app/courses/page.tsx`, la ligne :
```ts
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
```
devient :
```ts
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
```

Et dans le bloc d'import de `@/lib/sync` (lignes 46-61), ajouter `useGenerationCycle` :
```ts
import {
  useSyncCourses,
  usePresenceCourses,
  useCycleAffiche,
  useCyclePlanning,
  useArticlesManuels,
  useGenerationCycle,
  ajouterArticleManuel,
  modifierArticleManuel,
  supprimerArticleManuel,
  basculerCocheArticleManuel,
  viderCochesArticlesManuels,
  naviguerCycle,
  etirerCycle,
  appliquerGenerationCycle,
  type CycleAffiche,
} from "@/lib/sync";
```

(`appliquerGenerationCycle` reste importée : elle n'est plus appelée directement par cette page après cette tâche, mais si un autre usage la référence encore dans le fichier, garder l'import ; sinon, la retirer — vérifier à l'implémentation.)

- [ ] **Step 2: Renommer le composant et lire le paramètre `?ancre=`**

Remplacer (ligne 212) :
```ts
export default function PageCourses() {
  const hydrate = useHydratation();
```
par :
```ts
function ContenuCourses() {
  const hydrate = useHydratation();
  // Relais one-shot depuis /planning (#279) : ancre demandée via `?ancre=` sur
  // le lien « Liste de courses → ». Lue une seule fois (mount), cf. useSyncCourses.
  const searchParams = useSearchParams();
  const ancreForcee = searchParams.get("ancre");
```

- [ ] **Step 3: Passer l'ancre forcée à `useSyncCourses` et nettoyer l'URL**

Remplacer la ligne :
```ts
  useSyncCourses();
```
par :
```ts
  useSyncCourses(ancreForcee);

  // Nettoie le paramètre d'URL après lecture (#279) — même motif que
  // capterCodeDepuisURL (lib/invitation.ts) : éviter qu'un rechargement ou un
  // retour arrière ne re-déclenche le relais.
  useEffect(() => {
    if (!ancreForcee) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ancre");
    window.history.replaceState({}, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois au montage
  }, []);
```

- [ ] **Step 4: Remplacer `genererMonCycle` local par le hook partagé**

Remplacer (lignes 263-308) :
```ts
  // Génération fenêtrée « Générer mon cycle » (#259) : remplit d'un coup les
  // repas du cycle affiché (1-2 semaines ISO), sans quitter /courses.
  const [enGeneration, setEnGeneration] = useState(false);

  async function genererMonCycle(): Promise<void> {
    if (!cycle || enGeneration) return;
    setEnGeneration(true);
    try {
      const reponse = await fetch("/api/planning/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ancre: cycle.ancre, longueur: cycle.longueur }),
      });
      if (!reponse.ok) {
        toast.error(await parseApiError(reponse));
        return;
      }
      const {
        semaines,
        vegeNonHonore = 0,
        mixNonHonore = 0,
        saisonNonHonore = 0,
      } = (await reponse.json()) as {
        semaines: Array<{ semaine: string; jours: JourPlanning[] }>;
        vegeNonHonore?: number;
        mixNonHonore?: number;
        saisonNonHonore?: number;
      };
      // Persiste chaque semaine touchée (sauvegarder_slots), invalide les coches
      // du cycle (RG-13) et re-projette depuis la base (cf. lib/sync.ts).
      await appliquerGenerationCycle(semaines);
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error("Impossible de générer le cycle. Vérifie ta connexion et réessaie.");
    } finally {
      setEnGeneration(false);
    }
  }
```
par :
```ts
  // Génération fenêtrée « Générer mon cycle » (#259, hook partagé #279) :
  // remplit d'un coup les repas du cycle affiché (1-2 semaines ISO), sans
  // quitter /courses.
  const { enGeneration, genererCycle } = useGenerationCycle(cycle);

  async function genererMonCycle(): Promise<void> {
    if (enGeneration) return;
    try {
      const { vegeNonHonore, mixNonHonore, saisonNonHonore } = await genererCycle();
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error(
        erreur instanceof Error
          ? erreur.message
          : "Impossible de générer le cycle. Vérifie ta connexion et réessaie."
      );
    }
  }
```

- [ ] **Step 5: Ajouter la frontière Suspense (export par défaut)**

En toute fin de fichier, après la fermeture de `ContenuCourses` (dernière accolade fermante de la fonction, là où se trouvait l'ancien `export default function PageCourses() { ... }`), ajouter :
```tsx
export default function PageCourses() {
  // Frontière Suspense exigée par useSearchParams (Next 16, cf. app/recettes/page.tsx).
  return (
    <Suspense
      fallback={
        <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
          <p role="status" className="animate-pulse text-lg text-brand-700/85">
            Chargement…
          </p>
        </main>
      }
    >
      <ContenuCourses />
    </Suspense>
  );
}
```

- [ ] **Step 6: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

Run: `npm run lint`
Expected: aucune nouvelle erreur (en particulier pas d'import inutilisé : si `appliquerGenerationCycle` n'est plus référencée directement dans ce fichier après Step 4, retirer son import).

- [ ] **Step 7: Vérification manuelle (dev server)**

Run: `npm run dev`, ouvrir `/courses` dans le navigateur (instance `.env.local`, cf. contrainte projet — les e2e de génération réelle ne se valident qu'en CI, mais un aller-retour manuel vérifie l'absence de régression visuelle/fonctionnelle du bouton « Générer mon cycle » existant).
Expected: le bouton « Générer mon cycle » se comporte comme avant (toast succès/erreur, avertissements).

- [ ] **Step 8: Commit**

```bash
git add app/courses/page.tsx
git commit -m "refactor: /courses consomme useGenerationCycle + relais one-shot ?ancre= (#279)"
```

---

### Task 6: Vue Cycle — bouton génération + lien courses + ancre partagée (components/planning/vue-cycle.tsx)

**Files:**
- Modify: `components/planning/vue-cycle.tsx`

**Interfaces:**
- Consomme : `definirCycleAffiche(ancre: string, longueur: number): void` (Task 2), `useGenerationCycle(cycle: CycleAffiche | null)` (Task 4), `messagesAvertissementGeneration` (déjà utilisée ailleurs dans l'app, `lib/avertissements-generation.ts`).
- Produit : aucune nouvelle prop publique de `VuePlanningCycle` (signature inchangée : `{ idsModifiables }`).

- [ ] **Step 1: Ajouter les imports**

En tête de `components/planning/vue-cycle.tsx`, ajouter `Link` (Next) et `Sparkles` (lucide), et étendre les imports de `@/lib/sync` et `@/lib/avertissements-generation` :
```tsx
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ancreParDefaut,
  cycleDecale,
  dateVersSemaineJour,
  joursDuCycle,
  libelleCycle,
  LONGUEUR_DEFAUT,
} from "@/lib/cycles";
import { personnesDuSlot } from "@/lib/personnes";
import { estRestes } from "@/lib/restes";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { chargerLongueurCycle, chargerPlanningDistant } from "@/lib/persistance";
import { creneauActif } from "@/lib/generateur";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { definirCycleAffiche, useGenerationCycle } from "@/lib/sync";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { JourPlanning, Planning, Recette, ReglagesGeneration } from "@/types";
```

- [ ] **Step 2: Répercuter l'ancre/longueur dans `cycle_affiche` à chaque changement**

Dans `chargerCycle` (le `useCallback` existant), ajouter l'appel à `definirCycleAffiche` juste après avoir résolu `long` — remplacer :
```ts
  const chargerCycle = useCallback(async (ancreCible: string) => {
    setChargement(true);
    try {
      const long = await chargerLongueurCycle(ancreCible).catch(() => LONGUEUR_DEFAUT);
      const semaines = Array.from(
        new Set(
          joursDuCycle(ancreCible, long).map((d) => dateVersSemaineJour(d).semaine)
        )
      );
      const resultats = await Promise.all(
        semaines.map((s) => chargerPlanningDistant(s).catch(() => null))
      );
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const r = resultats[i];
        if (r) map.set(s, r.planning);
      });
      setLongueur(long);
      setParSemaine(map);
      setAncre(ancreCible);
    } finally {
      setChargement(false);
    }
  }, []);
```
par :
```ts
  const chargerCycle = useCallback(async (ancreCible: string) => {
    setChargement(true);
    try {
      const long = await chargerLongueurCycle(ancreCible).catch(() => LONGUEUR_DEFAUT);
      const semaines = Array.from(
        new Set(
          joursDuCycle(ancreCible, long).map((d) => dateVersSemaineJour(d).semaine)
        )
      );
      const resultats = await Promise.all(
        semaines.map((s) => chargerPlanningDistant(s).catch(() => null))
      );
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const r = resultats[i];
        if (r) map.set(s, r.planning);
      });
      setLongueur(long);
      setParSemaine(map);
      setAncre(ancreCible);
      // Répercute dans le store partagé (#279) : nécessaire pour que la
      // génération (Step 3 ci-dessous) et le lien « Liste de courses → » (Step 4)
      // ciblent le MÊME cycle que celui affiché ici. Écriture localStorage pure,
      // sans effet de bord coches/réaltime (cf. definirCycleAffiche).
      definirCycleAffiche(ancreCible, long);
    } finally {
      setChargement(false);
    }
  }, []);
```

- [ ] **Step 3: Ajouter le bouton « Générer mon cycle »**

Ajouter un état dérivé juste après la déclaration de `reglages` :
```ts
  const { enGeneration, genererCycle } = useGenerationCycle(
    ancre !== null ? { ancre, longueur } : null
  );

  async function genererMonCycle(): Promise<void> {
    if (enGeneration) return;
    try {
      const { vegeNonHonore, mixNonHonore, saisonNonHonore } = await genererCycle();
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
      // Recharge la projection affichée pour refléter le nouveau contenu.
      if (ancre !== null) void chargerCycle(ancre);
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error(
        erreur instanceof Error
          ? erreur.message
          : "Impossible de générer le cycle. Vérifie ta connexion et réessaie."
      );
    }
  }
```

Puis, dans le JSX, remplacer l'en-tête (navigateur de cycle) :
```tsx
      {/* Navigateur de cycle (miroir de /courses) + libellé de la fenêtre. */}
      <div className="mb-6 flex items-center gap-2">
        <button
          type="button"
          aria-label="Cycle précédent"
          onClick={() => void chargerCycle(cycleDecale(ancre, -1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-[12rem] text-center text-sm font-medium text-brand-900"
        >
          {libelleCycle(ancre, longueur)}
        </span>
        <button
          type="button"
          aria-label="Cycle suivant"
          onClick={() => void chargerCycle(cycleDecale(ancre, 1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
```
par :
```tsx
      {/* Navigateur de cycle (miroir de /courses) + libellé de la fenêtre +
          actions (#279 : génération + accès courses, directement ici). */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Cycle précédent"
          onClick={() => void chargerCycle(cycleDecale(ancre, -1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-[12rem] text-center text-sm font-medium text-brand-900"
        >
          {libelleCycle(ancre, longueur)}
        </span>
        <button
          type="button"
          aria-label="Cycle suivant"
          onClick={() => void chargerCycle(cycleDecale(ancre, 1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void genererMonCycle()}
          disabled={enGeneration}
          className="relative inline-flex items-center gap-1.5 rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          {enGeneration ? "Génération…" : "Générer mon cycle"}
        </button>
        <Link
          href={`/courses?ancre=${ancre}`}
          className="relative rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Liste de courses →
        </Link>
      </div>
```

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle**

Run: `npm run dev`, ouvrir `/planning`, basculer sur « Cycle », vérifier : le bouton « Générer mon cycle » génère (toast succès), le lien « Liste de courses → » emmène sur `/courses` avec la bonne fenêtre affichée (même ancre), et la navigation par chevrons continue de fonctionner.

- [ ] **Step 6: Commit**

```bash
git add components/planning/vue-cycle.tsx
git commit -m "feat: génération + lien courses contextuel depuis la vue Cycle (#279)"
```

---

### Task 7: `/planning` — retirer le lien dupliqué, dériver l'ancre pour la vue Semaine

**Files:**
- Modify: `app/planning/page.tsx`

**Interfaces:**
- Consomme : `ancreDeSemaine(semaine: string, jourCourses: number): string` (Task 1), `chargerJourCoursesFoyer(): Promise<number>` (`lib/foyer.ts`, déjà utilisée ailleurs dans le projet).

- [ ] **Step 1: Charger le jour de courses du foyer au montage**

Ajouter l'import :
```ts
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { ancreDeSemaine } from "@/lib/cycles";
```

Ajouter un état, à côté de la déclaration de `preferences` (dans le composant `PagePlanning`) :
```ts
  // Jour de courses du foyer (#279) : nécessaire pour dériver l'ancre du cycle
  // qui contient la semaine affichée (lien « Liste de courses → »). Fail-open
  // lundi (1), même repli que VuePlanningCycle/hydraterCycle.
  const [jourCourses, setJourCourses] = useState(1);
```

Et dans le `useEffect` de montage existant (celui qui charge recettes/réglages/préférences), ajouter un chargement parallèle :
```ts
    chargerJourCoursesFoyer()
      .then((j) => {
        if (actif) setJourCourses(j);
      })
      .catch((erreur) => {
        console.error("Chargement du jour de courses échoué (défaut lundi).", erreur);
      });
```
(à insérer juste avant le `return () => { actif = false; };` du même effet.)

- [ ] **Step 2: Dériver l'ancre cible pour les 2 liens de la vue Semaine**

Juste avant le `return` de la branche vue Cycle (avant `if (vue === "cycle") { ... }`), ajouter :
```ts
  // Ancre du cycle qui contient la semaine affichée (#279, D4) — utilisée par
  // les liens « Liste de courses → » de la vue Semaine (vide et chargée).
  const ancreCourses = semaineAffichee ? ancreDeSemaine(semaineAffichee, jourCourses) : null;
```

- [ ] **Step 3: Retirer le lien dupliqué de la branche vue Cycle**

Dans la branche `if (vue === "cycle") { ... }`, remplacer :
```tsx
          <div className="flex items-center gap-2">
            <BasculeVue vue={vue} onChange={setVue} />
            <Link
              href="/courses"
              className="relative rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Liste de courses →
            </Link>
          </div>
```
par :
```tsx
          <div className="flex items-center gap-2">
            <BasculeVue vue={vue} onChange={setVue} />
          </div>
```
(le lien vit désormais dans `VuePlanningCycle` elle-même, cf. Task 6 — évite la duplication et le prop-drilling de l'ancre affichée.)

- [ ] **Step 4: Faire pointer les 2 liens de la vue Semaine vers l'ancre dérivée**

Dans la branche « chargée » (autour de la ligne 820-825), remplacer :
```tsx
          <Link
            href="/courses"
            className="relative flex-1 rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:flex-none"
          >
            Liste de courses →
          </Link>
```
par :
```tsx
          <Link
            href={ancreCourses ? `/courses?ancre=${ancreCourses}` : "/courses"}
            className="relative flex-1 rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:flex-none"
          >
            Liste de courses →
          </Link>
```

> Il n'y a qu'**un seul** autre lien `href="/courses"` dans ce fichier (vérifié par grep en amont de ce plan) : celui de la branche « chargée » ci-dessus. La branche « vide » (planning === null) n'en a pas. Si l'implémenteur en trouve un autre à ce stade, appliquer le même remplacement par cohérence.

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add app/planning/page.tsx
git commit -m "feat: lien Liste de courses dérive l'ancre du cycle depuis la semaine affichée (#279)"
```

---

### Task 8: Persistance du choix de vue (lib/stockage.ts + app/planning/page.tsx)

**Files:**
- Modify: `lib/stockage.ts`
- Modify: `app/planning/page.tsx:324`

**Interfaces:**
- Produit : `export const storeVuePlanning: StoreLocal` (`lib/stockage.ts`, pattern `creerStoreLocal`, déjà exportée en interne du fichier).

- [ ] **Step 1: Ajouter le store**

Dans `lib/stockage.ts`, après la ligne :
```ts
export const storeCoches = creerStoreLocal("courses_cochees")
```
ajouter :
```ts

/** Choix de vue Semaine/Cycle sur /planning (#279, D5), clé `vue_planning`. */
export const storeVuePlanning = creerStoreLocal("vue_planning")
```

- [ ] **Step 2: Remplacer le `useState` nu de la page planning**

Dans `app/planning/page.tsx`, ajouter `storeVuePlanning` à l'import existant de `lib/stockage` :
```ts
import {
  storePlanning,
  storeVuePlanning,
  sauvegarderPlanningComplet,
  sauvegarderRemplacementSlot,
  capturerSnapshotAnnulation,
  restaurerSnapshotAnnulation,
} from "@/lib/stockage";
```

Remplacer (ligne 324) :
```ts
  // Vue affichée (#260, PR3) : « semaine » (calendaire, driver quotidien, défaut)
  // ou « cycle » (fenêtre de courses, lecture seule). Défaut semaine = comportement
  // inchangé ; état éphémère (non persisté).
  const [vue, setVue] = useState<"semaine" | "cycle">("semaine");
```
par :
```ts
  // Vue affichée (#260, PR3) : « semaine » (calendaire, driver quotidien, défaut)
  // ou « cycle » (fenêtre de courses, lecture seule). Persistée (#279, D5) via
  // storeVuePlanning — un choix explicite pour la vue Cycle survit au reload.
  const vueBrute = useSyncExternalStore(
    storeVuePlanning.sAbonner,
    storeVuePlanning.lire,
    storeVuePlanning.lireServeur
  );
  const vue: "semaine" | "cycle" = vueBrute === "cycle" ? "cycle" : "semaine";
  function setVue(v: "semaine" | "cycle"): void {
    storeVuePlanning.ecrire(v);
  }
```

- [ ] **Step 2bis: Vérifier qu'aucun autre `setVue(...)` du fichier ne suppose une signature `Dispatch<SetStateAction<...>>`**

`BasculeVue` (composant local) appelle `onChange={setVue}` avec une valeur directe (`"semaine"` ou `"cycle"`), jamais de forme fonctionnelle `setVue(v => ...)` — compatible tel quel avec la nouvelle signature `(v: "semaine" | "cycle") => void`. Vérifier par grep qu'aucun autre appel à `setVue` n'utilise la forme fonctionnelle avant de considérer cette étape close :

Run: `grep -n "setVue(" app/planning/page.tsx`
Expected: uniquement des appels avec une valeur littérale ou une variable `"semaine" | "cycle"`, jamais `setVue((v) => ...)`.

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle**

Run: `npm run dev`, basculer sur « Cycle », recharger la page (F5) : la vue Cycle doit rester affichée (au lieu de retomber sur Semaine).

- [ ] **Step 5: Commit**

```bash
git add lib/stockage.ts app/planning/page.tsx
git commit -m "feat: persiste le choix de vue Semaine/Cycle (#279, D5)"
```

---

### Task 9: Harmonisation visuelle de l'en-tête (D6)

**Files:**
- Modify: `app/planning/page.tsx`

**Interfaces:** aucune — changement purement visuel (classes CSS), pas de nouvelle interface.

- [ ] **Step 1: Comparer les deux en-têtes**

Relire la branche vue Cycle (en-tête `<header>` avec `h1` « Mon planning » + `BasculeVue`) et la branche vue Semaine chargée (en-tête `<header>` avec `h1` « Mon planning de la semaine » + indicateur de synchro + actions). Constat attendu : les deux `<header>` partagent déjà la même classe (`mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center`) et la même classe de `h1` (`font-display text-2xl font-semibold text-brand-900`) — vérifié en lisant le fichier avant cette tâche. Le saut perceptible vient du **libellé de période**, absent du `h1` dans les deux cas (il est en-dessous en vue Semaine, via `NavigateurSemaine`, et à droite en vue Cycle, via le libellé du navigateur cycle) : les DEUX zones de libellé de période ont déjà une taille de texte proche (`text-sm`) mais un poids et une position différents.

- [ ] **Step 2: Harmoniser la position du libellé de période**

Dans la branche vue Cycle, le conteneur du libellé (`<span aria-live="polite" className="min-w-[12rem] text-center text-sm font-medium text-brand-900">`, désormais dans `vue-cycle.tsx` après Task 6) reste à sa place (à côté des chevrons, sous le `h1`) — c'est déjà la même position relative que `NavigateurSemaine` (sous le `h1`, au-dessus des actions). Aucun changement de structure JSX supplémentaire n'est nécessaire : la Task 6 a déjà aligné le rendu (navigateur + actions sur une ligne, sous le titre) sur le même schéma que la vue Semaine. Cette étape consiste donc à **vérifier visuellement** (pas de code à écrire) qu'aucun saut de layout ne subsiste après les Tasks 6-8.

Run: `npm run dev`, basculer Semaine ↔ Cycle plusieurs fois sur `/planning` (desktop et mobile — devtools responsive, 390×844), observer : le titre reste à la même position, la zone juste en dessous (libellé + actions) ne change pas de hauteur de façon perceptible.

- [ ] **Step 3: Ajuster si un saut est visible**

Si un écart de hauteur apparaît (ex. la vue Semaine affiche un indicateur de synchro optionnel qui décale tout), ajuster uniquement les classes CSS concernées (pas de changement de contenu/texte) pour que les deux en-têtes réservent la même hauteur minimale — par exemple ajouter `min-h-[1.25rem]` sur le conteneur de l'indicateur de synchro dans la branche Semaine, pour qu'il occupe sa place même quand `etatSync === "synchronise"` (actuellement rendu conditionnellement, `{etatSync !== "synchronise" && (...)}`, ce qui EST la source d'un éventuel saut). Documenter le choix retenu dans un commentaire bref si un ajustement est fait.

- [ ] **Step 4: Commit (si un ajustement CSS a été nécessaire)**

```bash
git add app/planning/page.tsx
git commit -m "style: harmonise la hauteur d'en-tête entre vue Semaine et vue Cycle (#279, D6)"
```

Si aucun ajustement n'était nécessaire (Step 2 suffisant), ne pas créer de commit vide — passer directement à la Task 10.

---

### Task 10: Nouvelle couverture e2e (comportements #279)

**Files:**
- Create: `e2e/coherence-semaine-cycle.spec.ts`

**Interfaces:** aucune — spec e2e, patron `e2e/cycle-courses.spec.ts` (import `nettoyerEtatDistant`, `reinitialiserJourCoursesDistant` de `./helpers`).

- [ ] **Step 1: Écrire la spec**

```ts
// e2e/coherence-semaine-cycle.spec.ts
// Couverture des retours utilisateurs #279 : génération depuis la vue Cycle,
// cohérence de fenêtre entre /planning (vue Cycle) et /courses, persistance
// du choix de vue.

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test("« Générer mon cycle » est accessible et fonctionne depuis la vue Cycle de /planning", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Générer mon cycle" })).toBeVisible();

  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  // Une recette apparaît dans la projection (génération réelle, catalogue seedé CI-only).
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });
});

test("le lien « Liste de courses → » depuis la vue Cycle conserve la même fenêtre", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  const libelleCycle = await page.getByText(/Courses du/).textContent();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await expect(page).toHaveURL(/\/courses\?ancre=/);
  // Même fenêtre affichée des deux côtés (pas de saut vers le défaut du jour).
  await expect(page.getByText(libelleCycle!)).toBeVisible();
  // Le paramètre est nettoyé après application (pas de re-déclenchement au reload).
  await page.reload();
  await expect(page).toHaveURL(/\/courses$/);
});

test("le choix de vue Cycle survit au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();
});
```

- [ ] **Step 2: Lancer contre staging**

Run: `npm run test:e2e:staging -- coherence-semaine-cycle.spec --retries=2`
Expected: tous verts (génération réelle → CI-only fiable, cf. contrainte projet).

- [ ] **Step 3: Commit**

```bash
git add e2e/coherence-semaine-cycle.spec.ts
git commit -m "test: e2e génération vue Cycle + cohérence fenêtre + persistance vue (#279)"
```

---

### Task 11: Documentation utilisateur (Notion)

**Files:** aucun fichier du repo modifié directement — la source de vérité est la base Notion
« Guide OMQ » (cf. CLAUDE.md, doc `/aide`). Après l'édition Notion : `content/aide/*` régénéré par
`npm run pull:aide`.

- [ ] **Step 1: Identifier l'article existant à amender**

Chercher dans la base Notion (section « Planning ») un article existant qui documente la vue
Cycle. S'il existe, y ajouter un paragraphe mentionnant que « Générer mon cycle » est désormais
accessible directement depuis cette vue (avant : uniquement sur la page Courses).

- [ ] **Step 2: Ajouter un article si aucun n'existe déjà sur le sujet**

Section « Planning », statut « Publié », contenu bref (2-3 paragraphes) : ce qu'est la vue Cycle,
comment y générer, comment elle reste synchronisée avec la liste de courses.

- [ ] **Step 3: Régénérer le contenu committé**

Run: `npm run pull:aide`
Expected: `content/aide/<slug>.md` mis à jour ou créé, `content/aide/index.json` à jour.

- [ ] **Step 4: Commit**

```bash
git add content/aide public/aide
git commit -m "docs: doc utilisateur — génération depuis la vue Cycle (#279)"
```

---

### Task 12: Vérification e2e avant PR

**Files:** aucun changement de code — étape de validation.

- [ ] **Step 1: Lancer les e2e concernés contre staging**

Run: `npm run test:e2e:staging -- planning.spec planning-edition.spec courses.spec cycle-courses.spec alerte-planning.spec coherence-semaine-cycle.spec --retries=2`

Expected: tous verts. Ce chantier touche la navigation cycle (`cycle-courses.spec`), la génération (`planning.spec`, `cycle-courses.spec`), les en-têtes de `/planning` (`planning.spec`, `planning-edition.spec`), et indirectement l'alerte temps réel du planning (`alerte-planning.spec`, car elle dépend de `cycle_affiche`/`useSyncCourses`).

- [ ] **Step 2: Si un test casse**

Ne pas corriger en boucle sans comprendre : lire le message d'échec, identifier si la cause est un test qui présumait l'ancien comportement (ex. un test qui ouvrait `/courses` en s'attendant au cycle par défaut du jour, alors qu'il y arrive maintenant via un lien `?ancre=` d'un autre test dans la même session — peu probable ici car chaque test repart d'un état propre, mais à vérifier) ou une régression réelle introduite par ce plan.

- [ ] **Step 3: Une fois vert, ouvrir la PR**

Suivre le format standard du projet (titre court, résumé des décisions D1-D6, lien vers la spec et vers les issues #279).

---

## Self-Review (effectué avant remise du plan)

- **Couverture de la spec** : D1 (un seul chantier) → toutes les tasks forment un chantier unique. D2 (génération vue Cycle) → Tasks 4, 6. D3 (répercussion ancre, révisée) → Tasks 2, 6 (`definirCycleAffiche`). D4 (dérivation Semaine→Courses) → Tasks 1, 3, 5, 7. D5 (persistance vue) → Task 8. D6 (harmonisation visuelle) → Task 9.
- **Placeholders** : aucun « TBD »/« à compléter » — chaque step contient le code exact. Task 9 a une étape de vérification visuelle sans diff garanti à l'avance (dépend du rendu réel) — c'est un choix assumé (ajustement CSS mineur, pas une inconnue architecturale), pas un trou de spec.
- **Cohérence des types** : `CycleAffiche` (Task 2, `lib/sync.ts`) utilisé identiquement en Task 4/5/6. `ResultatGenerationCycle` défini en Task 4, consommé en Task 5 et 6 avec les mêmes noms de champs (`vegeNonHonore`/`mixNonHonore`/`saisonNonHonore`). `ancreDeSemaine(semaine, jourCourses)` (Task 1) et son seul appelant (Task 7) utilisent le même ordre de paramètres.
- **Risque le plus élevé du plan** : Task 3 (modification de `useSyncCourses`, fonction déjà utilisée en production) — mitigé par un test couvrant explicitement le cas SANS ancre forcée (non-régression) avant le cas avec.
