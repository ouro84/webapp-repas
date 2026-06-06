// Validation structurelle du vrai dataset — data/recettes.json (issue #29).
//
// Les tests de logique métier (lib/*.test.ts) tournent sur des fixtures
// figées : ce fichier est le seul à lire le dataset réel. Il vérifie la
// FORME des données (ids uniques, enums valides, quantités positives) et
// leur compatibilité avec le générateur — jamais leur CONTENU précis,
// pour que les recettes puissent évoluer sans casser de test.

import { describe, test, expect } from "vitest";
import { genererPlanning } from "@/lib/generateur";
import recettesJson from "@/data/recettes.json";
import type { CategorieIngredient, Recette, TempsPreparation, Unite } from "@/types";

const RECETTES = recettesJson as Recette[];

const UNITES: Unite[] = [
  "g", "kg", "ml", "cl", "l", "piece", "briquette", "bouteille",
  "boite", "sachet", "cas", "cac", "autre",
];
const CATEGORIES: CategorieIngredient[] = [
  "viandes-poissons", "legumes-fruits", "produits-frais",
  "epicerie", "boulangerie", "surgeles", "autre",
];
const TEMPS: TempsPreparation[] = ["rapide", "normal", "long"];

describe("data/recettes.json — intégrité du dataset", () => {
  test("chaque recette a un id, un nom et au moins un ingrédient", () => {
    for (const r of RECETTES) {
      expect(r.id, `id manquant : ${r.nom}`).toBeTruthy();
      expect(r.nom, `nom manquant : ${r.id}`).toBeTruthy();
      expect(r.ingredients.length, `aucun ingrédient : ${r.id}`).toBeGreaterThan(0);
    }
  });

  test("les ids sont uniques", () => {
    const ids = RECETTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("les énumérations sont valides (temps, unités, catégories)", () => {
    for (const r of RECETTES) {
      expect(TEMPS, `tempsPreparation invalide : ${r.id}`).toContain(r.tempsPreparation);
      for (const i of r.ingredients) {
        expect(UNITES, `unité invalide : ${r.id} / ${i.nom}`).toContain(i.unite);
        expect(CATEGORIES, `catégorie invalide : ${r.id} / ${i.nom}`).toContain(i.categorie);
      }
    }
  });

  test("les quantités sont strictement positives", () => {
    for (const r of RECETTES) {
      for (const i of r.ingredients) {
        expect(i.quantite, `quantité invalide : ${r.id} / ${i.nom}`).toBeGreaterThan(0);
      }
    }
  });

  test("le vivier permet de générer un planning (RG-01 : 5 dîners de semaine)", () => {
    // Garde-fou métier minimal : assez de recettes au total (9 slots) et
    // assez de rapides/normales pour les 5 soirs de semaine.
    const rapidesNormales = RECETTES.filter((r) => r.tempsPreparation !== "long");
    expect(RECETTES.length).toBeGreaterThanOrEqual(9);
    expect(rapidesNormales.length).toBeGreaterThanOrEqual(5);
    expect(() => genererPlanning(RECETTES)).not.toThrow();
  });
});
