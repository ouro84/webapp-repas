// Signature comparable d'un planning — logique PURE (#56 PR5, US-21).
//
// Sert à décider, après un re-pull déclenché par un event temps réel sur la
// table `planning`, si le contenu a RÉELLEMENT changé (modif d'un autre membre)
// ou si c'est l'écho de notre propre écriture / un no-op. Comparer les blobs
// JSON bruts serait fragile : l'ordre des clés diffère selon l'origine (planning
// issu de la génération vs reconstruit depuis la base). On extrait donc une
// empreinte stable et ordonnée des slots (recette, personnes, restes par
// créneau), insensible à l'ordre des clés et des jours.

import type { Planning } from "@/types"
import { personnesDuSlot } from "@/lib/personnes"

/**
 * Empreinte stable d'un planning : par jour et par créneau, l'id de recette, le
 * nombre de personnes et le flag restes. Triée → deux plannings au même contenu
 * (quel que soit l'ordre interne) ont la même signature ; toute modif de slot
 * (recette, personnes, restes) la change. `null` → chaîne vide.
 *
 * Personnes et restes sont lus avec leur défaut (2, RG-16 ; faux, RG-22) : le
 * générateur pose `personnes: 2` explicitement (#45) alors que la relecture de
 * la base l'omet (`dbSlotToJourPlanning`). Sans ce défaut, la relecture qui suit
 * une génération « changeait » le planning et déclenchait l'alerte US-21 sur sa
 * propre écriture (#352).
 */
export function signaturePlanning(planning: Planning | null): string {
  if (planning === null) return ""
  return planning.jours
    .map((jp) => {
      const dej = jp.dejeuner
      const din = jp.diner
      return [
        jp.jour,
        dej?.id ?? "",
        din?.id ?? "",
        personnesDuSlot(jp, "dejeuner"),
        personnesDuSlot(jp, "diner"),
        jp.restes?.dejeuner ? "1" : "0",
        jp.restes?.diner ? "1" : "0",
      ].join("|")
    })
    .sort()
    .join(";")
}
