// Tests du cœur saisonnalité (#23, P12) : mapping mois→saison (RG-02),
// estDeSaison, et l'heuristique de suggestion (intersection, repli toute saison).

import { describe, expect, it } from "vitest";
import { estDeSaison, saisonDuMois, suggererSaisons } from "@/lib/saisons";
import type { Ingredient } from "@/types";

function ing(nom: string): Ingredient {
  return { nom, quantite: 1, unite: "piece", categorie: "autre", fondDePlacard: false };
}

describe("saisonDuMois (RG-02)", () => {
  it("mappe les mois aux saisons", () => {
    // janvier(0)..mars(2) + décembre(11) = hiver
    for (const m of [11, 0, 1, 2]) expect(saisonDuMois(m)).toBe("hiver");
    // avril(3), mai(4) = printemps
    for (const m of [3, 4]) expect(saisonDuMois(m)).toBe("printemps");
    // juin(5)..septembre(8) = été
    for (const m of [5, 6, 7, 8]) expect(saisonDuMois(m)).toBe("ete");
    // octobre(9), novembre(10) = automne
    for (const m of [9, 10]) expect(saisonDuMois(m)).toBe("automne");
  });
});

describe("estDeSaison", () => {
  it("toute recette sans saison déclarée est de toute saison", () => {
    expect(estDeSaison({}, "hiver")).toBe(true);
    expect(estDeSaison({ saisons: [] }, "ete")).toBe(true);
  });

  it("respecte la liste de saisons déclarée", () => {
    expect(estDeSaison({ saisons: ["ete"] }, "ete")).toBe(true);
    expect(estDeSaison({ saisons: ["ete"] }, "hiver")).toBe(false);
    expect(estDeSaison({ saisons: ["automne", "hiver"] }, "hiver")).toBe(true);
  });
});

describe("suggererSaisons", () => {
  it("aucun produit saisonnier → toute l'année (liste vide)", () => {
    expect(suggererSaisons([ing("Poulet"), ing("Riz"), ing("Crème")])).toEqual([]);
  });

  it("un produit d'été → été", () => {
    expect(suggererSaisons([ing("Tomates"), ing("Poulet")])).toEqual(["ete"]);
  });

  it("produit d'automne/hiver (multi-saisons, RG-01)", () => {
    expect(suggererSaisons([ing("Butternut")])).toEqual(["automne", "hiver"]);
  });

  it("intersection de plusieurs produits saisonniers", () => {
    // poireau (automne, hiver) ∩ butternut (automne, hiver) = automne, hiver
    expect(suggererSaisons([ing("Poireaux"), ing("Butternut")])).toEqual([
      "automne",
      "hiver",
    ]);
  });

  it("produits incompatibles → intersection vide → toute l'année", () => {
    // tomate (été) ∩ butternut (automne, hiver) = vide → toute l'année
    expect(suggererSaisons([ing("Tomates"), ing("Butternut")])).toEqual([]);
  });

  it("les aromates / produits de garde ne contraignent pas", () => {
    // ail/oignon/carotte/pomme de terre absents de la table → toute l'année.
    expect(
      suggererSaisons([ing("Ail"), ing("Oignon"), ing("Pommes de terre")])
    ).toEqual([]);
  });

  it("est robuste aux accents et pluriels", () => {
    expect(suggererSaisons([ing("ÉPINARDS")])).toEqual(["printemps", "automne"]);
  });
});
