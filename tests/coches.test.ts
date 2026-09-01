// Tests des coches de la liste de courses (lib/coches.ts, US-05) — focalisés
// sur le tri des catégories terminées (RG-39, #111).
//
// Une coche est valide quand coches[`nom|unité`] === quantité de l'article
// (RG-12) : on construit donc les coches directement par clé d'agrégation.

import { describe, expect, it } from "vitest";
import {
  categorieTerminee,
  cibleAtterrissage,
  compterCategoriesTerminees,
  libelleCategoriesTerminees,
  trierCategoriesAvecCoches,
  type Coches,
} from "@/lib/coches";
import type {
  CategorieIngredient,
  Ingredient,
  LignesCourses,
  ListeCourses,
} from "@/types";

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

// ============================================================================
// Lisibilité du déplacement (RG-11 / RG-39) — les premiers utilisateurs
// croyaient qu'un article coché avait DISPARU.
// ============================================================================

// Construit une ListeCourses depuis des lignes (fond de placard vide sauf
// mention contraire).
function liste(
  lignes: LignesCourses[],
  fondDePlacard: Ingredient[] = []
): ListeCourses {
  return { normal: lignes, fondDePlacard };
}

describe("compterCategoriesTerminees (RG-39)", () => {
  const a = ing("Carottes", 200, "legumes-fruits");
  const b = ing("Tomates", 300, "legumes-fruits");
  const c = ing("Riz", 500, "epicerie");

  it("compte 0 quand rien n'est coché", () => {
    const l = liste([ligne("legumes-fruits", [a, b]), ligne("epicerie", [c])]);
    expect(compterCategoriesTerminees(l, {})).toBe(0);
  });

  it("compte une catégorie dont tous les articles sont cochés", () => {
    const l = liste([ligne("legumes-fruits", [a, b]), ligne("epicerie", [c])]);
    expect(compterCategoriesTerminees(l, cocher(a, b))).toBe(1);
  });

  it("compte plusieurs catégories terminées", () => {
    const l = liste([ligne("legumes-fruits", [a, b]), ligne("epicerie", [c])]);
    expect(compterCategoriesTerminees(l, cocher(a, b, c))).toBe(2);
  });

  it("ne compte pas une catégorie partiellement cochée", () => {
    const l = liste([ligne("legumes-fruits", [a, b])]);
    expect(compterCategoriesTerminees(l, cocher(a))).toBe(0);
  });

  it("ne compte pas une catégorie vide (cohérent avec categorieTerminee)", () => {
    const l = liste([ligne("legumes-fruits", [])]);
    expect(compterCategoriesTerminees(l, {})).toBe(0);
  });

  it("décompte une catégorie dont une coche est invalidée (RG-12)", () => {
    const l = liste([ligne("legumes-fruits", [a, b])]);
    // La quantité de `b` a changé : sa coche mémorise l'ancienne valeur.
    const coches = { ...cocher(a, b), "tomates|g": 999 };
    expect(compterCategoriesTerminees(l, coches)).toBe(0);
  });

  it("ignore le fond de placard, qui ne se réordonne jamais (RG-14)", () => {
    const placard = ing("Sel", 1, "epicerie");
    const l = liste([ligne("legumes-fruits", [a, b])], [placard]);
    expect(compterCategoriesTerminees(l, cocher(a, b, placard))).toBe(1);
  });
});

describe("libelleCategoriesTerminees (RG-39)", () => {
  it("est vide quand aucune catégorie n'est terminée", () => {
    expect(libelleCategoriesTerminees(0)).toBe("");
    expect(libelleCategoriesTerminees(-1)).toBe("");
  });

  it("accorde au singulier", () => {
    expect(libelleCategoriesTerminees(1)).toBe(
      "1 catégorie terminée, descendue en bas de la liste"
    );
  });

  it("accorde au pluriel", () => {
    expect(libelleCategoriesTerminees(3)).toBe(
      "3 catégories terminées, descendues en bas de la liste"
    );
  });
});

describe("cibleAtterrissage (RG-11 / RG-39)", () => {
  const a = ing("Carottes", 200, "legumes-fruits");
  const b = ing("Tomates", 300, "legumes-fruits");
  const c = ing("Riz", 500, "epicerie");

  it("vise la LIGNE quand la coche ne termine pas la catégorie", () => {
    const l = liste([ligne("legumes-fruits", [a, b])]);
    expect(cibleAtterrissage(l, {}, a)).toBe("article-carottes-g");
  });

  it("vise la CATÉGORIE quand la coche la termine", () => {
    const l = liste([ligne("legumes-fruits", [a, b])]);
    // `a` est déjà coché : cocher `b` termine la catégorie.
    expect(cibleAtterrissage(l, cocher(a), b)).toBe("categorie-legumes-fruits");
  });

  it("vise la CATÉGORIE quand elle ne contient qu'un article", () => {
    const l = liste([ligne("epicerie", [c])]);
    expect(cibleAtterrissage(l, {}, c)).toBe("categorie-epicerie");
  });

  it("ne vise RIEN sur une décoche (l'article remonte vers le haut)", () => {
    const l = liste([ligne("legumes-fruits", [a, b])]);
    expect(cibleAtterrissage(l, cocher(a), a)).toBeNull();
    expect(cibleAtterrissage(l, cocher(a, b), b)).toBeNull();
  });

  it("vise la LIGNE pour un article du fond de placard (section figée, RG-14)", () => {
    const placard = ing("Sel", 1, "epicerie");
    const l = liste([ligne("legumes-fruits", [a])], [placard]);
    expect(cibleAtterrissage(l, {}, placard)).toBe("article-sel-g");
  });

  it("identifie un article manuel par son id, pas par son libellé (RG-42)", () => {
    const manuel1: Ingredient = {
      nom: "Piles",
      quantite: 0,
      unite: "piece",
      categorie: "epicerie",
      fondDePlacard: false,
      source: "manuel",
      id: "aaa",
      coche: false,
    };
    // Même libellé, id différent : cocher l'un ne termine pas la catégorie.
    const manuel2: Ingredient = { ...manuel1, id: "bbb" };
    const l = liste([ligne("epicerie", [manuel1, manuel2])]);
    expect(cibleAtterrissage(l, {}, manuel1)).toBe("article-aaa");

    const l2 = liste([ligne("epicerie", [manuel1, { ...manuel2, coche: true }])]);
    expect(cibleAtterrissage(l2, {}, manuel1)).toBe("categorie-epicerie");
  });
});
