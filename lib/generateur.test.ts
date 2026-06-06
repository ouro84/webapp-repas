// Tests unitaires du générateur de planning — RG-01 à RG-04
// (SPECS_FONCTIONNELLES.md section 6) + structure du planning (section 5.5).
//
// Données : les fixtures de tests/fixtures/recettes.ts (15 recettes —
// 12 rapides/normales, 3 longues), parfois filtrées en sous-ensembles
// pour rendre certains comportements déterministes malgré l'aléatoire (RG-03).
// Découplé de data/recettes.json (issue #29) : le vrai dataset peut évoluer
// librement sans casser ces tests.

import { describe, test, expect } from "vitest";
import { genererPlanning, remplacerSlot } from "@/lib/generateur";
import { RECETTES_FIXTURES } from "@/tests/fixtures/recettes";
import type { Jour, Planning, Recette } from "@/types";

const RECETTES = RECETTES_FIXTURES;
const RAPIDES_NORMALES = RECETTES.filter((r) => r.tempsPreparation !== "long");
const LONGUES = RECETTES.filter((r) => r.tempsPreparation === "long");

const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
const ORDRE_JOURS: Jour[] = [...JOURS_SEMAINE, "samedi", "dimanche"];

// Tous les repas d'un planning, tous slots confondus.
function tousLesRepas(planning: Planning): Recette[] {
  return planning.jours.flatMap((jp) =>
    jp.dejeuner ? [jp.dejeuner, jp.diner] : [jp.diner]
  );
}

// Dîners du lundi au vendredi uniquement.
function dinersDeSemaine(planning: Planning): Recette[] {
  return planning.jours
    .filter((jp) => JOURS_SEMAINE.includes(jp.jour))
    .map((jp) => jp.diner);
}

// ---------------------------------------------------------------------------
// Section 5.5 — composition du planning : 7 jours lundi → dimanche,
// un dîner chaque jour, un déjeuner uniquement le samedi et le dimanche.
// ---------------------------------------------------------------------------
describe("genererPlanning — structure du planning (section 5.5)", () => {
  test("produit 7 jours dans l'ordre lundi → dimanche", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.jours.map((jp) => jp.jour)).toEqual(ORDRE_JOURS);
  });

  test("sert un dîner chaque jour et un déjeuner uniquement le week-end", () => {
    const planning = genererPlanning(RECETTES);
    for (const jp of planning.jours) {
      expect(jp.diner).toBeDefined();
      if (jp.jour === "samedi" || jp.jour === "dimanche") {
        expect(jp.dejeuner).toBeDefined();
      } else {
        expect(jp.dejeuner).toBeUndefined();
      }
    }
  });

  test("identifie la semaine au format ISO AAAA-Wnn", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.semaine).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// RG-01 — Éligibilité par jour : lundi → vendredi, seules les recettes
// "rapide" ou "normal" sont éligibles ; le week-end, toutes le sont.
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-01 éligibilité par jour", () => {
  test("ne sert jamais de recette longue un soir de semaine", () => {
    // L'aléatoire (RG-03) impose de répéter : 25 générations sur le vivier complet.
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      for (const diner of dinersDeSemaine(planning)) {
        expect(diner.tempsPreparation).not.toBe("long");
      }
    }
  });

  test("sert les recettes longues le week-end quand le vivier l'impose", () => {
    // Vivier de 9 recettes pour 9 slots : 6 rapides/normales + les 3 longues.
    // Les 5 dîners de semaine consomment 5 rapides/normales : les 3 longues
    // ne peuvent finir que sur les 4 slots du week-end — et le planning
    // doit quand même aboutir.
    const vivier = [...RAPIDES_NORMALES.slice(0, 6), ...LONGUES];
    const planning = genererPlanning(vivier);

    const idsWeekend = planning.jours
      .filter((jp) => jp.jour === "samedi" || jp.jour === "dimanche")
      .flatMap((jp) => [jp.dejeuner!.id, jp.diner.id]);
    for (const longue of LONGUES) {
      expect(idsWeekend).toContain(longue.id);
    }
  });
});

// ---------------------------------------------------------------------------
// RG-02 — Pas de répétition : une recette n'apparaît qu'une seule fois
// dans la semaine, quel que soit le slot (déjeuner ou dîner).
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-02 pas de répétition dans la semaine", () => {
  test("n'utilise jamais deux fois la même recette dans un planning", () => {
    for (let i = 0; i < 25; i++) {
      const repas = tousLesRepas(genererPlanning(RECETTES));
      const ids = repas.map((r) => r.id);
      expect(new Set(ids).size).toBe(repas.length); // 9 repas, 9 ids distincts
    }
  });
});

// ---------------------------------------------------------------------------
// RG-03 — Sélection aléatoire : parmi les recettes éligibles, le choix
// est aléatoire à chaque génération.
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-03 sélection aléatoire", () => {
  test("produit des plannings différents d'une génération à l'autre", () => {
    // 30 générations sur 15 recettes : la probabilité d'obtenir 30 fois
    // exactement la même semaine est nulle en pratique.
    const signatures = new Set<string>();
    for (let i = 0; i < 30; i++) {
      signatures.add(tousLesRepas(genererPlanning(RECETTES)).map((r) => r.id).join("|"));
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Garde-fou du générateur : si le vivier ne permet pas de remplir les
// 9 slots en respectant RG-01 et RG-02, la génération échoue explicitement
// (l'UI affiche alors l'état erreur, RG-09).
// ---------------------------------------------------------------------------
describe("genererPlanning — vivier insuffisant", () => {
  test("échoue explicitement avec moins de recettes que de slots", () => {
    expect(() => genererPlanning(RAPIDES_NORMALES.slice(0, 4))).toThrow();
  });

  test("échoue quand les dîners de semaine manquent de recettes rapides ou normales", () => {
    // 4 rapides/normales pour 5 dîners de semaine : impossible, même si
    // les recettes longues abondent pour le week-end.
    const vivier = [...RAPIDES_NORMALES.slice(0, 4), ...LONGUES];
    expect(() => genererPlanning(vivier)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RG-04 — Remplacement individuel : la nouvelle recette respecte RG-01
// et RG-02 ; s'il n'existe aucune recette éligible disponible, l'appel
// retourne null (l'UI affiche « Pas de recette disponible »).
// ---------------------------------------------------------------------------
describe("remplacerSlot — RG-04 remplacement individuel", () => {
  test("remplace le slot ciblé par une recette différente sans toucher aux autres", () => {
    const planning = genererPlanning(RECETTES);
    const resultat = remplacerSlot(planning, "mardi", "diner", RECETTES);

    expect(resultat).not.toBeNull();
    const avantMardi = planning.jours.find((jp) => jp.jour === "mardi")!.diner;
    const apresMardi = resultat!.jours.find((jp) => jp.jour === "mardi")!.diner;
    expect(apresMardi.id).not.toBe(avantMardi.id);

    // Tous les autres slots sont strictement inchangés.
    for (const jp of resultat!.jours) {
      if (jp.jour === "mardi") continue;
      const original = planning.jours.find((o) => o.jour === jp.jour)!;
      expect(jp.diner.id).toBe(original.diner.id);
      expect(jp.dejeuner?.id).toBe(original.dejeuner?.id);
    }
  });

  test("respecte l'éligibilité du jour : jamais de recette longue un soir de semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      const resultat = remplacerSlot(planning, "lundi", "diner", RECETTES);
      expect(resultat).not.toBeNull();
      const nouveau = resultat!.jours.find((jp) => jp.jour === "lundi")!.diner;
      expect(nouveau.tempsPreparation).not.toBe("long");
    }
  });

  test("ne choisit jamais une recette déjà servie ailleurs dans la semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      const resultat = remplacerSlot(planning, "samedi", "dejeuner", RECETTES);
      expect(resultat).not.toBeNull();

      const nouveau = resultat!.jours.find((jp) => jp.jour === "samedi")!.dejeuner!;
      const idsAutresSlots = tousLesRepas(planning)
        .map((r) => r.id)
        .filter((id) => id !== planning.jours.find((jp) => jp.jour === "samedi")!.dejeuner!.id);
      expect(idsAutresSlots).not.toContain(nouveau.id);
    }
  });

  test("retourne null quand toutes les recettes éligibles sont déjà utilisées", () => {
    // Vivier de 9 recettes = exactement les 9 slots : aucun remplaçant possible.
    const vivier = [...RAPIDES_NORMALES.slice(0, 6), ...LONGUES];
    const planning = genererPlanning(vivier);
    expect(remplacerSlot(planning, "dimanche", "dejeuner", vivier)).toBeNull();
  });

  test("retourne null pour un slot qui n'existe pas (déjeuner en semaine)", () => {
    const planning = genererPlanning(RECETTES);
    expect(remplacerSlot(planning, "lundi", "dejeuner", RECETTES)).toBeNull();
  });

  test("ne modifie jamais le planning d'origine", () => {
    const planning = genererPlanning(RECETTES);
    const instantane = JSON.stringify(planning);
    remplacerSlot(planning, "jeudi", "diner", RECETTES);
    expect(JSON.stringify(planning)).toBe(instantane);
  });

  test("conserve l'identifiant de semaine du planning d'origine", () => {
    const planning = genererPlanning(RECETTES);
    const resultat = remplacerSlot(planning, "vendredi", "diner", RECETTES);
    expect(resultat!.semaine).toBe(planning.semaine);
  });
});
