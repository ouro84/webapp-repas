// Adaptateurs — conversion des types base de données vers les types domaine
//
// Supabase retourne des données en snake_case avec des relations imbriquées.
// La logique métier (generateur.ts, courses.ts) travaille avec des types domaine
// en camelCase, plus simples à manipuler.
//
// Ces fonctions font le pont entre les deux.

import type {
  ArticleManuel,
  DbArticleManuel,
  DbRecette,
  DbPlanningSlot,
  Recette,
  Ingredient,
  Jour,
  JourPlanning,
  Planning,
} from "@/types"

// Ordre canonique des jours (section 5.5).
const ORDRE_JOURS: Jour[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
]

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
  const recette: Recette = {
    id: dbRecette.id,
    nom: dbRecette.nom,
    tempsPreparation: dbRecette.temps_preparation,
    vegetarien: dbRecette.vegetarien,
    ingredients: dbRecette.recette_ingredient.map(dbIngredientToDomain),
  }
  // Accompagnement (#49) : `null` en base = non caractérisé → champ absent côté
  // domaine (cohérent avec l'optionnalité de Recette.accompagnement).
  if (dbRecette.accompagnement) recette.accompagnement = dbRecette.accompagnement
  // Saisons (#23) : `null`/vide en base = toute l'année → champ absent côté
  // domaine (cohérent avec l'optionnalité de Recette.saisons).
  if (dbRecette.saisons && dbRecette.saisons.length > 0) {
    recette.saisons = dbRecette.saisons
  }
  // Étapes (#233) : `null`/vide en base = pas d'étapes → champ absent côté
  // domaine (cohérent avec l'optionnalité de Recette.etapes). ⚠️ #164 : ce
  // mapping doit être traversé par TOUS les selects qui hydratent une recette
  // (SELECT_RECETTE, SELECT_PLANNING, route de génération) sinon les étapes
  // disparaissent à la relecture d'un planning persisté.
  if (dbRecette.etapes && dbRecette.etapes.length > 0) {
    recette.etapes = dbRecette.etapes
  }
  return recette
}

export function dbSlotToJourPlanning(
  slots: DbPlanningSlot[],
  jour: DbPlanningSlot["jour"]
): JourPlanning {
  const slotsJour = slots.filter((s) => s.jour === jour)
  const diner = slotsJour.find((s) => s.type_repas === "diner")
  const dejeuner = slotsJour.find((s) => s.type_repas === "dejeuner")

  // Un slot absent (dîner OU déjeuner) signifie que son créneau est désactivé
  // (#217, RG-44/46) — ce n'est plus une anomalie à rejeter, comme c'était
  // déjà le cas pour le déjeuner (plannings antérieurs à 14 repas, #3).
  const jp: JourPlanning = { jour }
  if (diner) jp.diner = dbRecetteToDomain(diner.recette)
  if (dejeuner) jp.dejeuner = dbRecetteToDomain(dejeuner.recette)

  // personnes / restes : on n'attache que les valeurs non-défaut, pour produire
  // un objet domaine minimal identique à la sortie du générateur (défaut 2 /
  // false géré côté lecture, US-07/US-12).
  const personnes: { dejeuner?: number; diner?: number } = {}
  if (diner && diner.personnes !== 2) personnes.diner = diner.personnes
  if (dejeuner && dejeuner.personnes !== 2) personnes.dejeuner = dejeuner.personnes
  if (personnes.diner !== undefined || personnes.dejeuner !== undefined) {
    jp.personnes = personnes
  }

  const restes: { dejeuner?: boolean; diner?: boolean } = {}
  if (diner?.restes) restes.diner = true
  if (dejeuner?.restes) restes.dejeuner = true
  if (restes.diner || restes.dejeuner) jp.restes = restes

  return jp
}

// Article manuel (#216) : conversion directe, sans logique — categorie/unite
// sont typées `text` côté DB (pas d'enum Postgres) mais correspondent aux
// unions du domaine par convention de saisie côté client (formulaire).
export function dbArticleManuelToDomain(db: DbArticleManuel): ArticleManuel {
  return {
    id: db.id,
    libelle: db.libelle,
    quantite: db.quantite,
    unite: db.unite,
    categorie: db.categorie,
    fondDePlacard: db.fond_de_placard,
    coche: db.coche,
  }
}

// Reconstruit un planning domaine complet depuis sa semaine et ses slots DB.
// Garde tout jour pourvu d'AU MOINS un slot (déjeuner OU dîner) — un créneau
// peut être désactivé (#217, RG-44/46) sans que l'autre le soit.
export function dbPlanningToDomain(
  semaine: string,
  slots: DbPlanningSlot[]
): Planning {
  const jours: JourPlanning[] = ORDRE_JOURS.filter((jour) =>
    slots.some((s) => s.jour === jour)
  ).map((jour) => dbSlotToJourPlanning(slots, jour))
  return { semaine, jours }
}
