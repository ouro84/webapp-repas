// Lien vers une semaine du planning (#336, RG-89) : `/planning?semaine=AAAA-Wnn`
// ouvre la vue Semaine sur cette semaine plutôt que sur la semaine par défaut
// (la suivante le week-end). Sert à /ce-soir : « Voir dans le planning » et
// « Générer mon planning » doivent viser la semaine du repas affiché.
import { decalageEntre, semaineDecalee, semaineISO } from "@/lib/semaines"

export const PARAM_LIEN_SEMAINE = "semaine"

/** Chemin du planning ouvert sur `semaine`. */
export function lienPlanningSemaine(semaine: string): string {
  return `/planning?${PARAM_LIEN_SEMAINE}=${semaine}`
}

/**
 * La semaine du lien si elle est une semaine ISO réelle, dans la plage du
 * navigateur de semaines (`passees` en arrière, `futures` en avant de la
 * semaine courante) ; sinon `null` (lien ignoré sans message).
 */
export function lireLienSemaine(
  valeur: string | null,
  maintenant: Date,
  passees: number,
  futures: number
): string | null {
  if (valeur === null || !/^\d{4}-W\d{2}$/.test(valeur)) return null
  // Round-trip : rejette une semaine inexistante (ex. 2026-W60).
  if (semaineDecalee(valeur, 0) !== valeur) return null
  const decalage = decalageEntre(semaineISO(maintenant), valeur)
  return decalage >= -passees && decalage <= futures ? valeur : null
}
