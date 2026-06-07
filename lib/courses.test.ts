// Tests unitaires de l'agrégation de la liste de courses — RG-05
// (SPECS_FONCTIONNELLES.md section 6) :
//   1. collecter tous les ingrédients du planning
//   2. regrouper par nom, insensible à la casse
//   3. additionner les quantités à nom ET unité identiques
//      (cas limite : unités différentes → lignes séparées, pas de conversion)
//   4. isoler les ingrédients fond de placard dans une section dédiée
//   5. trier par catégorie (ordre canonique), puis par nom
//
// Données : les fixtures de tests/fixtures/recettes.ts, assemblées dans des
// plannings construits à la main pour des assertions déterministes.
// Découplé de data/recettes.json (issue #29) : le vrai dataset peut évoluer
// librement sans casser ces tests.

import { describe, test, expect } from "vitest";
import { genererListeCourses } from "@/lib/courses";
import { RECETTES_FIXTURES, recetteFixture } from "@/tests/fixtures/recettes";
import type { CategorieIngredient, Jour, Planning, Recette } from "@/types";

const ORDRE_CATEGORIES: CategorieIngredient[] = [
  "viandes-poissons",
  "legumes-fruits",
  "produits-frais",
  "epicerie",
  "boulangerie",
  "surgeles",
  "autre",
];

// Planning minimal : un dîner par recette fournie (7 max).
function planningAvec(...recettes: Recette[]): Planning {
  const jours: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  return {
    semaine: "2026-W23",
    jours: recettes.map((r, i) => ({ jour: jours[i]!, diner: r })),
  };
}

// Toutes les lignes de la liste (sections normale + fond de placard).
function toutesLesLignes(planning: Planning) {
  const liste = genererListeCourses(planning);
  return [...liste.normal.flatMap((l) => l.ingredients), ...liste.fondDePlacard];
}

// ---------------------------------------------------------------------------
// RG-05 étapes 1 à 3 — collecte et agrégation des quantités :
// même nom + même unité → une seule ligne, quantités additionnées.
// ---------------------------------------------------------------------------
describe("genererListeCourses — RG-05 agrégation des quantités", () => {
  test("additionne les quantités d'un ingrédient présent dans plusieurs recettes", () => {
    // Le parmesan (en grammes) apparaît dans ces trois fixtures.
    const sources = [
      recetteFixture("tagliatelles-au-parmesan"),
      recetteFixture("risotto-au-parmesan"),
      recetteFixture("gratin-de-courgettes"),
    ];
    const lignes = toutesLesLignes(planningAvec(...sources));

    const lignesParmesan = lignes.filter((i) => i.nom.toLowerCase() === "parmesan");
    expect(lignesParmesan).toHaveLength(1); // une seule ligne, pas trois

    // Oracle indépendant : somme recalculée depuis les données brutes.
    const attendu = sources
      .flatMap((r) => r.ingredients)
      .filter((i) => i.nom.toLowerCase() === "parmesan" && i.unite === "g")
      .reduce((total, i) => total + i.quantite, 0);
    expect(lignesParmesan[0]!.quantite).toBe(attendu);
  });

  test("regroupe les noms sans tenir compte de la casse", () => {
    // Même fixture dupliquée avec ses noms d'ingrédients en MAJUSCULES :
    // chaque ingrédient doit fusionner avec son jumeau, quantité doublée.
    const originale = recetteFixture("omelette-aux-champignons");
    const enMajuscules: Recette = {
      ...originale,
      id: "clone-majuscules",
      ingredients: originale.ingredients.map((i) => ({
        ...i,
        nom: i.nom.toLocaleUpperCase("fr"),
      })),
    };
    const lignes = toutesLesLignes(planningAvec(originale, enMajuscules));

    expect(lignes).toHaveLength(originale.ingredients.length);
    for (const ingredient of originale.ingredients) {
      const ligne = lignes.find(
        (l) => l.nom.toLocaleLowerCase("fr") === ingredient.nom.toLocaleLowerCase("fr")
      );
      expect(ligne, `ligne attendue pour ${ingredient.nom}`).toBeDefined();
      expect(ligne!.quantite).toBe(ingredient.quantite * 2);
    }
  });

  test("garde des lignes séparées pour un même ingrédient en unités différentes", () => {
    // Dans les fixtures, la crème fraîche existe en "cas" (gratin)
    // et en "briquette" (quiche).
    const enCas = recetteFixture("gratin-de-courgettes");
    const enBriquette = recetteFixture("quiche-aux-lardons");

    const lignes = toutesLesLignes(planningAvec(enCas, enBriquette));
    const lignesCreme = lignes.filter((i) => i.nom.toLowerCase() === "crème fraîche");

    expect(lignesCreme).toHaveLength(2); // aucune conversion tentée
    expect(lignesCreme.map((l) => l.unite).sort()).toEqual(["briquette", "cas"]);
  });
});

// ---------------------------------------------------------------------------
// RG-05 étape 4 — les ingrédients fondDePlacard: true sont exclus de la
// liste à acheter et isolés dans leur section (« à vérifier avant d'acheter »).
// ---------------------------------------------------------------------------
describe("genererListeCourses — RG-05 section fond de placard", () => {
  test("isole les ingrédients fond de placard hors de la liste à acheter", () => {
    const liste = genererListeCourses(
      planningAvec(
        recetteFixture("omelette-aux-champignons"),
        recetteFixture("tagliatelles-au-parmesan")
      )
    );

    // La section dédiée ne contient que des ingrédients flaggués…
    expect(liste.fondDePlacard.length).toBeGreaterThan(0);
    for (const ingredient of liste.fondDePlacard) {
      expect(ingredient.fondDePlacard).toBe(true);
    }
    // …et la liste à acheter n'en contient aucun.
    for (const ligne of liste.normal) {
      for (const ingredient of ligne.ingredients) {
        expect(ingredient.fondDePlacard).toBe(false);
      }
    }
  });

  test("additionne aussi les quantités dans le fond de placard", () => {
    // Le sel (en cac) est flaggué fond de placard dans ces deux fixtures.
    const sources = [
      recetteFixture("tagliatelles-au-parmesan"),
      recetteFixture("gratin-de-courgettes"),
    ];
    const liste = genererListeCourses(planningAvec(...sources));

    const sel = liste.fondDePlacard.filter((i) => i.nom.toLowerCase() === "sel");
    expect(sel).toHaveLength(1);
    const attendu = sources
      .flatMap((r) => r.ingredients)
      .filter((i) => i.nom.toLowerCase() === "sel" && i.unite === "cac")
      .reduce((total, i) => total + i.quantite, 0);
    expect(sel[0]!.quantite).toBe(attendu);
  });
});

// ---------------------------------------------------------------------------
// RG-05 étape 5 — tri : catégories dans l'ordre canonique (parcours
// magasin), noms alphabétiques dans chaque catégorie, et fond de placard
// alphabétique. Les catégories vides n'apparaissent pas.
// ---------------------------------------------------------------------------
describe("genererListeCourses — RG-05 tri et présentation", () => {
  // Un planning copieux pour couvrir plusieurs catégories.
  const planningComplet = planningAvec(...RECETTES_FIXTURES.slice(0, 7));

  test("ordonne les catégories selon le parcours magasin", () => {
    const liste = genererListeCourses(planningComplet);
    const positions = liste.normal.map((l) => ORDRE_CATEGORIES.indexOf(l.categorie));

    expect(positions).not.toContain(-1); // uniquement des catégories connues
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  test("trie les ingrédients par ordre alphabétique dans chaque catégorie", () => {
    const liste = genererListeCourses(planningComplet);
    for (const ligne of liste.normal) {
      const noms = ligne.ingredients.map((i) => i.nom);
      const tries = [...noms].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      expect(noms).toEqual(tries);
    }
  });

  test("trie le fond de placard par ordre alphabétique", () => {
    const liste = genererListeCourses(planningComplet);
    const noms = liste.fondDePlacard.map((i) => i.nom);
    const tries = [...noms].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    expect(noms).toEqual(tries);
  });

  test("omet les catégories sans aucun ingrédient", () => {
    // L'omelette seule ne couvre pas toutes les catégories du référentiel.
    const liste = genererListeCourses(planningAvec(recetteFixture("omelette-aux-champignons")));
    for (const ligne of liste.normal) {
      expect(ligne.ingredients.length).toBeGreaterThan(0);
    }
    expect(liste.normal.length).toBeLessThan(ORDRE_CATEGORIES.length);
  });
});

// ---------------------------------------------------------------------------
// Garantie transverse — l'agrégation ne modifie jamais le planning fourni
// (les quantités sont copiées avant addition).
// ---------------------------------------------------------------------------
describe("genererListeCourses — immutabilité", () => {
  test("ne modifie pas le planning ni ses recettes", () => {
    const planning = planningAvec(
      recetteFixture("tagliatelles-au-parmesan"),
      recetteFixture("quiche-aux-lardons"),
      recetteFixture("soupe-de-legumes")
    );
    const instantane = JSON.stringify(planning);
    genererListeCourses(planning);
    expect(JSON.stringify(planning)).toBe(instantane);
  });
});

// ---------------------------------------------------------------------------
// RG-17 — mise à l'échelle selon le nombre de personnes (US-07).
// L'échelle s'applique par slot AVANT agrégation, l'arrondi APRÈS.
// ---------------------------------------------------------------------------
describe("genererListeCourses — RG-17 mise à l'échelle (US-07)", () => {
  // Quantité d'un ingrédient donné dans la liste générée (toutes sections).
  function quantiteDe(planning: Planning, nom: string): number | undefined {
    return toutesLesLignes(planning).find(
      (i) => i.nom.toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr")
    )?.quantite;
  }

  test("sans réglage, les quantités sont celles de la recette (facteur 1)", () => {
    const omelette = recetteFixture("omelette-aux-champignons"); // oeufs: 6 piece
    const planning = planningAvec(omelette);
    expect(quantiteDe(planning, "oeufs")).toBe(6);
  });

  test("un slot à 4 personnes double les quantités de ses ingrédients", () => {
    const omelette = recetteFixture("omelette-aux-champignons");
    const planning: Planning = {
      semaine: "2026-W23",
      jours: [{ jour: "lundi", diner: omelette, personnes: { diner: 4 } }],
    };
    // oeufs 6 → ×2 = 12 (piece, entier) ; champignons 250 g → 500 g.
    expect(quantiteDe(planning, "oeufs")).toBe(12);
    expect(quantiteDe(planning, "champignons de Paris")).toBe(500);
  });

  test("un slot à 1 personne réduit de moitié, arrondi par unité", () => {
    const omelette = recetteFixture("omelette-aux-champignons");
    const planning: Planning = {
      semaine: "2026-W23",
      jours: [{ jour: "lundi", diner: omelette, personnes: { diner: 1 } }],
    };
    // oeufs 6 → ×0,5 = 3 (piece) ; champignons 250 g → 125 g.
    expect(quantiteDe(planning, "oeufs")).toBe(3);
    expect(quantiteDe(planning, "champignons de Paris")).toBe(125);
  });

  test("arrondi APRÈS agrégation : deux slots à 1 pers. du même ingrédient", () => {
    // omelette (6 oeufs) à 1 pers. = 3 ; quiche (3 oeufs) à 1 pers. = 1,5.
    // Agrégé = 4,5 → arrondi piece (entier sup) = 5.
    // Si on arrondissait AVANT : 3 + ceil(1,5)=2 = 5 aussi ici, donc on prend
    // un cas où ça diverge : deux fois la quiche (3 oeufs) à 1 pers.
    // Chaque = 1,5 ; arrondi avant → 2+2 = 4 ; après → ceil(3) = 3.
    const quiche = recetteFixture("quiche-aux-lardons"); // oeufs: 3 piece
    const quicheBis: Recette = { ...quiche, id: "quiche-bis" };
    const planning: Planning = {
      semaine: "2026-W23",
      jours: [
        { jour: "lundi", diner: quiche, personnes: { diner: 1 } },
        { jour: "mardi", diner: quicheBis, personnes: { diner: 1 } },
      ],
    };
    expect(quantiteDe(planning, "oeufs")).toBe(3); // ceil(1,5 + 1,5), pas 4
  });
});
