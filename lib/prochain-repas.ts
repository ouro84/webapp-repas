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

export function jourDeDate(date: Date): Jour {
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
  const date = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  const typeRepas: TypeRepas = maintenant.getHours() < SEUIL_HEURE_DINER ? "dejeuner" : "diner"
  return repasActifDepuis(date, typeRepas, planningsParSemaine, reglages, maxJours)
}

/**
 * Repas actif qui SUIT `repas` (#336, aperçu « Ensuite ») — même parcours que
 * prochainRepasActif, en partant du créneau d'après (dîner du même jour ou
 * déjeuner du lendemain). L'appelant n'affiche l'aperçu que si ce créneau a
 * une recette.
 */
export function repasActifSuivant(
  repas: Pick<ProchainRepas, "dateISO" | "typeRepas">,
  planningsParSemaine: Map<string, Planning>,
  reglages: ReglagesGeneration,
  maxJours = 14
): ProchainRepas | null {
  const [date, typeRepas] = creneauSuivant(depuisISO(repas.dateISO), repas.typeRepas)
  return repasActifDepuis(date, typeRepas, planningsParSemaine, reglages, maxJours)
}

/** Semaine ISO du jour d'un repas — sert à distinguer « aucun planning pour
 *  cette semaine » (→ Générer) de « créneau vide d'un planning existant » (→ Voir). */
export function semaineDuRepas(repas: Pick<ProchainRepas, "dateISO">): string {
  return semaineISO(depuisISO(repas.dateISO))
}

function creneauSuivant(date: Date, typeRepas: TypeRepas): [Date, TypeRepas] {
  if (typeRepas === "dejeuner") return [date, "diner"]
  return [new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1), "dejeuner"]
}

function repasActifDepuis(
  depart: Date,
  typeDepart: TypeRepas,
  planningsParSemaine: Map<string, Planning>,
  reglages: ReglagesGeneration,
  maxJours: number
): ProchainRepas | null {
  let date = depart
  let typeRepas = typeDepart
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
    ;[date, typeRepas] = creneauSuivant(date, typeRepas)
  }
  return null
}

/**
 * Moment court d'un repas (#349, état « restes » de /ce-soir) : « Ce midi »,
 * « Ce soir », « Demain midi », « Demain soir », puis « Lundi soir » dans la
 * semaine qui vient, et « Lundi 16 novembre midi » au-delà.
 */
export function libelleMomentCourt(
  dateISO: string,
  typeRepas: TypeRepas,
  maintenant: Date
): string {
  const cible = depuisISO(dateISO)
  const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  const diffJours = Math.round((cible.getTime() - aujourdhui.getTime()) / 86_400_000)
  const moment = typeRepas === "dejeuner" ? "midi" : "soir"
  if (diffJours === 0) return typeRepas === "dejeuner" ? "Ce midi" : "Ce soir"
  if (diffJours === 1) return `Demain ${moment}`
  const options: Intl.DateTimeFormatOptions =
    diffJours < 7 ? { weekday: "long" } : { weekday: "long", day: "numeric", month: "long" }
  const jour = cible.toLocaleDateString("fr-FR", options)
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} ${moment}`
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
