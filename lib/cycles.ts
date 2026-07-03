// lib/cycles.ts
// Cycle de courses (#257) — fenêtre `ancre + longueur` projetée par-dessus le
// stockage par semaine ISO. Cœur PUR, testable sans réseau (esprit lib/semaines).
//
// Ancre = date ISO "AAAA-MM-JJ" du jour de courses du foyer. Arithmétique
// calendaire en heure LOCALE (cohérent avec lib/semaines.ts, cf. #171) :
// semaineISO() reconstruit l'identifiant depuis les getters locaux.

import { semaineISO } from "@/lib/semaines"
import type { Jour } from "@/types"

export const LONGUEUR_DEFAUT = 7
export const LONGUEUR_MAX = 14

// ISO : lundi = 1 … dimanche = 7 (Date.getDay renvoie 0 pour dimanche).
const JOURS_ISO: Jour[] = [
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
]

function jourISO(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay()
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

/** Date ISO de la dernière occurrence du jour de courses ≤ aujourd'hui (D8). */
export function ancreCourante(aujourdhui: Date, jourCourses: number): string {
  const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate())
  const recul = (jourISO(d) - jourCourses + 7) % 7
  d.setDate(d.getDate() - recul)
  return versISO(d)
}

/** Ancre décalée de n cycles (n×7 jours). */
export function cycleDecale(ancre: string, n: number): string {
  const d = depuisISO(ancre)
  d.setDate(d.getDate() + n * 7)
  return versISO(d)
}

/** Dates ISO concrètes du cycle. */
export function joursDuCycle(ancre: string, longueur: number): string[] {
  const base = depuisISO(ancre)
  return Array.from({ length: longueur }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    return versISO(d)
  })
}

/** Semaines ISO distinctes que le cycle touche (ordre chronologique). */
export function semainesDuCycle(ancre: string, longueur: number): string[] {
  const vues = new Set<string>()
  const ordonnees: string[] = []
  for (const jour of joursDuCycle(ancre, longueur)) {
    const s = semaineISO(depuisISO(jour))
    if (!vues.has(s)) { vues.add(s); ordonnees.push(s) }
  }
  return ordonnees
}

/** Pont vers le stockage par semaine ISO : une date → (semaine, jour). */
export function dateVersSemaineJour(dateISO: string): { semaine: string; jour: Jour } {
  const d = depuisISO(dateISO)
  return { semaine: semaineISO(d), jour: JOURS_ISO[jourISO(d) - 1] }
}

/** « Courses du 9 au 15 juillet ». */
export function libelleCycle(ancre: string, longueur: number): string {
  const jours = joursDuCycle(ancre, longueur)
  const debut = depuisISO(jours[0])
  const fin = depuisISO(jours[jours.length - 1])
  const memeMois = debut.getMonth() === fin.getMonth()
  const fmtJour = (d: Date) => d.getDate()
  const fmtMois = (d: Date) => d.toLocaleDateString("fr-FR", { month: "long" })
  return memeMois
    ? `Courses du ${fmtJour(debut)} au ${fmtJour(fin)} ${fmtMois(fin)}`
    : `Courses du ${fmtJour(debut)} ${fmtMois(debut)} au ${fmtJour(fin)} ${fmtMois(fin)}`
}

/** Plage de cycles navigables (miroir de semainesSelectionnables). */
export function cyclesSelectionnables(
  aujourdhui: Date, jourCourses: number, passe = 12, futur = 6,
): { ancre: string; offset: number }[] {
  const courante = ancreCourante(aujourdhui, jourCourses)
  const options: { ancre: string; offset: number }[] = []
  for (let offset = -passe; offset <= futur; offset++) {
    options.push({ ancre: cycleDecale(courante, offset), offset })
  }
  return options
}
