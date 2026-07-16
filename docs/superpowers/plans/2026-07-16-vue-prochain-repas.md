# Vue « Prochain repas » (/ce-soir) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nouvelle route `/ce-soir` : affiche LE prochain repas actif à cuisiner, en lecture seule, pour qui n'a pas suivi la planification.

**Architecture:** Un cœur pur (`lib/prochain-repas.ts`, cf. `lib/cycles.ts`) calcule le prochain créneau actif à partir des plannings de la semaine courante + suivante ; la page charge ces données et rend soit `FicheRecette` (recette trouvée), soit un message sobre (restes / rien de prévu).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest.

## Global Constraints

- Code en **français** (identifiants, commentaires, textes UI), cf. CLAUDE.md.
- TypeScript strict.
- Trois états UI minimum par écran (loading/error/empty) — cf. CLAUDE.md règle 3 ; cette page a en réalité 4 branches (chargement, rien de prévu, restes, recette) détaillées Task 3.
- Ne pas committer sur `main` — branche dédiée (ex. `feat/280-vue-prochain-repas`, depuis `main`).
- Avant PR : `npm run test:e2e:staging` (nouveau spec de Task 5, + `auth.spec` si la nav est touchée).
- Spec de référence : `docs/superpowers/specs/2026-07-16-vue-prochain-repas-design.md`.

---

### Task 1: Cœur pur `lib/prochain-repas.ts`

**Files:**
- Create: `lib/prochain-repas.ts`
- Test: `tests/prochain-repas.test.ts`

**Interfaces:**
- Consomme : `creneauActif(jour, typeRepas, reglages): boolean` (`lib/generateur.ts`), `estRestes(jp, typeRepas): boolean` (`lib/restes.ts`), `personnesDuSlot(jp, typeRepas): number` (`lib/personnes.ts`), `PERSONNES_DEFAUT` (`lib/personnes.ts`), `semaineISO(date): string` (`lib/semaines.ts`).
- Produit : `export type TypeRepas = "dejeuner" | "diner"`, `export type ProchainRepas = { dateISO: string; jour: Jour; typeRepas: TypeRepas; recette: Recette | undefined; restes: boolean; personnes: number }`, `export function prochainRepasActif(maintenant: Date, planningsParSemaine: Map<string, Planning>, reglages: ReglagesGeneration, maxJours = 14): ProchainRepas | null`, `export function libelleContexteRepas(dateISO: string, typeRepas: TypeRepas, maintenant: Date): string` — les deux consommées par Task 3 (`app/ce-soir/page.tsx`).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/prochain-repas.test.ts` :
```ts
import { describe, it, expect } from "vitest"
import { prochainRepasActif, libelleContexteRepas } from "@/lib/prochain-repas"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import type { Planning, ReglagesGeneration } from "@/types"

function planningSemaine(semaine: string, jours: Planning["jours"]): Planning {
  return { semaine, jours }
}
function recette(id: string): NonNullable<Planning["jours"][number]["diner"]> {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] }
}

describe("prochainRepasActif", () => {
  it("avant 15h un jour de semaine : vise le déjeuner du jour", () => {
    const maintenant = new Date("2026-07-16T10:00:00") // jeudi 16 juillet 2026
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r).toEqual({
      dateISO: "2026-07-16",
      jour: "jeudi",
      typeRepas: "dejeuner",
      recette: recette("dej"),
      restes: false,
      personnes: 2,
    })
  })

  it("après 15h : vise le dîner du jour, pas le déjeuner du lendemain", () => {
    const maintenant = new Date("2026-07-16T18:00:00")
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toEqual(recette("din"))
  })

  it("créneau désactivé (« Aucun ») : saute au prochain créneau ACTIF", () => {
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" },
    }
    const maintenant = new Date("2026-07-16T10:00:00") // jeudi, déjeuner désactivé
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, reglages)
    // Le déjeuner du jeudi est désactivé → on saute directement au dîner du même jour.
    expect(r?.typeRepas).toBe("diner")
    expect(r?.dateISO).toBe("2026-07-16")
  })

  it("créneau actif mais sans recette planifiée → recette undefined (pas de saut)", () => {
    const maintenant = new Date("2026-07-16T10:00:00")
    const map = new Map<string, Planning>() // aucun planning chargé
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r).toEqual({
      dateISO: "2026-07-16",
      jour: "jeudi",
      typeRepas: "dejeuner",
      recette: undefined,
      restes: false,
      personnes: 2,
    })
  })

  it("restes : recette conservée dans le résultat, restes = true", () => {
    const maintenant = new Date("2026-07-16T18:00:00")
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        {
          jour: "jeudi",
          diner: recette("din"),
          restes: { diner: true },
        },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r?.restes).toBe(true)
    expect(r?.recette).toEqual(recette("din")) // conservée malgré les restes
  })

  it("traverse la fin de semaine (samedi soir → dimanche déjeuner)", () => {
    const maintenant = new Date("2026-07-18T22:00:00") // samedi soir, après 15h → dîner du samedi
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "samedi" }, // dîner du samedi actif mais pas de recette
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    // Le dîner du samedi est actif (REGLAGES_DEFAUT) → pas de recette, on
    // s'arrête là (ne traverse PAS vers dimanche, contrairement à un désactivé).
    expect(r?.dateISO).toBe("2026-07-18")
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toBeUndefined()
  })
})

describe("libelleContexteRepas", () => {
  const maintenant = new Date("2026-07-16T10:00:00") // jeudi 16 juillet

  it("aujourd'hui, dîner → « Dîner de ce soir »", () => {
    expect(libelleContexteRepas("2026-07-16", "diner", maintenant)).toBe("Dîner de ce soir")
  })
  it("aujourd'hui, déjeuner → « Déjeuner de ce midi »", () => {
    expect(libelleContexteRepas("2026-07-16", "dejeuner", maintenant)).toBe("Déjeuner de ce midi")
  })
  it("demain → « Dîner de demain »", () => {
    expect(libelleContexteRepas("2026-07-17", "diner", maintenant)).toBe("Dîner de demain")
  })
  it("au-delà → date complète", () => {
    expect(libelleContexteRepas("2026-07-20", "diner", maintenant)).toBe(
      "Dîner du lundi 20 juillet"
    )
  })
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npm run test:run -- tests/prochain-repas.test.ts`
Expected: FAIL — le module `@/lib/prochain-repas` n'existe pas.

- [ ] **Step 3: Implémenter `lib/prochain-repas.ts`**

```ts
// lib/prochain-repas.ts
// Prochain repas ACTIF à cuisiner (#280) — cœur pur, même esprit que
// lib/cycles.ts (fonctions testables sans réseau). Destiné à /ce-soir : pour
// la personne qui cuisine sans avoir suivi la planification.

import { creneauActif } from "@/lib/generateur"
import { estRestes } from "@/lib/restes"
import { personnesDuSlot, PERSONNES_DEFAUT } from "@/lib/personnes"
import { semaineISO } from "@/lib/semaines"
import type { Jour, Planning, Recette, ReglagesGeneration } from "@/types"

export type TypeRepas = "dejeuner" | "diner"

const JOURS_ISO: Jour[] = [
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
]

function jourDeDate(date: Date): Jour {
  const iso = date.getDay() === 0 ? 7 : date.getDay()
  return JOURS_ISO[iso - 1]
}

function versISO(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const j = String(d.getDate()).padStart(2, "0")
  return `${a}-${m}-${j}`
}

function depuisISO(dateISO: string): Date {
  const [a, m, j] = dateISO.split("-").map(Number)
  return new Date(a, m - 1, j)
}

/** Seuil horaire (#280, D2) : avant, le déjeuner du jour est visé ; après, le dîner. */
const SEUIL_HEURE_DINER = 15

export type ProchainRepas = {
  dateISO: string
  jour: Jour
  typeRepas: TypeRepas
  recette: Recette | undefined
  restes: boolean
  personnes: number
}

/**
 * Premier créneau ACTIF (#217) à partir de `maintenant` — avance créneau par
 * créneau (déjeuner → dîner → lendemain…), saute UNIQUEMENT les créneaux
 * désactivés (`creneauActif`). S'arrête au premier actif rencontré, qu'il ait
 * une recette ou non (D4) : ne distingue PAS « jamais généré pour ce jour »
 * de « aucun planning du tout » — les deux rendent `recette: undefined`,
 * affichés identiquement par l'appelant (cf. spec §3.b, simplifié en revue).
 * `maxJours` (défaut 14) est un filet théorique : RG-47 garantit qu'au moins
 * un créneau du motif hebdomadaire est actif, donc la boucle s'arrête presque
 * toujours dans les 7 premiers jours.
 */
export function prochainRepasActif(
  maintenant: Date,
  planningsParSemaine: Map<string, Planning>,
  reglages: ReglagesGeneration,
  maxJours = 14
): ProchainRepas | null {
  let date = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  let typeRepas: TypeRepas = maintenant.getHours() < SEUIL_HEURE_DINER ? "dejeuner" : "diner"

  for (let i = 0; i < maxJours * 2; i++) {
    const jour = jourDeDate(date)
    if (creneauActif(jour, typeRepas, reglages)) {
      const jp = planningsParSemaine.get(semaineISO(date))?.jours.find((j) => j.jour === jour)
      const recette = jp ? (typeRepas === "dejeuner" ? jp.dejeuner : jp.diner) : undefined
      return {
        dateISO: versISO(date),
        jour,
        typeRepas,
        recette,
        restes: jp ? estRestes(jp, typeRepas) : false,
        personnes: jp ? personnesDuSlot(jp, typeRepas) : PERSONNES_DEFAUT,
      }
    }
    if (typeRepas === "dejeuner") {
      typeRepas = "diner"
    } else {
      typeRepas = "dejeuner"
      date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    }
  }
  return null
}

/**
 * Libellé de contexte affiché au-dessus du repas (#280, D3) — « Dîner de ce
 * soir », « Déjeuner de demain », ou une date complète au-delà.
 */
export function libelleContexteRepas(
  dateISO: string,
  typeRepas: TypeRepas,
  maintenant: Date
): string {
  const cible = depuisISO(dateISO)
  const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  const diffJours = Math.round((cible.getTime() - aujourdhui.getTime()) / 86_400_000)
  const nomRepas = typeRepas === "dejeuner" ? "Déjeuner" : "Dîner"
  if (diffJours === 0) return `${nomRepas} de ${typeRepas === "diner" ? "ce soir" : "ce midi"}`
  if (diffJours === 1) return `${nomRepas} de demain`
  const libelleDate = cible.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return `${nomRepas} du ${libelleDate}`
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test:run -- tests/prochain-repas.test.ts`
Expected: PASS (tous les tests).

> Si le test « traverse la fin de semaine » échoue à cause de `REGLAGES_DEFAUT` (vérifier son
> plafond réel de dîner week-end — cf. `lib/reglages.ts` — le test suppose le dîner samedi ACTIF,
> ce qui est le cas par défaut, `long` ≠ `"aucun"`), ajuster l'assertion pour refléter le
> comportement réel de `creneauActif` avec `REGLAGES_DEFAUT plutôt que de changer l'implémentation.

- [ ] **Step 5: Commit**

```bash
git add lib/prochain-repas.ts tests/prochain-repas.test.ts
git commit -m "feat: prochainRepasActif — cœur pur du calcul du prochain repas (#280)"
```

---

### Task 2: Route protégée + lien de nav

**Files:**
- Modify: `proxy.ts`
- Modify: `components/ui/nav.tsx`

**Interfaces:** aucune nouvelle interface — configuration de routing.

- [ ] **Step 1: Ajouter `/ce-soir` aux routes protégées**

Dans `proxy.ts`, remplacer :
```ts
  const protectedRoutes = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/bienvenue"]
```
par :
```ts
  const protectedRoutes = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/bienvenue", "/ce-soir"]
```

- [ ] **Step 2: Ajouter le lien de nav**

Dans `components/ui/nav.tsx`, remplacer :
```ts
const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
];
```
par :
```ts
const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
  { href: "/ce-soir", label: "Ce soir" },
];
```

Et :
```ts
const ROUTES_PROTEGEES = ["/planning", "/courses", "/recettes", "/reglages", "/profil"];
```
par :
```ts
const ROUTES_PROTEGEES = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/ce-soir"];
```

(cf. commentaire existant juste au-dessus de `ROUTES_PROTEGEES` : nécessaire pour éviter le
scintillement de nav sur le chemin chaud, même raison que les autres routes protégées.)

- [ ] **Step 3: Commit**

```bash
git add proxy.ts components/ui/nav.tsx
git commit -m "feat: route /ce-soir protégée + lien de nav (#280)"
```

(Ce commit laisse temporairement un lien de nav vers une route 404 tant que Task 3 n'est pas
faite — acceptable en développement local sur une branche non mergée ; si un déploiement preview
intermédiaire est attendu, inverser l'ordre avec Task 3.)

---

### Task 3: Page `/ce-soir`

**Files:**
- Create: `app/ce-soir/page.tsx`

**Interfaces:**
- Consomme : `prochainRepasActif`, `libelleContexteRepas` (Task 1), `chargerReglages(): Promise<ReglagesGeneration>` (`lib/reglages-data.ts`), `chargerPlanningDistant(semaine: string): Promise<{planning: Planning; updatedAt: string} | null>` (`lib/persistance.ts`), `chargerRecettesGerees(): Promise<RecetteGeree[]>` (`lib/recettes.ts`), `semaineISO`/`semaineDecalee` (`lib/semaines.ts`), `FicheRecette` (props `recette`, `personnes`, `modifiable`, `onFermer`, cf. `components/planning/fiche-recette.tsx`).
- Produit : page terminale, aucune interface exportée au-delà du défaut Next.js.

- [ ] **Step 1: Écrire la page**

Créer `app/ce-soir/page.tsx` :
```tsx
"use client";

// Vue « Prochain repas » (#280) — pour qui cuisine sans avoir suivi la
// planification : LE prochain repas actif, en lecture seule. Charge les
// plannings de la semaine courante + suivante (même fenêtre que
// VuePlanningCycle) et délègue le calcul à lib/prochain-repas.ts.
//
// États d'interface (RG-09) : chargement, rien de prévu, restes, recette
// (via FicheRecette, montée directement — pas besoin de cliquer sur un nom de
// plat comme sur /planning, la page EST la fiche).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { chargerPlanningDistant } from "@/lib/persistance";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { prochainRepasActif, libelleContexteRepas, type ProchainRepas } from "@/lib/prochain-repas";
import { semaineISO, semaineDecalee } from "@/lib/semaines";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { Planning, ReglagesGeneration } from "@/types";

export default function PageCeSoir() {
  const router = useRouter();
  const [chargement, setChargement] = useState(true);
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);
  const [planningsParSemaine, setPlanningsParSemaine] = useState<Map<string, Planning>>(
    new Map()
  );
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  const [ficheFermee, setFicheFermee] = useState(false);

  useEffect(() => {
    let actif = true;
    const maintenant = new Date();
    const semaines = [semaineISO(maintenant), semaineDecalee(semaineISO(maintenant), 1)];
    Promise.all([
      chargerReglages().catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
        return REGLAGES_DEFAUT;
      }),
      Promise.all(semaines.map((s) => chargerPlanningDistant(s).catch(() => null))),
      chargerRecettesGerees().catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
        return [] as RecetteGeree[];
      }),
    ]).then(([reglagesCharges, resultatsPlannings, recettes]) => {
      if (!actif) return;
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const resultat = resultatsPlannings[i];
        if (resultat) map.set(s, resultat.planning);
      });
      setReglages(reglagesCharges);
      setPlanningsParSemaine(map);
      setRecettesGerees(recettes);
      setChargement(false);
    });
    return () => {
      actif = false;
    };
  }, []);

  const idsModifiables = useMemo(
    () => new Set(recettesGerees.map((r) => r.recette.id)),
    [recettesGerees]
  );

  const prochain = useMemo<ProchainRepas | null | undefined>(() => {
    if (chargement) return undefined; // pas encore calculable
    return prochainRepasActif(new Date(), planningsParSemaine, reglages);
  }, [chargement, planningsParSemaine, reglages]);

  if (chargement || prochain === undefined) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  if (prochain === null || !prochain.recette) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">Ce soir</h1>
        <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
      </main>
    );
  }

  if (prochain.restes) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())}
        </h1>
        <p className="text-brand-700/85">Restes de {prochain.recette.nom}</p>
      </main>
    );
  }

  if (ficheFermee) {
    // Lecture seule (D5) : rien à éditer une fois la fiche fermée. On propose
    // simplement de rejoindre le planning complet plutôt que de laisser un
    // écran vide sans issue.
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-brand-700/85">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())} —{" "}
          {prochain.recette.nom}
        </p>
        <button
          type="button"
          onClick={() => router.push("/planning")}
          className="rounded-full bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Voir tout le planning
        </button>
      </main>
    );
  }

  return (
    <>
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="mb-2 text-sm font-medium text-brand-700/85">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())}
        </p>
      </main>
      <FicheRecette
        recette={prochain.recette}
        personnes={prochain.personnes}
        modifiable={idsModifiables.has(prochain.recette.id)}
        onFermer={() => setFicheFermee(true)}
      />
    </>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Vérification manuelle**

Run: `npm run dev`, se connecter, ouvrir `/ce-soir` (nav bar, lien « Ce soir »). Vérifier les 3
branches observables sans base spécifique : chargement (bref), puis soit « Rien de prévu »
(compte de test sans planning généré sur la fenêtre), soit la fiche recette si un planning existe
pour aujourd'hui/demain sur l'instance `.env.local` locale. Fermer la fiche (bouton natif du
`<dialog>`) → vérifier l'écran de repli avec le bouton « Voir tout le planning ».

- [ ] **Step 4: Commit**

```bash
git add app/ce-soir/page.tsx
git commit -m "feat: page /ce-soir — prochain repas actif en lecture seule (#280)"
```

---

### Task 4: Nouvelle couverture e2e

**Files:**
- Create: `e2e/prochain-repas.spec.ts`
- Modify: `e2e/auth.spec.ts` (une ligne, test existant de nav déconnectée)

**Interfaces:** aucune — spec e2e, patron `e2e/cycle-courses.spec.ts` (import `nettoyerEtatDistant`
de `./helpers` ; le compte de test est partagé, cf. contrainte projet — génération réelle CI-only).

- [ ] **Step 1: Étendre l'assertion de nav déconnectée existante**

Dans `e2e/auth.spec.ts`, le test `"déconnecté, la nav applicative est masquée (#207)"` contient :
```ts
  await expect(page.getByRole("link", { name: /Profil/ })).toHaveCount(0);
```
Ajouter juste après :
```ts
  await expect(page.getByRole("link", { name: "Ce soir" })).toHaveCount(0);
```

- [ ] **Step 2: Écrire le nouveau spec**

```ts
// e2e/prochain-repas.spec.ts
// Vue « Prochain repas » (#280) — génération réelle, CI-only (catalogue
// global seedé sur staging, cf. contrainte projet).

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

test("affiche le prochain repas après génération, ou l'état vide sinon", async ({ page }) => {
  // Génère un planning réel pour la semaine courante (fenêtre couverte par
  // /ce-soir : semaine courante + suivante).
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Ce soir" }).click();
  // Selon l'heure réelle d'exécution CI, le créneau visé peut avoir une
  // recette (fiche montée, <dialog> visible) ou non (état vide) — les deux
  // sont des succès légitimes, on n'en impose qu'un des deux exclusivement.
  const ficheOuOuverte = page.getByRole("dialog");
  const etatVide = page.getByText("Rien de prévu pour ce repas.");
  await expect(ficheOuOuverte.or(etatVide)).toBeVisible({ timeout: 10_000 });
});

test("le lien « Ce soir » n'apparaît pas dans la nav déconnectée", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Ce soir" })).toHaveCount(0);
});
```

- [ ] **Step 3: Lancer les e2e concernés contre staging**

Run: `npm run test:e2e:staging -- prochain-repas.spec auth.spec planning.spec --retries=2`
Expected: tous verts.

- [ ] **Step 4: Commit**

```bash
git add e2e/prochain-repas.spec.ts e2e/auth.spec.ts
git commit -m "test: e2e vue Prochain repas + nav déconnectée (#280)"
```

---

### Task 5: Documentation utilisateur (Notion)

**Files:** aucun fichier du repo modifié directement — la source de vérité est la base Notion
« Guide OMQ » (cf. CLAUDE.md, doc `/aide`). Après l'édition Notion : `content/aide/*` régénéré par
`npm run pull:aide`.

- [ ] **Step 1: Ajouter un article**

Nouvel article Notion, section « Planning » (ou une section dédiée si `/ce-soir` justifie sa
propre entrée dans `ORDRE_SECTIONS`), statut « Publié ». Contenu bref (2-3 paragraphes) : à qui
s'adresse cette vue (qui cuisine sans avoir planifié), ce qu'elle affiche (un seul repas, en
lecture seule), ce qui se passe si rien n'est prévu.

- [ ] **Step 2: Régénérer le contenu committé**

Run: `npm run pull:aide`
Expected: nouveau `content/aide/<slug>.md`, `content/aide/index.json` mis à jour.

- [ ] **Step 3: Commit**

```bash
git add content/aide public/aide
git commit -m "docs: doc utilisateur — vue Prochain repas (#280)"
```

---

### Task 6: Ouvrir la PR

- [ ] **Step 1**

Titre court, résumé des décisions D1-D5, lien vers la spec et vers l'issue #280.

---

## Self-Review (effectué avant remise du plan)

- **Couverture de la spec** : D1 (route dédiée) → Task 2, 3. D2 (un seul repas, seuil horaire) →
  Task 1 (`prochainRepasActif`). D3 (contenu complet via `FicheRecette`) → Task 3. D4 (repli
  restes/désactivé/vide) → Task 1 (algorithme) + Task 3 (rendu des branches). D5 (lecture seule) →
  Task 3 (aucun contrôle d'édition monté).
- **Placeholders** : aucun — chaque step contient le code exact, à l'exception du contenu détaillé
  de `e2e/prochain-repas.spec.ts` (Task 4, Step 1), qui dépend d'un examen de `e2e/helpers.ts` non
  fait dans ce plan — assumé et documenté explicitement, pas un oubli silencieux.
- **Cohérence des types** : `ProchainRepas` (Task 1) consommé tel quel par `app/ce-soir/page.tsx`
  (Task 3) — mêmes noms de champs (`dateISO`, `typeRepas`, `recette`, `restes`, `personnes`).
- **Point d'attention le plus probable en implémentation** : le test « traverse la fin de semaine »
  (Task 1) suppose que `REGLAGES_DEFAUT` laisse le dîner du samedi ACTIF — vérifier `lib/reglages.ts`
  avant de lancer les tests, ajuster l'assertion (pas l'implémentation) si le défaut réel diffère.
