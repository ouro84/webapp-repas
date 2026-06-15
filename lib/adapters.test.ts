// Tests des adaptateurs DB → domaine — focalisés sur la reconstruction du
// planning persisté (#6) : personnes (US-07) et restes (US-12) par slot.

import { describe, expect, it } from "vitest";
import {
  dbPlanningToDomain,
  dbRecetteToDomain,
  dbSlotToJourPlanning,
} from "@/lib/adapters";
import { SELECT_PLANNING } from "@/lib/persistance";
import type { DbPlanningSlot, DbRecette } from "@/types";

function dbRecette(id: string): DbRecette {
  return {
    id,
    user_id: "u1",
    foyer_id: null,
    nom: id,
    temps_preparation: "rapide",
    vegetarien: false,
    accompagnement: null,
    saisons: null,
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

describe("dbRecetteToDomain — accompagnement (#49)", () => {
  it("mappe null en champ absent (non caractérisé)", () => {
    const r = dbRecetteToDomain(dbRecette("r"));
    expect(r.accompagnement).toBeUndefined();
    expect("accompagnement" in r).toBe(false);
  });

  it("conserve une valeur d'accompagnement", () => {
    const r = dbRecetteToDomain({ ...dbRecette("r"), accompagnement: "legumes" });
    expect(r.accompagnement).toBe("legumes");
  });
});

describe("dbRecetteToDomain — saisons (#23)", () => {
  it("mappe null/[] en champ absent (toute l'année)", () => {
    expect(dbRecetteToDomain(dbRecette("r")).saisons).toBeUndefined();
    expect(
      dbRecetteToDomain({ ...dbRecette("r"), saisons: [] }).saisons
    ).toBeUndefined();
  });

  it("conserve une liste de saisons non vide", () => {
    const r = dbRecetteToDomain({
      ...dbRecette("r"),
      saisons: ["automne", "hiver"],
    });
    expect(r.saisons).toEqual(["automne", "hiver"]);
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

  // Régression #164 : un planning hydraté depuis la base doit CONSERVER les
  // flags végé/accompagnement/saisons sur ses recettes (badges + biais
  // végé/légumes/saison). L'adaptateur les porte déjà ; le risque réel était
  // que le SELECT distant ne les remonte pas.
  it("conserve vegetarien/accompagnement/saisons sur les recettes du planning (#164)", () => {
    const recetteTaguee: DbRecette = {
      ...dbRecette("r-din"),
      vegetarien: true,
      accompagnement: "legumes",
      saisons: ["ete"],
    };
    const slot: DbPlanningSlot = {
      ...dbSlot("lundi", "diner", "r-din"),
      recette: recetteTaguee,
    };
    const planning = dbPlanningToDomain("2026-W23", [slot]);
    const diner = planning.jours[0]!.diner;
    expect(diner.vegetarien).toBe(true);
    expect(diner.accompagnement).toBe("legumes");
    expect(diner.saisons).toEqual(["ete"]);
  });
});

// Garde directe sur la requête d'hydratation : sans ces colonnes, l'adaptateur
// ci-dessus recevrait des recettes sans flags → bug #164 (invisible en
// génération directe, frappe le 2ᵉ appareil / la navigation entre semaines).
describe("SELECT_PLANNING — colonnes recette (régression #164)", () => {
  it("sélectionne vegetarien, accompagnement et saisons", () => {
    expect(SELECT_PLANNING).toContain("vegetarien");
    expect(SELECT_PLANNING).toContain("accompagnement");
    expect(SELECT_PLANNING).toContain("saisons");
  });
});
