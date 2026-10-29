// Nombre de personnes par repas — logique métier pure (sans UI)
//
// Implémente RG-16 (nombre par slot, défaut 2, bornes [1;12], conservation
// au remplacement, reset à la génération) et RG-17 (mise à l'échelle ×N/2
// + arrondi par type d'unité). Aucune dépendance React/navigateur.

import type { Ingredient, Jour, JourPlanning, Planning, Unite } from "@/types"

type TypeRepas = "diner" | "dejeuner"

// RG-16 — recettes données pour 2 personnes, réglage borné à [1;12].
export const PERSONNES_DEFAUT = 2
export const PERSONNES_MIN = 1
export const PERSONNES_MAX = 12

/** Nombre de personnes d'un slot — défaut 2 si non renseigné (RG-16). */
export function personnesDuSlot(
  jp: JourPlanning,
  typeRepas: TypeRepas
): number {
  return jp.personnes?.[typeRepas] ?? PERSONNES_DEFAUT
}

/** Contraint une valeur dans [PERSONNES_MIN ; PERSONNES_MAX]. */
function borner(valeur: number): number {
  return Math.min(PERSONNES_MAX, Math.max(PERSONNES_MIN, Math.trunc(valeur)))
}

/**
 * Modifie le nombre de personnes d'un slot (US-07). La valeur est bornée
 * (RG-16). Retourne un nouveau planning sans muter l'argument ; les jours
 * non concernés sont réutilisés tels quels.
 *
 * @returns le nouveau planning, ou `null` si le slot ciblé n'existe pas
 *          (ex: déjeuner en semaine) — impossible depuis l'UI.
 */
export function modifierPersonnes(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  personnes: number
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null

  const slot = typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!slot) return null // aucun repas sur ce slot (ex: déjeuner lun→ven)

  const valeur = borner(personnes)

  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return {
      ...jp,
      personnes: { ...jp.personnes, [typeRepas]: valeur },
    }
  })

  return { semaine: planning.semaine, jours }
}

// ---------------------------------------------------------------------------
// RG-17 — mise à l'échelle et arrondi des quantités
// ---------------------------------------------------------------------------

// Unités comptables : on ne peut pas acheter un demi-œuf → entier supérieur.
const UNITES_COMPTABLES: ReadonlySet<Unite> = new Set([
  "piece",
  "briquette",
  "bouteille",
  "boite",
  "sachet",
  "autre",
])
// Mesures fines : le gramme/ml près suffit → entier le plus proche.
const UNITES_FINES: ReadonlySet<Unite> = new Set(["g", "ml", "cl"])
// Grosses mesures : 1 décimale (1,3 kg). Cuillères : au 0,5 près.
const UNITES_DECIMALE: ReadonlySet<Unite> = new Set(["kg", "l"])
const UNITES_DEMI: ReadonlySet<Unite> = new Set(["cas", "cac"])

/** Facteur d'échelle d'un slot : N personnes pour une recette prévue pour 2. */
export function facteurEchelle(personnes: number): number {
  return personnes / PERSONNES_DEFAUT
}

/**
 * Arrondit une quantité agrégée selon son unité (RG-17). À appliquer APRÈS
 * agrégation pour ne pas cumuler les erreurs d'arrondi entre repas.
 */
export function arrondirQuantite(quantite: number, unite: Unite): number {
  if (UNITES_COMPTABLES.has(unite)) return Math.ceil(quantite)
  if (UNITES_FINES.has(unite)) return Math.round(quantite)
  if (UNITES_DECIMALE.has(unite)) return Math.round(quantite * 10) / 10
  if (UNITES_DEMI.has(unite)) return Math.round(quantite * 2) / 2
  return Math.ceil(quantite) // sécurité : toute unité non classée
}

/**
 * Ingrédients d'une recette à l'échelle d'un repas (RG-17, RG-20) : ×N/2 puis
 * arrondi par unité, comme la liste de courses. Source unique de la fiche
 * recette et de l'outil MCP `lire_recette` (#305, RG-78). Sans mutation.
 */
export function ingredientsAEchelle(ingredients: Ingredient[], personnes: number): Ingredient[] {
  const facteur = facteurEchelle(personnes)
  return ingredients.map((i) => ({
    ...i,
    quantite: arrondirQuantite(i.quantite * facteur, i.unite),
  }))
}
