// Tests unitaires des articles manuels de la liste de courses — US-47, RG-40
// à RG-43 (SPECS_FONCTIONNELLES.md) :
//   - mapping vers la forme d'affichage Ingredient (discriminant `source`)
//   - fusion dans la liste agrégée (RG-05/RG-39) sans dupliquer le tri
//   - l'état coché est porté DIRECTEMENT par la ligne (RG-41), pas par un
//     blob de coches par clé nom|unité

import { describe, test, expect } from "vitest";
import {
  articleManuelVersIngredient,
  aQuantiteRenseignee,
  fusionnerArticlesManuels,
} from "@/lib/articles-manuels";
import { estCoche } from "@/lib/coches";
import type { ArticleManuel, ListeCourses } from "@/types";

function article(surcharges: Partial<ArticleManuel> = {}): ArticleManuel {
  return {
    id: "am-1",
    libelle: "Sacs poubelle",
    quantite: null,
    unite: null,
    categorie: "autre",
    fondDePlacard: false,
    coche: false,
    ...surcharges,
  };
}

describe("articleManuelVersIngredient — mapping d'affichage", () => {
  test("porte le libellé, la catégorie, le fond de placard et l'id", () => {
    const ing = articleManuelVersIngredient(
      article({ libelle: "Sacs poubelle", categorie: "epicerie", fondDePlacard: true })
    );
    expect(ing.nom).toBe("Sacs poubelle");
    expect(ing.categorie).toBe("epicerie");
    expect(ing.fondDePlacard).toBe(true);
    expect(ing.id).toBe("am-1");
  });

  test("porte le discriminant source: manuel et l'état coché de la ligne", () => {
    const ing = articleManuelVersIngredient(article({ coche: true }));
    expect(ing.source).toBe("manuel");
    expect(ing.coche).toBe(true);
  });

  test("quantité/unité absentes (RG-43) sont neutralisées pour l'affichage", () => {
    const ing = articleManuelVersIngredient(article({ quantite: null, unite: null }));
    expect(ing.quantite).toBe(0);
    expect(ing.unite).toBe("piece");
  });

  test("quantité/unité renseignées sont conservées", () => {
    const ing = articleManuelVersIngredient(article({ quantite: 2, unite: "sachet" }));
    expect(ing.quantite).toBe(2);
    expect(ing.unite).toBe("sachet");
  });
});

describe("aQuantiteRenseignee — RG-43 affichage conditionnel de la quantité", () => {
  test("faux quand la quantité n'a pas été renseignée", () => {
    expect(aQuantiteRenseignee(articleManuelVersIngredient(article({ quantite: null })))).toBe(false);
  });

  test("vrai quand la quantité a été renseignée, même à une valeur faible", () => {
    expect(
      aQuantiteRenseignee(articleManuelVersIngredient(article({ quantite: 1, unite: "piece" })))
    ).toBe(true);
  });
});

describe("estCoche — reconnaît le discriminant manuel (#216)", () => {
  test("un article manuel coché est reconnu coché indépendamment du blob de coches", () => {
    const ing = articleManuelVersIngredient(article({ coche: true }));
    expect(estCoche({}, ing)).toBe(true);
  });

  test("un article manuel non coché est reconnu non coché même si une clé collision existe", () => {
    const ing = articleManuelVersIngredient(article({ coche: false, libelle: "sel" }));
    // Une coche recette portant la même clé nom|unité ne doit PAS déteindre
    // sur l'article manuel : sa source d'état coché est sa propre colonne.
    expect(estCoche({ "sel|piece": 0 }, ing)).toBe(false);
  });
});

describe("fusionnerArticlesManuels — insertion dans la liste agrégée (RG-05/RG-39)", () => {
  const listeVide: ListeCourses = { normal: [], fondDePlacard: [] };

  test("crée une nouvelle section de catégorie si absente de la liste dérivée", () => {
    const fusionnee = fusionnerArticlesManuels(listeVide, [
      article({ id: "am-1", libelle: "Ampoules", categorie: "autre" }),
    ]);
    expect(fusionnee.normal).toHaveLength(1);
    expect(fusionnee.normal[0]!.categorie).toBe("autre");
    expect(fusionnee.normal[0]!.ingredients.map((i) => i.nom)).toEqual(["Ampoules"]);
  });

  test("s'insère dans une section de catégorie existante, au bon rang canonique", () => {
    const liste: ListeCourses = {
      normal: [
        { categorie: "epicerie", ingredients: [{ nom: "Riz", quantite: 500, unite: "g", categorie: "epicerie", fondDePlacard: false }] },
      ],
      fondDePlacard: [],
    };
    const fusionnee = fusionnerArticlesManuels(liste, [
      article({ id: "am-1", libelle: "Café", categorie: "epicerie" }),
    ]);
    expect(fusionnee.normal).toHaveLength(1);
    expect(fusionnee.normal[0]!.ingredients.map((i) => i.nom)).toEqual(["Café", "Riz"]);
  });

  test("respecte l'ordre canonique des catégories quand plusieurs sections sont créées", () => {
    const fusionnee = fusionnerArticlesManuels(listeVide, [
      article({ id: "am-1", libelle: "Ampoules", categorie: "autre" }),
      article({ id: "am-2", libelle: "Yaourts", categorie: "produits-frais" }),
    ]);
    expect(fusionnee.normal.map((l) => l.categorie)).toEqual(["produits-frais", "autre"]);
  });

  test("un article manuel fond de placard rejoint la section dédiée", () => {
    const fusionnee = fusionnerArticlesManuels(listeVide, [
      article({ id: "am-1", libelle: "Piles", fondDePlacard: true }),
    ]);
    expect(fusionnee.normal).toHaveLength(0);
    expect(fusionnee.fondDePlacard.map((i) => i.nom)).toEqual(["Piles"]);
  });

  test("ne mute pas la liste d'entrée", () => {
    const liste: ListeCourses = {
      normal: [{ categorie: "epicerie", ingredients: [{ nom: "Riz", quantite: 500, unite: "g", categorie: "epicerie", fondDePlacard: false }] }],
      fondDePlacard: [],
    };
    fusionnerArticlesManuels(liste, [article({ id: "am-1", libelle: "Café", categorie: "epicerie" })]);
    expect(liste.normal[0]!.ingredients).toHaveLength(1);
  });

  test("liste vide d'articles manuels renvoie une liste équivalente inchangée", () => {
    const liste: ListeCourses = {
      normal: [{ categorie: "epicerie", ingredients: [{ nom: "Riz", quantite: 500, unite: "g", categorie: "epicerie", fondDePlacard: false }] }],
      fondDePlacard: [],
    };
    expect(fusionnerArticlesManuels(liste, [])).toEqual(liste);
  });
});
