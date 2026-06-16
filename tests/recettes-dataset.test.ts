// Validation structurelle du vrai dataset — data/recettes.json (issue #29).
//
// Les tests de logique métier (lib/*.test.ts) tournent sur des fixtures
// figées : ce fichier est le seul à lire le dataset réel. Il vérifie la
// FORME des données (ids uniques, enums valides, quantités positives) et
// leur compatibilité avec le générateur — jamais leur CONTENU précis,
// pour que les recettes puissent évoluer sans casser de test.

import { describe, test, expect } from "vitest";
import { genererPlanning } from "@/lib/generateur";
import { suggererAccompagnement } from "@/lib/accompagnement";
import { estDeSaison, SAISONS, suggererSaisons } from "@/lib/saisons";
import recettesJson from "@/data/recettes.json";
import type {
  Accompagnement,
  CategorieIngredient,
  Recette,
  Saison,
  TempsPreparation,
  Unite,
} from "@/types";

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

  test("le vivier permet de générer une semaine (14 slots, RG-01)", () => {
    // Garde-fou métier minimal (RG-01) : assez de recettes au total (14 slots),
    // dont assez de rapides/normales pour les 10 slots de semaine, dont assez
    // de rapides pour les 5 dîners de semaine.
    const rapides = RECETTES.filter((r) => r.tempsPreparation === "rapide");
    const rapidesNormales = RECETTES.filter((r) => r.tempsPreparation !== "long");
    expect(RECETTES.length).toBeGreaterThanOrEqual(14);
    expect(rapidesNormales.length).toBeGreaterThanOrEqual(10);
    expect(rapides.length).toBeGreaterThanOrEqual(5);
    expect(() => genererPlanning(RECETTES)).not.toThrow();
  });

  // #49 — l'heuristique d'accompagnement (qui auto-tague le catalogue global via
  // la migration) doit produire une valeur valide (ou null) sur chaque recette,
  // et caractériser une nette majorité du dataset (garde-fou si les recettes
  // évoluent : un effondrement de la couverture signalerait une régression des
  // motifs). On ne fige PAS la valeur précise par recette — elle peut évoluer.
  test("l'heuristique d'accompagnement couvre l'essentiel du dataset (#49)", () => {
    const VALEURS: Accompagnement[] = ["feculents", "legumes"];
    let caracterisees = 0;
    for (const r of RECETTES) {
      const a = suggererAccompagnement(r.ingredients);
      if (a !== null) {
        expect(VALEURS, `accompagnement invalide : ${r.id}`).toContain(a);
        caracterisees++;
      }
    }
    // Au moins 70 % des recettes sont caractérisées (féculent ou légume).
    expect(caracterisees).toBeGreaterThanOrEqual(Math.ceil(RECETTES.length * 0.7));
  });

  // #23 — l'heuristique de saison (qui auto-tague le catalogue global via la
  // migration) doit produire des saisons valides, et — c'est le point critique
  // pour le filtre dur (avec dégradation) — laisser CHAQUE saison capable de
  // remplir une semaine sans dégradation. On ne fige PAS les saisons par recette.
  test("l'heuristique de saison laisse chaque saison générable (#23)", () => {
    for (const r of RECETTES) {
      for (const s of suggererSaisons(r.ingredients)) {
        expect(SAISONS, `saison invalide : ${r.id}`).toContain(s);
      }
    }
    // Pour chaque saison, les recettes de saison (saison incluse OU toute-année)
    // doivent permettre une génération sans lever (vivier suffisant).
    for (const saison of SAISONS) {
      const deSaison = RECETTES.filter((r) => {
        const tags = suggererSaisons(r.ingredients) as Saison[];
        return estDeSaison({ saisons: tags }, saison);
      });
      expect(
        () => genererPlanning(deSaison),
        `vivier insuffisant en ${saison}`
      ).not.toThrow();
    }
  });

  // #172 — jumeau JS/SQL de l'heuristique d'accompagnement. La migration
  // auto-tague le catalogue global en désaccentuant par
  // `translate(lower(nom), 'àâäéèêëïîôöùûüç', 'aaaeeeeiioouuuc')`, tandis que le
  // JS (lib/accompagnement.ts) désaccentue par NFD (qui couvre TOUS les accents).
  // Pour que les deux taguent IDENTIQUEMENT, aucun nom d'ingrédient ne doit
  // porter un accent décomposable hors de l'ensemble couvert par le SQL (ex. á,
  // í — non français). Ce test verrouille le contrat sur le catalogue réel.
  test("désaccentuation JS (NFD) == SQL (translate) sur chaque nom d'ingrédient (#172)", () => {
    const ACCENTS_SQL = "àâäéèêëïîôöùûüç";
    const CIBLE_SQL = "aaaeeeeiioouuuc";
    const translateSQL = (nom: string): string =>
      [...nom.toLowerCase()]
        .map((c) => {
          const i = ACCENTS_SQL.indexOf(c);
          return i >= 0 ? CIBLE_SQL[i] : c;
        })
        .join("");
    const normaliserJS = (nom: string): string =>
      nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    for (const r of RECETTES) {
      for (const ing of r.ingredients) {
        expect(
          translateSQL(ing.nom),
          `divergence twin JS/SQL sur l'ingrédient « ${ing.nom} » (${r.id})`
        ).toBe(normaliserJS(ing.nom));
      }
    }
  });
});
