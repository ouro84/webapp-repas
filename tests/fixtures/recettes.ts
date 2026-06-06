// Fixtures de recettes — réservées aux tests (Vitest et Playwright).
//
// Pourquoi des fixtures plutôt que data/recettes.json (issue #29) :
// les tests étaient couplés au contenu du vrai dataset (ids précis,
// paires d'unités, proportions rapide/normal/long). Chaque mise à jour
// des recettes réelles cassait des tests sans qu'aucune logique ait
// changé. Ce jeu figé garantit des assertions déterministes, quel que
// soit le contenu de data/recettes.json.
//
// Composition voulue — NE PAS MODIFIER sans relire les tests :
//   - 15 recettes : 12 rapides/normales puis 3 longues (en fin de tableau).
//     lib/generateur.test.ts dépend de ces comptages (viviers de 9 = 6 + 3).
//   - parmesan en "g" dans les 3 premières recettes (agrégation RG-05).
//   - crème fraîche en "cas" (gratin-de-courgettes) ET en "briquette"
//     (quiche-aux-lardons) : lignes séparées si unités différentes.
//   - sel en "cac" fondDePlacard dans plusieurs recettes (agrégation
//     de la section fond de placard).
//   - les 7 premières recettes couvrent viandes-poissons, legumes-fruits,
//     produits-frais, epicerie, boulangerie et surgeles (tri RG-05).

import type { Recette } from "../../types";

export const RECETTES_FIXTURES: Recette[] = [
  {
    id: "tagliatelles-au-parmesan",
    nom: "Tagliatelles au parmesan",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "tagliatelles", quantite: 300, unite: "g", categorie: "epicerie", fondDePlacard: false },
      { nom: "parmesan", quantite: 50, unite: "g", categorie: "produits-frais", fondDePlacard: false },
      { nom: "huile d'olive", quantite: 1, unite: "cas", categorie: "epicerie", fondDePlacard: true },
      { nom: "sel", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true },
    ],
  },
  {
    id: "risotto-au-parmesan",
    nom: "Risotto au parmesan",
    tempsPreparation: "normal",
    ingredients: [
      { nom: "riz arborio", quantite: 200, unite: "g", categorie: "epicerie", fondDePlacard: false },
      { nom: "parmesan", quantite: 40, unite: "g", categorie: "produits-frais", fondDePlacard: false },
      { nom: "bouillon de volaille", quantite: 1, unite: "piece", categorie: "epicerie", fondDePlacard: true },
      { nom: "oignon", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: true },
    ],
  },
  {
    id: "gratin-de-courgettes",
    nom: "Gratin de courgettes",
    tempsPreparation: "normal",
    ingredients: [
      { nom: "courgette", quantite: 3, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "parmesan", quantite: 30, unite: "g", categorie: "produits-frais", fondDePlacard: false },
      { nom: "crème fraîche", quantite: 2, unite: "cas", categorie: "produits-frais", fondDePlacard: false },
      { nom: "sel", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true },
    ],
  },
  {
    id: "quiche-aux-lardons",
    nom: "Quiche aux lardons",
    tempsPreparation: "normal",
    ingredients: [
      { nom: "pâte brisée", quantite: 1, unite: "piece", categorie: "produits-frais", fondDePlacard: false },
      { nom: "lardons", quantite: 200, unite: "g", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "crème fraîche", quantite: 1, unite: "briquette", categorie: "produits-frais", fondDePlacard: false },
      { nom: "oeufs", quantite: 3, unite: "piece", categorie: "produits-frais", fondDePlacard: false },
    ],
  },
  {
    id: "omelette-aux-champignons",
    nom: "Omelette aux champignons",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "oeufs", quantite: 6, unite: "piece", categorie: "produits-frais", fondDePlacard: false },
      { nom: "champignons de Paris", quantite: 250, unite: "g", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "beurre", quantite: 20, unite: "g", categorie: "produits-frais", fondDePlacard: true },
      { nom: "poivre", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true },
    ],
  },
  {
    id: "salade-de-chevre-chaud",
    nom: "Salade de chèvre chaud",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "salade verte", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "crottin de chèvre", quantite: 2, unite: "piece", categorie: "produits-frais", fondDePlacard: false },
      { nom: "pain de campagne", quantite: 4, unite: "piece", categorie: "boulangerie", fondDePlacard: false },
      { nom: "miel", quantite: 1, unite: "cas", categorie: "epicerie", fondDePlacard: true },
    ],
  },
  {
    id: "poisson-pane-haricots",
    nom: "Poisson pané et haricots verts",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "poisson pané surgelé", quantite: 4, unite: "piece", categorie: "surgeles", fondDePlacard: false },
      { nom: "haricots verts", quantite: 400, unite: "g", categorie: "surgeles", fondDePlacard: false },
      { nom: "citron", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
    ],
  },
  {
    id: "soupe-de-legumes",
    nom: "Soupe de légumes",
    tempsPreparation: "normal",
    ingredients: [
      { nom: "carottes", quantite: 4, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "poireau", quantite: 2, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "pommes de terre", quantite: 3, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "sel", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true },
    ],
  },
  {
    id: "steak-hache-puree",
    nom: "Steak haché purée",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "steak haché", quantite: 2, unite: "piece", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "pommes de terre", quantite: 600, unite: "g", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "lait", quantite: 100, unite: "ml", categorie: "produits-frais", fondDePlacard: true },
      { nom: "beurre", quantite: 30, unite: "g", categorie: "produits-frais", fondDePlacard: true },
    ],
  },
  {
    id: "wrap-au-poulet",
    nom: "Wrap au poulet",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "tortillas", quantite: 4, unite: "piece", categorie: "epicerie", fondDePlacard: false },
      { nom: "blanc de poulet", quantite: 2, unite: "piece", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "salade verte", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
    ],
  },
  {
    id: "curry-de-pois-chiches",
    nom: "Curry de pois chiches",
    tempsPreparation: "normal",
    ingredients: [
      { nom: "pois chiches", quantite: 1, unite: "boite", categorie: "epicerie", fondDePlacard: false },
      { nom: "lait de coco", quantite: 200, unite: "ml", categorie: "epicerie", fondDePlacard: false },
      { nom: "pâte de curry", quantite: 2, unite: "cac", categorie: "epicerie", fondDePlacard: false },
    ],
  },
  {
    id: "croque-monsieur",
    nom: "Croque-monsieur",
    tempsPreparation: "rapide",
    ingredients: [
      { nom: "pain de mie", quantite: 8, unite: "piece", categorie: "boulangerie", fondDePlacard: false },
      { nom: "jambon blanc", quantite: 4, unite: "piece", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "emmental râpé", quantite: 100, unite: "g", categorie: "produits-frais", fondDePlacard: false },
    ],
  },
  // --- Les 3 recettes longues, en fin de tableau (cf. comptages en tête) ---
  {
    id: "boeuf-bourguignon",
    nom: "Bœuf bourguignon",
    tempsPreparation: "long",
    ingredients: [
      { nom: "boeuf à mijoter", quantite: 800, unite: "g", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "carottes", quantite: 3, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "vin rouge", quantite: 1, unite: "bouteille", categorie: "epicerie", fondDePlacard: false },
      { nom: "oignon", quantite: 2, unite: "piece", categorie: "legumes-fruits", fondDePlacard: true },
    ],
  },
  {
    id: "lasagnes-maison",
    nom: "Lasagnes maison",
    tempsPreparation: "long",
    ingredients: [
      { nom: "viande hachée", quantite: 400, unite: "g", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "feuilles de lasagne", quantite: 1, unite: "boite", categorie: "epicerie", fondDePlacard: false },
      { nom: "parmesan", quantite: 60, unite: "g", categorie: "produits-frais", fondDePlacard: false },
      { nom: "lait", quantite: 500, unite: "ml", categorie: "produits-frais", fondDePlacard: true },
    ],
  },
  {
    id: "poulet-roti-du-dimanche",
    nom: "Poulet rôti du dimanche",
    tempsPreparation: "long",
    ingredients: [
      { nom: "poulet entier", quantite: 1, unite: "piece", categorie: "viandes-poissons", fondDePlacard: false },
      { nom: "pommes de terre", quantite: 1, unite: "kg", categorie: "legumes-fruits", fondDePlacard: false },
      { nom: "herbes de Provence", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true },
    ],
  },
];

// Fixture par id — échoue bruyamment si la fixture demandée n'existe pas
// (erreur de test, pas de dataset : les fixtures ne bougent jamais seules).
export function recetteFixture(id: string): Recette {
  const trouvee = RECETTES_FIXTURES.find((r) => r.id === id);
  if (!trouvee) throw new Error(`Fixture absente : ${id}`);
  return trouvee;
}
