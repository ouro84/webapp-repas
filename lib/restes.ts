// Repas en « restes » — logique métier pure (sans UI).
//
// Implémente RG-22 (US-12) : un slot marqué « restes » n'est pas cuisiné et
// est exclu de la liste de courses. Flag par slot porté par le jour
// (JourPlanning.restes), parallèle au nombre de personnes (lib/personnes.ts).

import type { Jour, JourPlanning, Planning } from "@/types"

type TypeRepas = "diner" | "dejeuner"

/** Le slot est-il marqué « restes » ? (RG-22) */
export function estRestes(jp: JourPlanning, typeRepas: TypeRepas): boolean {
  return jp.restes?.[typeRepas] === true
}

/**
 * Marque (ou démarque) un slot comme « restes » (US-12). La recette
 * sous-jacente est conservée (démarquer la restitue, et l'annulation aussi).
 * Retourne un nouveau planning sans muter l'argument ; les jours non concernés
 * sont réutilisés tels quels.
 *
 * @returns le nouveau planning, ou `null` si le slot ciblé n'existe pas
 *          (planning antérieur sans ce repas) — impossible depuis l'UI.
 */
export function marquerRestes(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  valeur: boolean
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null

  const slot = typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!slot) return null // aucun repas sur ce slot

  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return {
      ...jp,
      restes: { ...jp.restes, [typeRepas]: valeur },
    }
  })

  return { semaine: planning.semaine, jours }
}
