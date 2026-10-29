// Désignation des repas pour le serveur MCP (#305, RG-73) — logique PURE.
//
// Un outil MCP vise et renvoie un repas par `date` (ISO AAAA-MM-JJ) + `creneau`
// (`midi` | `soir`). Le stockage reste par semaine ISO : chaque date est
// rattachée à SA semaine par `dateVersSemaineJour` (lib/cycles.ts), si bien
// qu'un cycle de 14 j qui répète un jour de semaine lit bien deux semaines.

import { dateVersSemaineJour, estDateISO, joursDuCycle } from "@/lib/cycles"
import { lundiDeSemaine, semaineISO } from "@/lib/semaines"
import { semaineDansPlage } from "@/lib/generation"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import type { Jour, JourPlanning, Planning } from "@/types"

export type Creneau = "midi" | "soir"

/** Créneau MCP → clé du créneau dans `JourPlanning` (RG-73). */
export const TYPE_REPAS: Record<Creneau, "dejeuner" | "diner"> = {
  midi: "dejeuner",
  soir: "diner",
}

export type RepasDate = { date: string; creneau: Creneau; jour: Jour; jp: JourPlanning }

/**
 * Repas des `dates` (dans leur ordre), un élément par créneau qui porte une
 * recette, `midi` avant `soir`. Les dates sans planning sont omises.
 */
export function repasAuxDates(plannings: Planning[], dates: string[]): RepasDate[] {
  const parSemaine = new Map(plannings.map((p) => [p.semaine, p]))
  const repas: RepasDate[] = []
  for (const date of dates) {
    const { semaine, jour } = dateVersSemaineJour(date)
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour)
    if (!jp) continue
    for (const creneau of ["midi", "soir"] as const) {
      if (jp[TYPE_REPAS[creneau]]) repas.push({ date, creneau, jour, jp })
    }
  }
  return repas
}

/** Les 7 dates ISO d'une semaine ISO, du lundi au dimanche. */
export function datesDeSemaine(semaine: string): string[] {
  const lundi = lundiDeSemaine(semaine)
  const iso = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`
  return joursDuCycle(iso, 7)
}

export const HORS_PLAGE =
  "Cette date est hors de la plage autorisée (12 semaines en arrière, 6 en avant). Choisis une date plus proche."

const MESSAGE_DATE_INVALIDE = "Date invalide : utilise le format AAAA-MM-JJ (ex. 2026-10-29)."

/** `null` si `date` est au format AAAA-MM-JJ et existe au calendrier, sinon le message d'erreur. */
export function validerDate(date: string): string | null {
  return estDateISO(date) ? null : MESSAGE_DATE_INVALIDE
}

/**
 * Semaine ISO et jour d'un repas désigné par `date` (RG-73), après contrôle du
 * format et de la plage −12 / +6 semaines. Lève `ErreurOutil` sinon.
 */
export function localiserRepas(date: string, aujourdhui: Date): { semaine: string; jour: Jour } {
  const invalide = validerDate(date)
  if (invalide) throw new ErreurOutil(invalide)
  const { semaine, jour } = dateVersSemaineJour(date)
  if (!semaineDansPlage(semaineISO(aujourdhui), semaine)) throw new ErreurOutil(HORS_PLAGE)
  return { semaine, jour }
}
