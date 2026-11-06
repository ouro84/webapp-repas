// Édition d'un slot de planning — calcul pur partagé par les vues Semaine et
// Cycle (chantier 06). Aucune dépendance à React, au navigateur ou à Supabase.
//
// Une édition (changer, sélectionner, nombre de personnes, restes) est un calcul
// sur un `Planning` : fonction métier, recherche de l'ancien et du nouveau
// `JourPlanning`, avertissements dérivés. Chaque vue garde ce qui lui est
// propre : persistance, undo, garde RG-24 (semaine passée), toasts.

import {
  joursSansLegume,
  prefereVegeSlot,
  remplacerSlot,
  remplacerSlotManuel,
  reposNonSaison,
  type PreferencesRecettes,
  type TypeRepas,
} from "@/lib/generateur"
import { modifierPersonnes } from "@/lib/personnes"
import { marquerRestes } from "@/lib/restes"
import type {
  Jour,
  JourPlanning,
  Planning,
  Recette,
  ReglagesGeneration,
} from "@/types"

/**
 * Action d'édition d'un slot.
 * - `changer` (US-04, RG-04) : remplacement aléatoire éligible ; `random` est
 *   injectable pour des tests déterministes (#157), défaut `Math.random`.
 * - `selectionner` (US-06, RG-15) : recette choisie par l'utilisateur.
 * - `personnes` (US-07, RG-16) : nombre de personnes du slot.
 * - `restes` (US-12, RG-22) : marque / démarque « restes ».
 */
export type ActionSlot =
  | {
      type: "changer"
      recettes: Recette[]
      reglages: ReglagesGeneration
      preferences: PreferencesRecettes
      random?: () => number
    }
  | { type: "selectionner"; recette: Recette }
  | { type: "personnes"; personnes: number }
  | { type: "restes"; valeur: boolean }

/** Préférence souple non honorée après un `changer` (RG-26, RG-27, RG-28). */
export type Avertissement = "vege" | "legume" | "saison"

export type ResultatEdition =
  | {
      ok: true
      planning: Planning
      precedent: JourPlanning
      jour: JourPlanning
      avertissements: Avertissement[]
    }
  | { ok: false; motif: "indisponible" | "slot-absent" }

// Textes affichés par les vues (toasts) : source unique.
export const MESSAGES_EDITION = {
  remplacee: "Recette remplacée",
  indisponible: "Pas de recette disponible",
  restes: (valeur: boolean): string =>
    valeur ? "Repas marqué « Restes »" : "Repas à cuisiner",
  avertissements: {
    vege: "Pas de recette végétarienne disponible pour ce repas.",
    legume:
      "Ce jour n’a pas de repas « légumes » " +
      "(pas assez de recettes légumes).",
    saison: "Ce repas est hors saison (pas assez de recettes de saison).",
  } satisfies Record<Avertissement, string>,
}

// Avertissements d'un remplacement aléatoire, dans l'ordre d'affichage :
// végé (RG-26), légume (RG-27), saison (RG-28). Calculés depuis le planning
// final, sans bloquer le remplacement.
// Exporté : l'outil MCP `remplacer_repas` réutilise la même règle.
export function avertissementsRemplacement(
  nouveau: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): Avertissement[] {
  const avertissements: Avertissement[] = []
  const jourNouveau = nouveau.jours.find((jp) => jp.jour === jour)
  const remplacante =
    typeRepas === "diner" ? jourNouveau?.diner : jourNouveau?.dejeuner
  if (
    prefereVegeSlot(jour, typeRepas, reglages) &&
    remplacante?.vegetarien !== true
  ) {
    avertissements.push("vege")
  }
  if (joursSansLegume(nouveau, reglages).includes(jour)) {
    avertissements.push("legume")
  }
  if (
    reposNonSaison(nouveau, reglages).some(
      (s) => s.jour === jour && s.typeRepas === typeRepas
    )
  ) {
    avertissements.push("saison")
  }
  return avertissements
}

/**
 * Calcule l'édition d'un slot sans muter le planning passé.
 *
 * Refus typés : `slot-absent` si le jour manque au planning (toutes actions) ou
 * si le repas ciblé n'existe pas (sélection, personnes, restes) — cas impossible
 * depuis l'UI ; `indisponible` si `changer` ne trouve aucune recette éligible
 * (RG-04), y compris sur un repas absent d'un jour présent.
 */
export function editerSlot(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  action: ActionSlot
): ResultatEdition {
  const precedent = planning.jours.find((jp) => jp.jour === jour)
  if (precedent === undefined) return { ok: false, motif: "slot-absent" }

  let nouveau: Planning | null
  switch (action.type) {
    case "changer":
      nouveau = remplacerSlot(
        planning,
        jour,
        typeRepas,
        action.recettes,
        action.reglages,
        action.random,
        action.preferences
      )
      if (nouveau === null) return { ok: false, motif: "indisponible" }
      break
    case "selectionner":
      nouveau = remplacerSlotManuel(planning, jour, typeRepas, action.recette)
      break
    case "personnes":
      nouveau = modifierPersonnes(planning, jour, typeRepas, action.personnes)
      break
    case "restes":
      nouveau = marquerRestes(planning, jour, typeRepas, action.valeur)
      break
  }
  if (nouveau === null) return { ok: false, motif: "slot-absent" }

  const jourNouveau = nouveau.jours.find((jp) => jp.jour === jour)
  if (jourNouveau === undefined) return { ok: false, motif: "slot-absent" }

  return {
    ok: true,
    planning: nouveau,
    precedent,
    jour: jourNouveau,
    avertissements:
      action.type === "changer"
        ? avertissementsRemplacement(nouveau, jour, typeRepas, action.reglages)
        : [],
  }
}
