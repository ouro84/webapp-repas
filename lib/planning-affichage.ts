// lib/planning-affichage.ts
// Libellés de dates et découpage d'affichage partagés par les vues Semaine et
// Cycle du planning (#352). Cœur PUR, testable sans navigateur.
//
// Dates ISO "AAAA-MM-JJ" en heure LOCALE (lib/dates-iso.ts : depuisISO /
// versISO), jamais d'UTC : le jour calendaire affiché doit être celui visé.
//
// lib/cycles.ts importe ce module (libellePlageDates) ; l'inverse n'existe plus :
// les dates ISO viennent du module feuille lib/dates-iso.ts (#352).

import { depuisISO, versISO } from "@/lib/dates-iso"
import { lundiDeSemaine } from "@/lib/semaines"

const MS_PAR_JOUR = 86_400_000

function moisLong(d: Date): string {
  return d.toLocaleDateString("fr-FR", { month: "long" })
}

/** « du 2 au 8 novembre » / « du 30 octobre au 5 novembre » (mois cité une fois si identique). */
export function libellePlageDates(debutISO: string, finISO: string): string {
  const debut = depuisISO(debutISO)
  const fin = depuisISO(finISO)
  const memeMois = debut.getMonth() === fin.getMonth() && debut.getFullYear() === fin.getFullYear()
  return memeMois
    ? `du ${debut.getDate()} au ${fin.getDate()} ${moisLong(fin)}`
    : `du ${debut.getDate()} ${moisLong(debut)} au ${fin.getDate()} ${moisLong(fin)}`
}

/** Position d'un cycle par rapport au cycle courant (offset en cycles). */
export function libelleRelatifCycle(offset: number): string {
  if (offset === 0) return "Ce cycle"
  if (offset === 1) return "Cycle suivant"
  if (offset === -1) return "Cycle précédent"
  return offset > 0 ? `Dans ${offset} cycles` : `Il y a ${-offset} cycles`
}

/** Écart entre deux ancres, en pas de 7 jours (arrondi : tolère le changement d'heure). */
export function decalageCycles(ancre: string, ancreReference: string): number {
  const ecart = depuisISO(ancre).getTime() - depuisISO(ancreReference).getTime()
  return Math.round(ecart / (7 * MS_PAR_JOUR))
}

/** 7 dates ISO d'une semaine ISO « AAAA-Wnn », lundi → dimanche. */
export function datesDeSemaine(semaine: string): string[] {
  const lundi = lundiDeSemaine(semaine)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi)
    d.setDate(lundi.getDate() + i)
    return versISO(d)
  })
}

/** « Lundi 3 nov. » : jour de semaine en toutes lettres, majuscule initiale. */
export function libelleJourComplet(dateISO: string): string {
  const s = depuisISO(dateISO).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « Lun 3 » : jour de semaine abrégé (sans point) + numéro du jour. */
export function libelleJourAbrege(dateISO: string): string {
  const d = depuisISO(dateISO)
  const court = d
    .toLocaleDateString("fr-FR", { weekday: "short" })
    .replace(/\.$/, "")
  return `${court.charAt(0).toUpperCase() + court.slice(1)} ${d.getDate()}`
}

/** Découpe en rangées de `taille` éléments (7 : une rangée = une semaine). */
export function enRangees<T>(items: readonly T[], taille = 7): T[][] {
  const rangees: T[][] = []
  for (let i = 0; i < items.length; i += taille) {
    rangees.push(items.slice(i, i + taille))
  }
  return rangees
}
