// Tests des adaptateurs DB → domaine — focalisés sur la reconstruction du
// planning persisté (#6) : personnes (US-07) et restes (US-12) par slot.

import { describe, expect, it } from "vitest";
import { dbPlanningToDomain, dbSlotToJourPlanning } from "@/lib/adapters";
import type { DbPlanningSlot, DbRecette } from "@/types";

function dbRecette(id: string): DbRecette {
  return {
    id,
    user_id: "u1",
    nom: id,
    temps_preparation: "rapide",
    vegetarien: false,
    created_at: "2026-06-01T00:00:00Z",
    recette_ingredient: [
      {
        id: `${id}-ri`,
        recette_id: id,
        ingredient_id: `${id}-ing`,
        quantite: 2,
        unite: "piece",
        ingredient: {
          id: `${id}-ing`,
          nom: "oeufs",
          categorie: "produits-frais",
          fond_de_placard: false,
          created_at: "2026-06-01T00:00:00Z",
        },
      },
    ],
  };
}

function dbSlot(
  jour: DbPlanningSlot["jour"],
  type: "dejeuner" | "diner",
  recetteId: string,
  personnes = 2,
  restes = false
): DbPlanningSlot {
  return {
    id: `${jour}-${type}`,
    planning_id: "p1",
    recette_id: recetteId,
    jour,
    type_repas: type,
    personnes,
    restes,
    recette: dbRecette(recetteId),
  };
}

describe("dbSlotToJourPlanning", () => {
  it("reconstruit déjeuner + dîner avec leurs recettes", () => {
    const slots = [
      dbSlot("lundi", "dejeuner", "r-dej"),
      dbSlot("lundi", "diner", "r-din"),
    ];
    const jp = dbSlotToJourPlanning(slots, "lundi");
    expect(jp.dejeuner?.id).toBe("r-dej");
    expect(jp.diner.id).toBe("r-din");
    expect(jp.diner.ingredients).toHaveLength(1);
  });

  it("n'attache personnes/restes que pour les valeurs non-défaut", () => {
    const parDefaut = dbSlotToJourPlanning(
      [dbSlot("mardi", "diner", "r")],
      "mardi"
    );
    expect(parDefaut.personnes).toBeUndefined();
    expect(parDefaut.restes).toBeUndefined();

    const regle = dbSlotToJourPlanning(
      [
        dbSlot("mardi", "dejeuner", "r-dej", 4, false),
        dbSlot("mardi", "diner", "r-din", 2, true),
      ],
      "mardi"
    );
    expect(regle.personnes).toEqual({ dejeuner: 4 }); // dîner à 2 = défaut, omis
    expect(regle.restes).toEqual({ diner: true });
  });

  it("lève si le dîner manque (slot obligatoire, section 5.5)", () => {
    expect(() =>
      dbSlotToJourPlanning([dbSlot("lundi", "dejeuner", "r")], "lundi")
    ).toThrow();
  });
});

describe("dbPlanningToDomain", () => {
  it("reconstruit un planning dans l'ordre canonique, jours avec dîner", () => {
    const slots = [
      dbSlot("lundi", "diner", "l"),
      dbSlot("mardi", "dejeuner", "ma-dej"),
      dbSlot("mardi", "diner", "ma-din"),
    ];
    const planning = dbPlanningToDomain("2026-W23", slots);
    expect(planning.semaine).toBe("2026-W23");
    expect(planning.jours.map((j) => j.jour)).toEqual(["lundi", "mardi"]);
    expect(planning.jours[1]!.dejeuner?.id).toBe("ma-dej");
  });
});
