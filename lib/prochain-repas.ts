// lib/prochain-repas.ts
// Prochain repas ACTIF à cuisiner (#280) — cœur pur, même esprit que
// lib/cycles.ts (fonctions testables sans réseau). Destiné à /ce-soir : pour
// la personne qui cuisine sans avoir suivi la planification.

import { creneauActif } from "@/lib/generateur"
import { estRestes } from "@/lib/restes"
import { personnesDuSlot, PERSONNES_DEFAUT } from "@/lib/personnes"
import { semaineISO } from "@/lib/semaines"
import type { Jour, Planning, Recette, ReglagesGeneration } from "@/types"

export type TypeRepas = "dejeuner" | "diner"

const JOURS_ISO: Jour[] = [
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
]

function jourDeDate(date: Date): Jour {
  const iso = date.getDay() === 0 ? 7 : date.getDay()
  return JOURS_ISO[iso - 1]
}

function versISO(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const j = String(d.getDate()).padStart(2, "0")
  return `${a}-${m}-${j}`
}

function depuisISO(dateISO: string): Date {
  const [a, m, j] = dateISO.split("-").map(Number)
  return new Date(a, m - 1, j)
}

/** Seuil horaire (#280, D2) : avant, le déjeuner du jour est visé ; après, le dîner. */
const SEUIL_HEURE_DINER = 15

/** Libellé générique du moment actuel (#suite #279/#280) — même seuil que
 *  prochainRepasActif, réutilisé partout où on n'a pas de date de repas
 *  précise (nav, état vide de /ce-soir). */
export function libelleMomentActuel(maintenant: Date): "Ce midi" | "Ce soir" {
  return maintenant.getHours() < SEUIL_HEURE_DINER ? "Ce midi" : "Ce soir"
}

export type ProchainRepas = {
  dateISO: string
  jour: Jour
  typeRepas: TypeRepas
  recette: Recette | undefined
  restes: boolean
  personnes: number
}

/**
 * Premier créneau ACTIF (#217) à partir de `maintenant` — avance créneau par
 * créneau (déjeuner → dîner → lendemain…), saute UNIQUEMENT les créneaux
 * désactivés (`creneauActif`). S'arrête au premier actif rencontré, qu'il ait
 * une recette ou non (D4) : ne distingue PAS « jamais généré pour ce jour »
 * de « aucun planning du tout » — les deux rendent `recette: undefined`,
 * affichés identiquement par l'appelant.
 * `maxJours` (défaut 14) est un filet théorique : RG-47 garantit qu'au moins
 * un créneau du motif hebdomadaire est actif, donc la boucle s'arrête presque
 * toujours dans les 7 premiers jours.
 */
export function prochainRepasActif(
  maintenant: Date,
  planningsParSemaine: Map<string, Planning>,
  reglages: ReglagesGeneration,
  maxJours = 14
): ProchainRepas | null {
  let date = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  let typeRepas: TypeRepas = maintenant.getHours() < SEUIL_HEURE_DINER ? "dejeuner" : "diner"

  for (let i = 0; i < maxJours * 2; i++) {
    const jour = jourDeDate(date)
    if (creneauActif(jour, typeRepas, reglages)) {
      const jp = planningsParSemaine.get(semaineISO(date))?.jours.find((j) => j.jour === jour)
      const recette = jp ? (typeRepas === "dejeuner" ? jp.dejeuner : jp.diner) : undefined
      return {
        dateISO: versISO(date),
        jour,
        typeRepas,
        recette,
        restes: jp ? estRestes(jp, typeRepas) : false,
        personnes: jp ? personnesDuSlot(jp, typeRepas) : PERSONNES_DEFAUT,
      }
    }
    if (typeRepas === "dejeuner") {
      typeRepas = "diner"
    } else {
      typeRepas = "dejeuner"
      date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    }
  }
  return null
}

/**
 * Libellé de contexte affiché au-dessus du repas (#280, D3) — « Dîner de ce
 * soir », « Déjeuner de demain », ou une date complète au-delà.
 */
export function libelleContexteRepas(
  dateISO: string,
  typeRepas: TypeRepas,
  maintenant: Date
): string {
  const cible = depuisISO(dateISO)
  const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  const diffJours = Math.round((cible.getTime() - aujourdhui.getTime()) / 86_400_000)
  const nomRepas = typeRepas === "dejeuner" ? "Déjeuner" : "Dîner"
  if (diffJours === 0) return `${nomRepas} de ${typeRepas === "diner" ? "ce soir" : "ce midi"}`
  if (diffJours === 1) return `${nomRepas} de demain`
  const libelleDate = cible.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return `${nomRepas} du ${libelleDate}`
}
