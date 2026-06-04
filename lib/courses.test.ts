// Tests unitaires de l'agrégation de la liste de courses — RG-05
// (SPECS_FONCTIONNELLES.md section 6) :
//   1. collecter tous les ingrédients du planning
//   2. regrouper par nom, insensible à la casse
//   3. additionner les quantités à nom ET unité identiques
//      (cas limite : unités différentes → lignes séparées, pas de conversion)
//   4. isoler les ingrédients fond de placard dans une section dédiée
//   5. trier par catégorie (ordre canonique), puis par nom
//
// Données : les vraies recettes de data/recettes.json, assemblées dans des
// plannings construits à la main pour des assertions déterministes.

import { describe, test, expect } from "vitest";
import { genererListeCourses } from "@/lib/courses";
import recettesJson from "@/data/recettes.json";
import type { CategorieIngredient, Jour, Planning, Recette } from "@/types";

const RECETTES = recettesJson as Recette[];

const ORDRE_CATEGORIES: CategorieIngredient[] = [
  "viandes-poissons",
  "legumes-fruits",
  "produits-frais",
  "epicerie",
  "boulangerie",
  "surgeles",
  "autre",
];

// Recette réelle par id — échoue bruyamment si le dataset change.
function recette(id: string): Recette {
  const trouvee = RECETTES.find((r) => r.id === id);
  if (!trouvee) throw new Error(`Recette absente du dataset : ${id}`);
  return trouvee;
}

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
    // Le parmesan (en grammes) apparaît dans ces trois recettes réelles.
    const sources = [
      recette("pates-au-pesto"),
      recette("salade-cesar-au-poulet"),
      recette("spaghetti-carbonara"),
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
    // Même recette réelle dupliquée avec ses noms d'ingrédients en MAJUSCULES :
    // chaque ingrédient doit fusionner avec son jumeau, quantité doublée.
    const originale = recette("omelette-aux-fines-herbes");
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
    // Dans le dataset réel, la crème fraîche existe en "cas" et en "briquette".
    const enCas = RECETTES.find((r) =>
      r.ingredients.some((i) => i.nom.toLowerCase() === "crème fraîche" && i.unite === "cas")
    );
    const enBriquette = RECETTES.find((r) =>
      r.ingredients.some((i) => i.nom.toLowerCase() === "crème fraîche" && i.unite === "briquette")
    );
    expect(enCas).toBeDefined();
    expect(enBriquette).toBeDefined();

    const lignes = toutesLesLignes(planningAvec(enCas!, enBriquette!));
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
      planningAvec(recette("omelette-aux-fines-herbes"), recette("pates-au-pesto"))
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
    // Le sel (en cac) est flaggué fond de placard dans plusieurs recettes réelles.
    const sources = [recette("omelette-aux-fines-herbes"), recette("pates-au-pesto")];
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
  const planningComplet = planningAvec(...RECETTES.slice(0, 7));

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
    const liste = genererListeCourses(planningAvec(recette("omelette-aux-fines-herbes")));
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
      recette("pates-au-pesto"),
      recette("spaghetti-carbonara"),
      recette("salade-cesar-au-poulet")
    );
    const instantane = JSON.stringify(planning);
    genererListeCourses(planning);
    expect(JSON.stringify(planning)).toBe(instantane);
  });
});
