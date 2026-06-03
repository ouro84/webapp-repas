// Adaptateurs — conversion des types base de données vers les types domaine
//
// Supabase retourne des données en snake_case avec des relations imbriquées.
// La logique métier (generateur.ts, courses.ts) travaille avec des types domaine
// en camelCase, plus simples à manipuler.
//
// Ces fonctions font le pont entre les deux.

import type {
  DbRecette,
  DbPlanningSlot,
  Recette,
  Ingredient,
  JourPlanning,
} from "@/types"

export function dbIngredientToDomain(
  ri: DbRecette["recette_ingredient"][number]
): Ingredient {
  return {
    nom: ri.ingredient.nom,
    quantite: ri.quantite,
    unite: ri.unite,
    categorie: ri.ingredient.categorie,
    fondDePlacard: ri.ingredient.fond_de_placard,
  }
}

export function dbRecetteToDomain(dbRecette: DbRecette): Recette {
  return {
    id: dbRecette.id,
    nom: dbRecette.nom,
    tempsPreparation: dbRecette.temps_preparation,
    ingredients: dbRecette.recette_ingredient.map(dbIngredientToDomain),
  }
}

export function dbSlotToJourPlanning(
  slots: DbPlanningSlot[],
  jour: DbPlanningSlot["jour"]
): JourPlanning {
  const slotsJour = slots.filter((s) => s.jour === jour)
  const diner = slotsJour.find((s) => s.type_repas === "diner")
  const dejeuner = slotsJour.find((s) => s.type_repas === "dejeuner")

  if (!diner) {
    throw new Error(`Slot dîner manquant pour le jour : ${jour}`)
  }

  return {
    jour,
    diner: dbRecetteToDomain(diner.recette),
    ...(dejeuner ? { dejeuner: dbRecetteToDomain(dejeuner.recette) } : {}),
  }
}
