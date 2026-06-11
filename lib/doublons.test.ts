// Tests de la détection de doublons (#56 PR3, bonus dé-doublonnage).
//
// On teste la RÈGLE : regroupement par nom normalisé (casse/accents/espaces
// indifférents), et exclusion des noms uniques.

import { describe, expect, it } from "vitest";
import { detecterDoublons, normaliserNom } from "@/lib/doublons";
import type { Recette } from "@/types";

// Fabrique de recette minimale (la détection ne lit que id + nom).
function rec(id: string, nom: string): Recette {
  return { id, nom, tempsPreparation: "rapide", ingredients: [] };
}

describe("normaliserNom", () => {
  it("ignore casse, accents et espaces superflus", () => {
    expect(normaliserNom("Lasagnes")).toBe("lasagnes");
    expect(normaliserNom("LASAGNES")).toBe("lasagnes");
    expect(normaliserNom("  Pâtes   carbonara ")).toBe("pates carbonara");
    expect(normaliserNom("Pâtes carbonara")).toBe(normaliserNom("pates  carbonara"));
  });
});

describe("detecterDoublons", () => {
  it("retourne les groupes d'au moins deux recettes de même nom", () => {
    const groupes = detecterDoublons([
      rec("1", "Lasagnes"),
      rec("2", "lasagnes"),
      rec("3", "Tarte aux pommes"),
    ]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].recettes.map((r) => r.id)).toEqual(["1", "2"]);
    expect(groupes[0].nom).toBe("Lasagnes"); // libellé de la première du groupe
  });

  it("attrape les collisions malgré accents et casse", () => {
    const groupes = detecterDoublons([
      rec("1", "Crêpes"),
      rec("2", "crepes"),
      rec("3", "CRÊPES"),
    ]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].recettes).toHaveLength(3);
  });

  it("ne renvoie rien quand tous les noms sont uniques", () => {
    expect(
      detecterDoublons([rec("1", "Soupe"), rec("2", "Curry"), rec("3", "Pizza")])
    ).toEqual([]);
  });

  it("renvoie un tableau vide pour une liste vide", () => {
    expect(detecterDoublons([])).toEqual([]);
  });

  it("gère plusieurs groupes de doublons distincts", () => {
    const groupes = detecterDoublons([
      rec("1", "Pizza"),
      rec("2", "Pizza"),
      rec("3", "Sushi"),
      rec("4", "sushi"),
      rec("5", "Unique"),
    ]);
    expect(groupes).toHaveLength(2);
    expect(groupes.map((g) => g.recettes.length)).toEqual([2, 2]);
  });
});
