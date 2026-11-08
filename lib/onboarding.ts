// lib/onboarding.ts
// Logique PURE du tunnel /bienvenue recalé sur le cycle de courses (#386, US-23,
// RG-90, RG-91). La page (app/bienvenue/page.tsx) orchestre ; ici : réglages
// initiaux, filtre des jours déjà passés, cycle du premier planning, URL de fin.
// Aucun import client Supabase : testable sans navigateur ni réseau.

import { ancreParDefaut, LONGUEUR_DEFAUT } from "@/lib/cycles"
import { versISO } from "@/lib/dates-iso"
import { ORDRE_JOURS } from "@/lib/generateur"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import { lundiDeSemaine } from "@/lib/semaines"
import type { ReglagesGeneration, SemaineGeneree } from "@/types"

// Jour de courses proposé au premier planning : samedi (ISO 6).
export const JOUR_COURSES_PROPOSE = 6

// Paramètre d'URL signalant l'arrivée depuis l'onboarding (/planning?bienvenue=1).
export const PARAM_BIENVENUE = "bienvenue"

export type SaisieOnboarding = {
  personnes: number
  vege: boolean
  midiSemaine: boolean
}

/**
 * Réglages initiaux saisis dans le tunnel : nombre de personnes, préférence
 * végétarienne limitée à la SEMAINE, et déjeuner de semaine désactivable
 * (plafond « aucun », RG-44).
 */
export function reglagesInitiaux(saisie: SaisieOnboarding): ReglagesGeneration {
  return {
    ...REGLAGES_DEFAUT,
    personnesDefaut: saisie.personnes,
    plafonds: {
      ...REGLAGES_DEFAUT.plafonds,
      ...(saisie.midiSemaine ? {} : { dejeunerSemaine: "aucun" as const }),
    },
    ...(saisie.vege
      ? {
          vegetarienPrefere: {
            dejeunerSemaine: true,
            dinerSemaine: true,
            dejeunerWeekend: false,
            dinerWeekend: false,
          },
        }
      : {}),
  }
}

/** Le déjeuner de semaine est-il actif ? Vrai sans réglages enregistrés. */
export function midiSemaineDepuisReglages(r: ReglagesGeneration | null): boolean {
  return r === null || r.plafonds.dejeunerSemaine !== "aucun"
}

/**
 * Garde les jours dont la date (lundi de la semaine + rang dans ORDRE_JOURS)
 * est ≥ `aujourdhuiISO`, et retire les semaines devenues vides. Comparaison en
 * chaînes ISO locales (jamais d'objets Date en UTC, cf. #171).
 */
export function joursAPartirDe(
  semaines: SemaineGeneree[],
  aujourdhuiISO: string
): SemaineGeneree[] {
  return semaines
    .map((s) => {
      const lundi = lundiDeSemaine(s.semaine)
      return {
        ...s,
        jours: s.jours.filter((j) => {
          const date = new Date(lundi)
          date.setDate(lundi.getDate() + ORDRE_JOURS.indexOf(j.jour))
          return versISO(date) >= aujourdhuiISO
        }),
      }
    })
    .filter((s) => s.jours.length > 0)
}

/** Cycle du premier planning : ancre par défaut (RG-91) sur 7 jours. */
export function premierCycle(
  aujourdhui: Date,
  jourCourses: number
): { ancre: string; longueur: number } {
  return { ancre: ancreParDefaut(aujourdhui, jourCourses), longueur: LONGUEUR_DEFAUT }
}

/** Destination de fin de tunnel : le paramètre « bienvenue » seulement en solo si la génération a réussi. */
export function urlFinOnboarding(r: { solo: boolean; generationReussie: boolean }): string {
  return r.solo && r.generationReussie ? `/planning?${PARAM_BIENVENUE}=1` : "/planning"
}
