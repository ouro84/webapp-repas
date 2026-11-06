// Tests unitaires de l'édition de slot partagée (chantier 06) — US-04/06/07/12,
// RG-04, RG-15, RG-16, RG-22, RG-26/27/28.
//
// Plannings construits à la main (14 repas « rapides » distincts) plutôt que
// générés : le résultat de `remplacerSlot` est alors déterministe sans dépendre
// de l'aléa de la génération. Un PRNG seedé est tout de même injecté dans
// chaque action « changer » (cf. #157, `generation-recettes.md`).

import { describe, test, expect } from "vitest";
import {
  editerSlot,
  MESSAGES_EDITION,
  type ActionSlot,
} from "@/lib/edition-slot";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { ORDRE_JOURS } from "@/lib/generateur";
import { estRestes } from "@/lib/restes";
import { personnesDuSlot } from "@/lib/personnes";
import type {
  Jour,
  JourPlanning,
  Planning,
  Recette,
  ReglagesGeneration,
} from "@/types";

// PRNG déterministe (mulberry32), comme `rngSeed` de lib/generateur.test.ts.
function rngSeed(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function recette(id: string, extra: Partial<Recette> = {}): Recette {
  return {
    id,
    nom: id,
    tempsPreparation: "rapide",
    ingredients: [],
    ...extra,
  };
}

// Semaine d'été (2026-W28) : sert à la règle saison (RG-28).
const SEMAINE = "2026-W28";

// 7 jours × (déjeuner + dîner), 14 recettes rapides distinctes `base-N`.
function planningBase(semaine = SEMAINE): Planning {
  let n = 0;
  const jours: JourPlanning[] = ORDRE_JOURS.map((jour) => ({
    jour,
    dejeuner: recette(`base-${n++}`),
    diner: recette(`base-${n++}`),
  }));
  return { semaine, jours };
}

function jourDe(planning: Planning, jour: Jour): JourPlanning {
  return planning.jours.find((jp) => jp.jour === jour)!;
}

function changer(
  recettes: Recette[],
  reglages: ReglagesGeneration = REGLAGES_DEFAUT
): ActionSlot {
  return {
    type: "changer",
    recettes,
    reglages,
    preferences: new Map(),
    random: rngSeed(6),
  };
}

const VEGE_DINER_SEMAINE: ReglagesGeneration = {
  ...REGLAGES_DEFAUT,
  vegetarienPrefere: {
    dejeunerSemaine: false,
    dinerSemaine: true,
    dejeunerWeekend: false,
    dinerWeekend: false,
  },
};

describe("editerSlot — changer (US-04, RG-04)", () => {
  test("remplace le slot : precedent = ancien jour, jour = nouveau jour", () => {
    const planning = planningBase();
    const candidate = recette("cand-1");
    const res = editerSlot(planning, "lundi", "diner", changer([candidate]));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.precedent).toBe(jourDe(planning, "lundi"));
    expect(res.jour).toBe(jourDe(res.planning, "lundi"));
    expect(res.jour.diner?.id).toBe("cand-1");
    expect(res.jour.dejeuner?.id).toBe(jourDe(planning, "lundi").dejeuner?.id);
    expect(res.avertissements).toEqual([]);
  });

  test("ne mute pas le planning d'entrée", () => {
    const planning = planningBase();
    const avant = JSON.stringify(planning);
    editerSlot(planning, "lundi", "diner", changer([recette("cand-1")]));
    expect(JSON.stringify(planning)).toBe(avant);
  });

  test("sans recette éligible : indisponible", () => {
    const planning = planningBase();
    // Le vivier ne contient que des recettes déjà au planning (RG-02).
    const vivier = planning.jours.flatMap((jp) => [jp.dejeuner!, jp.diner!]);
    expect(editerSlot(planning, "lundi", "diner", changer(vivier))).toEqual({
      ok: false,
      motif: "indisponible",
    });
  });

  test("créneau absent d'un jour présent : indisponible", () => {
    const planning = planningBase();
    planning.jours = planning.jours.map((jp) =>
      jp.jour === "lundi" ? { jour: jp.jour, diner: jp.diner } : jp
    );
    expect(
      editerSlot(planning, "lundi", "dejeuner", changer([recette("cand-1")]))
    ).toEqual({ ok: false, motif: "indisponible" });
  });

  test("préférence végé non honorée : avertissement vege", () => {
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { vegetarien: false })], VEGE_DINER_SEMAINE)
    );
    expect(res.ok && res.avertissements).toEqual(["vege"]);
  });

  test("préférence végé honorée : aucun avertissement", () => {
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { vegetarien: true })], VEGE_DINER_SEMAINE)
    );
    expect(res.ok && res.avertissements).toEqual([]);
  });

  test("mix légume actif sans légume ce jour : avertissement legume", () => {
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      mixAccompagnementJour: true,
    };
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { accompagnement: "feculents" })], reglages)
    );
    expect(res.ok && res.avertissements).toEqual(["legume"]);
  });

  test("mix légume actif et remplaçant légumes : aucun avertissement", () => {
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      mixAccompagnementJour: true,
    };
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { accompagnement: "legumes" })], reglages)
    );
    expect(res.ok && res.avertissements).toEqual([]);
  });

  test("remplaçant hors saison : avertissement saison", () => {
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { saisons: ["hiver"] })])
    );
    expect(res.ok && res.avertissements).toEqual(["saison"]);
  });

  test("remplaçant de saison : aucun avertissement", () => {
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer([recette("cand-1", { saisons: ["ete"] })])
    );
    expect(res.ok && res.avertissements).toEqual([]);
  });

  test("les trois avertissements sortent dans l'ordre vege, legume, saison", () => {
    const reglages: ReglagesGeneration = {
      ...VEGE_DINER_SEMAINE,
      mixAccompagnementJour: true,
    };
    const res = editerSlot(
      planningBase(),
      "lundi",
      "diner",
      changer(
        [
          recette("cand-1", {
            vegetarien: false,
            accompagnement: "feculents",
            saisons: ["hiver"],
          }),
        ],
        reglages
      )
    );
    expect(res.ok && res.avertissements).toEqual(["vege", "legume", "saison"]);
  });
});

describe("editerSlot — selectionner (US-06, RG-15)", () => {
  test("la recette choisie occupe le slot, sans avertissement", () => {
    const planning = planningBase();
    // Recette « long » : by-pass RG-01, et non végé malgré la préférence.
    const choisie = recette("choisie", {
      tempsPreparation: "long",
      vegetarien: false,
      saisons: ["hiver"],
    });
    const res = editerSlot(planning, "mardi", "diner", {
      type: "selectionner",
      recette: choisie,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jour.diner).toBe(choisie);
    expect(res.precedent).toBe(jourDe(planning, "mardi"));
    expect(res.avertissements).toEqual([]);
  });

  test("efface le marquage restes du slot (RG-22)", () => {
    const planning = planningBase();
    planning.jours = planning.jours.map((jp) =>
      jp.jour === "mardi" ? { ...jp, restes: { diner: true } } : jp
    );
    const res = editerSlot(planning, "mardi", "diner", {
      type: "selectionner",
      recette: recette("choisie"),
    });
    expect(res.ok && estRestes(res.jour, "diner")).toBe(false);
  });
});

describe("editerSlot — personnes et restes (US-07, US-12)", () => {
  test("personnes : le nombre du slot est mis à jour (RG-16)", () => {
    const planning = planningBase();
    const res = editerSlot(planning, "jeudi", "dejeuner", {
      type: "personnes",
      personnes: 4,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(personnesDuSlot(res.jour, "dejeuner")).toBe(4);
    expect(personnesDuSlot(res.jour, "diner")).toBe(2);
    expect(res.precedent).toBe(jourDe(planning, "jeudi"));
    expect(res.avertissements).toEqual([]);
  });

  test("personnes : valeur bornée à [1 ; 12] (RG-16)", () => {
    const res = editerSlot(planningBase(), "jeudi", "diner", {
      type: "personnes",
      personnes: 99,
    });
    expect(res.ok && personnesDuSlot(res.jour, "diner")).toBe(12);
  });

  test("restes : le slot est marqué, la recette conservée (RG-22)", () => {
    const planning = planningBase();
    const res = editerSlot(planning, "vendredi", "diner", {
      type: "restes",
      valeur: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(estRestes(res.jour, "diner")).toBe(true);
    expect(res.jour.diner).toBe(jourDe(planning, "vendredi").diner);
    expect(res.avertissements).toEqual([]);
  });

  test("restes : démarquer remet le repas à cuisiner", () => {
    const planning = planningBase();
    planning.jours = planning.jours.map((jp) =>
      jp.jour === "vendredi" ? { ...jp, restes: { diner: true } } : jp
    );
    const res = editerSlot(planning, "vendredi", "diner", {
      type: "restes",
      valeur: false,
    });
    expect(res.ok && estRestes(res.jour, "diner")).toBe(false);
  });
});

describe("editerSlot — slot absent", () => {
  const ACTIONS: ActionSlot[] = [
    changer([recette("cand-1")]),
    { type: "selectionner", recette: recette("choisie") },
    { type: "personnes", personnes: 3 },
    { type: "restes", valeur: true },
  ];

  test.each(ACTIONS.map((a) => [a.type, a] as const))(
    "jour absent du planning (%s) : slot-absent",
    (_nom, action) => {
      const planning = planningBase();
      planning.jours = planning.jours.filter((jp) => jp.jour !== "dimanche");
      expect(editerSlot(planning, "dimanche", "diner", action)).toEqual({
        ok: false,
        motif: "slot-absent",
      });
    }
  );

  test.each(ACTIONS.slice(1).map((a) => [a.type, a] as const))(
    "repas absent d'un jour présent (%s) : slot-absent",
    (_nom, action) => {
      const planning = planningBase();
      planning.jours = planning.jours.map((jp) =>
        jp.jour === "lundi" ? { jour: jp.jour, diner: jp.diner } : jp
      );
      expect(editerSlot(planning, "lundi", "dejeuner", action)).toEqual({
        ok: false,
        motif: "slot-absent",
      });
    }
  );
});

describe("MESSAGES_EDITION", () => {
  test("textes des toasts actuels, à l'identique", () => {
    expect(MESSAGES_EDITION.remplacee).toBe("Recette remplacée");
    expect(MESSAGES_EDITION.indisponible).toBe("Pas de recette disponible");
    expect(MESSAGES_EDITION.restes(true)).toBe("Repas marqué « Restes »");
    expect(MESSAGES_EDITION.restes(false)).toBe("Repas à cuisiner");
  });

  test("avertissements : les trois textes actuels exacts", () => {
    expect(MESSAGES_EDITION.avertissements).toEqual({
      vege: "Pas de recette végétarienne disponible pour ce repas.",
      legume:
        "Ce jour n’a pas de repas « légumes » (pas assez de recettes légumes).",
      saison: "Ce repas est hors saison (pas assez de recettes de saison).",
    });
  });
});
