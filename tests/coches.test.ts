// Tests des coches de la liste de courses (lib/coches.ts, US-05) — focalisés
// sur le tri des catégories terminées (RG-39, #111).
//
// Une coche est valide quand coches[`nom|unité`] === quantité de l'article
// (RG-12) : on construit donc les coches directement par clé d'agrégation.

import { describe, expect, it } from "vitest";
import {
  categorieTerminee,
  trierCategoriesAvecCoches,
  type Coches,
} from "@/lib/coches";
import type { CategorieIngredient, Ingredient, LignesCourses } from "@/types";

// Fabrique un ingrédient minimal — nom/quantité/unité/catégorie suffisent ici.
function ing(
  nom: string,
  quantite: number,
  categorie: CategorieIngredient
): Ingredient {
  return { nom, quantite, unite: "g", categorie, fondDePlacard: false };
}

// Construit une catégorie (LignesCourses) à partir d'ingrédients.
function ligne(
  categorie: CategorieIngredient,
  ingredients: Ingredient[]
): LignesCourses {
  return { categorie, ingredients };
}

// Coche tous les ingrédients passés (clé `nom|unité` → quantité courante).
function cocher(...ingredients: Ingredient[]): Coches {
  const coches: Coches = {};
  for (const i of ingredients) {
    coches[`${i.nom.toLocaleLowerCase("fr")}|${i.unite}`] = i.quantite;
  }
  return coches;
}

describe("categorieTerminee (RG-39)", () => {
  it("est vraie quand tous les articles sont cochés", () => {
    const a = ing("Carottes", 200, "legumes-fruits");
    const b = ing("Tomates", 300, "legumes-fruits");
    expect(categorieTerminee(ligne("legumes-fruits", [a, b]), cocher(a, b))).toBe(
      true
    );
  });

  it("est fausse si un seul article reste à cocher", () => {
    const a = ing("Carottes", 200, "legumes-fruits");
    const b = ing("Tomates", 300, "legumes-fruits");
    expect(categorieTerminee(ligne("legumes-fruits", [a, b]), cocher(a))).toBe(
      false
    );
  });

  it("est fausse pour une catégorie vide", () => {
    expect(categorieTerminee(ligne("epicerie", []), {})).toBe(false);
  });

  it("est vraie pour une catégorie à un seul article coché", () => {
    const a = ing("Riz", 250, "epicerie");
    expect(categorieTerminee(ligne("epicerie", [a]), cocher(a))).toBe(true);
  });

  it("est fausse si une coche est invalidée par changement de quantité (RG-12)", () => {
    const a = ing("Carottes", 200, "legumes-fruits");
    // Coche posée à 150 g alors que l'article en réclame 200 → invalidée.
    const cochesPerimee: Coches = { "carottes|g": 150 };
    expect(
      categorieTerminee(ligne("legumes-fruits", [a]), cochesPerimee)
    ).toBe(false);
  });
});

describe("trierCategoriesAvecCoches (RG-39)", () => {
  const viandes = ligne("viandes-poissons", [ing("Poulet", 400, "viandes-poissons")]);
  const legumes = ligne("legumes-fruits", [ing("Carottes", 200, "legumes-fruits")]);
  const epicerie = ligne("epicerie", [ing("Riz", 250, "epicerie")]);

  it("préserve l'ordre canonique quand rien n'est coché", () => {
    const tri = trierCategoriesAvecCoches([viandes, legumes, epicerie], {});
    expect(tri.map((l) => l.categorie)).toEqual([
      "viandes-poissons",
      "legumes-fruits",
      "epicerie",
    ]);
  });

  it("glisse une catégorie terminée en bas de liste", () => {
    // Viandes entièrement coché → doit passer après légumes et épicerie.
    const coches = cocher(viandes.ingredients[0]);
    const tri = trierCategoriesAvecCoches([viandes, legumes, epicerie], coches);
    expect(tri.map((l) => l.categorie)).toEqual([
      "legumes-fruits",
      "epicerie",
      "viandes-poissons",
    ]);
  });

  it("conserve l'ordre canonique au sein des terminées et des non-terminées", () => {
    // Viandes ET épicerie terminés → tous deux en bas, dans l'ordre canonique.
    const coches = cocher(viandes.ingredients[0], epicerie.ingredients[0]);
    const tri = trierCategoriesAvecCoches([viandes, legumes, epicerie], coches);
    expect(tri.map((l) => l.categorie)).toEqual([
      "legumes-fruits",
      "viandes-poissons",
      "epicerie",
    ]);
  });

  it("remonte une catégorie quand une coche est invalidée (RG-12, RG-39)", () => {
    // Une coche périmée sur viandes : la catégorie n'est plus terminée → reste
    // à sa place canonique (en tête), pas en bas.
    const cochesPerimee: Coches = { "poulet|g": 999 };
    const tri = trierCategoriesAvecCoches([viandes, legumes], cochesPerimee);
    expect(tri.map((l) => l.categorie)).toEqual([
      "viandes-poissons",
      "legumes-fruits",
    ]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const entree = [viandes, legumes, epicerie];
    const copie = [...entree];
    trierCategoriesAvecCoches(entree, cocher(viandes.ingredients[0]));
    expect(entree).toEqual(copie);
  });
});
