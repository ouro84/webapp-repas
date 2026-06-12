// Tests de la logique de coches (lib/coches.ts) — focalisés sur
// categorieComplete (#111) : titre rayé + repli automatique du dernier
// article coché. Le reste de coches.ts est couvert par les e2e courses.

import { describe, expect, it } from "vitest";
import { basculerCoche, categorieComplete } from "@/lib/coches";
import type { Coches } from "@/lib/coches";
import type { CategorieIngredient, Ingredient } from "@/types";

// Fabrique un ingrédient minimal — seuls nom/unité (clé d'agrégation) et
// quantite (validité de la coche, RG-12) comptent ici.
function ing(nom: string, quantite = 1): Ingredient {
  return {
    nom,
    quantite,
    unite: "piece",
    categorie: "epicerie" as CategorieIngredient,
    fondDePlacard: false,
  };
}

// Coche une liste d'ingrédients en chaîne (immuable comme l'app).
function cocherTous(ingredients: Ingredient[]): Coches {
  return ingredients.reduce<Coches>(
    (acc, i) => basculerCoche(acc, i),
    {}
  );
}

describe("categorieComplete (#111)", () => {
  it("est fausse pour une catégorie vide", () => {
    expect(categorieComplete([], {})).toBe(false);
  });

  it("est fausse tant qu'au moins un article reste non coché", () => {
    const articles = [ing("riz"), ing("pâtes"), ing("lentilles")];
    const coches = cocherTous(articles.slice(0, 2));
    expect(categorieComplete(articles, coches)).toBe(false);
  });

  it("devient vraie quand le DERNIER article est coché", () => {
    const articles = [ing("riz"), ing("pâtes")];
    const presqueComplet = cocherTous([articles[0]!]);
    expect(categorieComplete(articles, presqueComplet)).toBe(false);

    const complet = basculerCoche(presqueComplet, articles[1]!);
    expect(categorieComplete(articles, complet)).toBe(true);
  });

  it("redevient fausse si on décoche un article (RG-12)", () => {
    const articles = [ing("riz"), ing("pâtes")];
    const complet = cocherTous(articles);
    expect(categorieComplete(articles, complet)).toBe(true);

    const apresDecoche = basculerCoche(complet, articles[0]!);
    expect(categorieComplete(articles, apresDecoche)).toBe(false);
  });

  it("traite une coche invalidée (quantité changée) comme non cochée (RG-12)", () => {
    const article = ing("riz", 2);
    const coches = basculerCoche({}, article); // coché à quantité 2
    // La liste a maintenant une quantité différente → coche invalidée.
    const articleMaj = ing("riz", 3);
    expect(categorieComplete([articleMaj], coches)).toBe(false);
  });
});
