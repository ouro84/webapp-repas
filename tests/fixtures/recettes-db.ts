// Fixtures de recettes au FORMAT BASE (lignes du select `SELECT_RECETTE`) —
// pour les tests des fonctions à client Supabase injecté (#304), qui lisent la
// table `recette` puis convertissent via dbRecetteToDomain.
//
// Dérivées de RECETTES_FIXTURES (même composition : 7 rapides, 5 normales,
// 3 longues) pour ne pas maintenir deux jeux.

import { RECETTES_FIXTURES } from "./recettes"

export const RECETTES_FIXTURES_DB = RECETTES_FIXTURES.map((r) => ({
  id: r.id,
  nom: r.nom,
  temps_preparation: r.tempsPreparation,
  vegetarien: r.vegetarien ?? null,
  accompagnement: r.accompagnement ?? null,
  saisons: r.saisons ?? null,
  etapes: r.etapes ?? null,
  recette_ingredient: r.ingredients.map((i) => ({
    quantite: i.quantite,
    unite: i.unite,
    ingredient: {
      nom: i.nom,
      categorie: i.categorie,
      fond_de_placard: i.fondDePlacard,
    },
  })),
}))
