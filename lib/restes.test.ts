// Tests des repas en « restes » — US-12, RG-22 (lib/restes.ts).

import { describe, expect, it } from "vitest";
import { estRestes, marquerRestes } from "@/lib/restes";
import type { JourPlanning, Planning, Recette } from "@/types";

function rec(id: string): Recette {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] };
}

function planning(): Planning {
  const jours: JourPlanning[] = [
    { jour: "lundi", dejeuner: rec("ld"), diner: rec("ln") },
    { jour: "mardi", diner: rec("md") }, // pas de déjeuner (planning antérieur)
  ];
  return { semaine: "2026-W23", jours };
}

describe("estRestes", () => {
  it("est faux par défaut, vrai quand le flag est posé", () => {
    const jp: JourPlanning = { jour: "lundi", diner: rec("d") };
    expect(estRestes(jp, "diner")).toBe(false);
    expect(estRestes({ ...jp, restes: { diner: true } }, "diner")).toBe(true);
    expect(estRestes({ ...jp, restes: { diner: false } }, "diner")).toBe(false);
  });
});

describe("marquerRestes (RG-22)", () => {
  it("marque un slot en restes puis le ramène à cuisiné", () => {
    const p = planning();
    const marque = marquerRestes(p, "lundi", "diner", true)!;
    expect(estRestes(marque.jours[0]!, "diner")).toBe(true);
    // La recette sous-jacente est conservée.
    expect(marque.jours[0]!.diner!.id).toBe("ln");

    const cuisine = marquerRestes(marque, "lundi", "diner", false)!;
    expect(estRestes(cuisine.jours[0]!, "diner")).toBe(false);
    expect(cuisine.jours[0]!.diner!.id).toBe("ln");
  });

  it("ne touche pas l'autre repas du même jour", () => {
    const p = planning();
    const marque = marquerRestes(p, "lundi", "diner", true)!;
    expect(estRestes(marque.jours[0]!, "dejeuner")).toBe(false);
  });

  it("ne mute pas le planning d'origine et conserve la semaine", () => {
    const p = planning();
    const instantane = JSON.stringify(p);
    const resultat = marquerRestes(p, "lundi", "diner", true)!;
    expect(JSON.stringify(p)).toBe(instantane);
    expect(resultat.semaine).toBe(p.semaine);
  });

  it("retourne null pour un slot absent (déjeuner non présent ce jour)", () => {
    expect(marquerRestes(planning(), "mardi", "dejeuner", true)).toBeNull();
  });
});
