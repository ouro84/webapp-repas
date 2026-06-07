// Tests unitaires des coches de la liste de courses — US-05, RG-10 à RG-14
// (SPECS_FONCTIONNELLES.md sections 4 et 7) :
//   - bascule cocher/décocher (RG-10)
//   - tri : non cochés d'abord, cochés en fin de catégorie (RG-11)
//   - invalidation silencieuse si la quantité a changé (RG-12)
//   - progression « n/N » hors fond de placard (RG-14)
//
// Données : ingrédients construits à la main — la logique des coches ne
// dépend d'aucune recette, seuls nom/unité/quantité/fondDePlacard comptent.

import { describe, test, expect } from "vitest";
import {
  aDesCoches,
  basculerCoche,
  compterProgression,
  estCoche,
  parserCoches,
  trierAvecCoches,
  type Coches,
} from "@/lib/coches";
import type { Ingredient, ListeCourses } from "@/types";

// Fabrique d'ingrédient avec défauts raisonnables.
function ingredient(
  nom: string,
  quantite = 1,
  surcharges: Partial<Ingredient> = {}
): Ingredient {
  return {
    nom,
    quantite,
    unite: "piece",
    categorie: "legumes-fruits",
    fondDePlacard: false,
    ...surcharges,
  };
}

// Liste de courses minimale : une catégorie + un fond de placard.
function listeAvec(
  normaux: Ingredient[],
  fondDePlacard: Ingredient[] = []
): ListeCourses {
  return {
    normal: [{ categorie: "legumes-fruits", ingredients: normaux }],
    fondDePlacard,
  };
}

// ---------------------------------------------------------------------------
// RG-10 — bascule cocher/décocher
// ---------------------------------------------------------------------------
describe("basculerCoche — RG-10 bascule", () => {
  test("cocher mémorise la quantité courante de l'article", () => {
    const brocolis = ingredient("brocolis", 2);
    const coches = basculerCoche({}, brocolis);

    expect(estCoche(coches, brocolis)).toBe(true);
    expect(coches).toEqual({ "brocolis|piece": 2 });
  });

  test("re-basculer un article coché le décoche", () => {
    const brocolis = ingredient("brocolis", 2);
    const cochees = basculerCoche({}, brocolis);
    const decochees = basculerCoche(cochees, brocolis);

    expect(estCoche(decochees, brocolis)).toBe(false);
    expect(decochees).toEqual({});
  });

  test("ne mute pas l'objet de coches d'entrée", () => {
    const entree: Coches = { "carotte|piece": 3 };
    basculerCoche(entree, ingredient("brocolis"));
    expect(entree).toEqual({ "carotte|piece": 3 });
  });

  test("la clé est insensible à la casse du nom (clé d'agrégation RG-05)", () => {
    const coches = basculerCoche({}, ingredient("Brocolis", 2));
    expect(estCoche(coches, ingredient("brocolis", 2))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RG-12 — invalidation par quantité
// ---------------------------------------------------------------------------
describe("estCoche — RG-12 invalidation", () => {
  test("une coche est invalidée si la quantité de l'article a changé", () => {
    // Coché à 2 pièces, puis un remplacement de slot porte l'agrégat à 4.
    const coches = basculerCoche({}, ingredient("blanc de poulet", 2));
    expect(estCoche(coches, ingredient("blanc de poulet", 4))).toBe(false);
  });

  test("une unité différente est une autre ligne, donc non cochée", () => {
    const coches = basculerCoche({}, ingredient("crème fraîche", 2, { unite: "cas" }));
    expect(
      estCoche(coches, ingredient("crème fraîche", 2, { unite: "briquette" }))
    ).toBe(false);
  });

  test("re-cocher un article à la nouvelle quantité écrase l'ancienne coche", () => {
    const v1 = basculerCoche({}, ingredient("blanc de poulet", 2));
    // Quantité passée à 4 : la coche v1 est invalide, donc le clic COCHE (pas décoche).
    const v2 = basculerCoche(v1, ingredient("blanc de poulet", 4));
    expect(estCoche(v2, ingredient("blanc de poulet", 4))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RG-11 — tri : non cochés d'abord, cochés en fin (groupes alphabétiques)
// ---------------------------------------------------------------------------
describe("trierAvecCoches — RG-11 ordre d'affichage", () => {
  // Entrée déjà alphabétique, comme garanti par genererListeCourses (RG-05).
  const articles = [
    ingredient("aubergine"),
    ingredient("brocolis"),
    ingredient("carotte"),
    ingredient("dattes"),
  ];

  test("sans coche, l'ordre alphabétique est inchangé", () => {
    expect(trierAvecCoches(articles, {}).map((i) => i.nom)).toEqual([
      "aubergine",
      "brocolis",
      "carotte",
      "dattes",
    ]);
  });

  test("les articles cochés passent en fin, chaque groupe reste alphabétique", () => {
    let coches: Coches = {};
    coches = basculerCoche(coches, ingredient("carotte"));
    coches = basculerCoche(coches, ingredient("aubergine"));

    expect(trierAvecCoches(articles, coches).map((i) => i.nom)).toEqual([
      "brocolis",
      "dattes",
      "aubergine", // cochés en fin, alphabétiques entre eux
      "carotte",
    ]);
  });

  test("décocher fait reprendre sa place alphabétique à l'article", () => {
    let coches: Coches = {};
    coches = basculerCoche(coches, ingredient("aubergine"));
    coches = basculerCoche(coches, ingredient("aubergine")); // décoche

    expect(trierAvecCoches(articles, coches).map((i) => i.nom)).toEqual([
      "aubergine",
      "brocolis",
      "carotte",
      "dattes",
    ]);
  });

  test("une coche invalidée par changement de quantité revient en tête de liste", () => {
    const coches = basculerCoche({}, ingredient("brocolis", 1));
    const articlesApresRemplacement = [
      ingredient("aubergine"),
      ingredient("brocolis", 3), // quantité modifiée → coche invalide (RG-12)
    ];
    expect(
      trierAvecCoches(articlesApresRemplacement, coches).map((i) => i.nom)
    ).toEqual(["aubergine", "brocolis"]);
  });
});

// ---------------------------------------------------------------------------
// RG-14 — progression hors fond de placard
// ---------------------------------------------------------------------------
describe("compterProgression — RG-14 compteur", () => {
  const placard = ingredient("sel", 1, { fondDePlacard: true, categorie: "epicerie" });
  const liste = listeAvec(
    [ingredient("aubergine"), ingredient("brocolis"), ingredient("carotte")],
    [placard]
  );

  test("compte les articles à acheter, jamais le fond de placard", () => {
    expect(compterProgression(liste, {})).toEqual({ coches: 0, total: 3 });

    let coches: Coches = basculerCoche({}, ingredient("aubergine"));
    coches = basculerCoche(coches, placard); // fond de placard coché : ignoré
    expect(compterProgression(liste, coches)).toEqual({ coches: 1, total: 3 });
  });

  test("une coche invalidée (quantité changée) ne compte pas", () => {
    const coches = basculerCoche({}, ingredient("aubergine", 9)); // ≠ quantité affichée (1)
    expect(compterProgression(liste, coches)).toEqual({ coches: 0, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// Bouton « Tout décocher » — détection d'au moins une coche valide
// ---------------------------------------------------------------------------
describe("aDesCoches — visibilité de « Tout décocher »", () => {
  const placard = ingredient("sel", 1, { fondDePlacard: true, categorie: "epicerie" });
  const liste = listeAvec([ingredient("aubergine")], [placard]);

  test("faux sans coche, vrai dès qu'un article à acheter est coché", () => {
    expect(aDesCoches(liste, {})).toBe(false);
    expect(aDesCoches(liste, basculerCoche({}, ingredient("aubergine")))).toBe(true);
  });

  test("vrai si seul un article du fond de placard est coché", () => {
    expect(aDesCoches(liste, basculerCoche({}, placard))).toBe(true);
  });

  test("faux si la seule coche est invalide (quantité changée)", () => {
    const coches = basculerCoche({}, ingredient("aubergine", 9));
    expect(aDesCoches(liste, coches)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parserCoches — tolérance aux données absentes ou corrompues
// ---------------------------------------------------------------------------
describe("parserCoches — robustesse localStorage", () => {
  test("null (clé absente) → aucune coche", () => {
    expect(parserCoches(null)).toEqual({});
  });

  test("JSON invalide → aucune coche", () => {
    expect(parserCoches("{pas du json")).toEqual({});
  });

  test("forme inattendue (tableau, scalaire) → aucune coche", () => {
    expect(parserCoches("[1,2]")).toEqual({});
    expect(parserCoches('"texte"')).toEqual({});
  });

  test("entrées non numériques filtrées, numériques conservées", () => {
    expect(
      parserCoches('{"brocolis|piece": 2, "carotte|piece": "trois", "sel|cac": null}')
    ).toEqual({ "brocolis|piece": 2 });
  });

  test("aller-retour avec basculerCoche", () => {
    const coches = basculerCoche({}, ingredient("brocolis", 2));
    expect(parserCoches(JSON.stringify(coches))).toEqual(coches);
  });
});
