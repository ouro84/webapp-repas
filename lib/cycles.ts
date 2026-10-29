// lib/cycles.ts
// Cycle de courses (#257) — fenêtre `ancre + longueur` projetée par-dessus le
// stockage par semaine ISO. Cœur PUR, testable sans réseau (esprit lib/semaines).
//
// Ancre = date ISO "AAAA-MM-JJ" du jour de courses du foyer. Arithmétique
// calendaire en heure LOCALE (cohérent avec lib/semaines.ts, cf. #171) :
// semaineISO() reconstruit l'identifiant depuis les getters locaux.

import { lundiDeSemaine, semaineISO } from "@/lib/semaines"
import type { Jour, Planning, JourPlanning } from "@/types"

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

/**
 * Ancre du cycle affiché PAR DÉFAUT au montage de /courses (#257).
 *
 * En semaine, c'est l'ancre courante (`ancreCourante` : dernier jour de courses
 * ≤ aujourd'hui). Le WEEK-END, la génération vise déjà la semaine PROCHAINE
 * (`semaineParDefaut` de lib/semaines : offset +1 le samedi/dimanche, US-11) ;
 * on décale donc le cycle par défaut d'un cran pour qu'il COUVRE cette semaine
 * générée — sinon /courses afficherait le cycle courant (souvent déjà écoulé le
 * week-end, la virée de courses de la semaine ayant eu lieu) et la liste
 * fraîchement générée n'apparaîtrait que sous « Cycle suivant ». On restaure
 * ainsi le comportement d'avant #257 (« la liste générée s'affiche sur
 * /courses »), qui tenait quand /courses lisait `planning_courant` (planning
 * actif, hors semaine) au lieu de projeter un cycle ancré sur aujourd'hui.
 *
 * Règle week-end IDENTIQUE à `semaineParDefaut` (getDay 0=dimanche ou 6=samedi)
 * pour rester alignés par construction. La navigation (`cycleDecale`) et la
 * sélection restent basées sur `ancreCourante` — seul le DÉFAUT est décalé.
 * (En PR2, la génération devient fenêtrée sur le cycle : cette divergence
 * ISO-semaine ↔ cycle disparaît.)
 */
export function ancreParDefaut(aujourdhui: Date, jourCourses: number): string {
  const ancre = ancreCourante(aujourdhui, jourCourses)
  const jour = aujourdhui.getDay() // 0 = dimanche, 6 = samedi
  const enWeekend = jour === 0 || jour === 6
  return enWeekend ? cycleDecale(ancre, 1) : ancre
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

/** Vrai si `date` est au format AAAA-MM-JJ ET existe au calendrier (refuse
 *  2026-02-30, que `new Date` décalerait au 2 mars). Partagé par la génération
 *  serveur et les outils MCP (#306). */
export function estDateISO(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(a, mo - 1, j)
  return d.getFullYear() === a && d.getMonth() === mo - 1 && d.getDate() === j
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

/**
 * Génération fenêtrée (#259, PR2) — regroupe les jours d'un planning GÉNÉRÉ (14
 * slots d'une semaine ISO, keyé par jour de semaine) selon le cycle, indexé par
 * semaine ISO pour la persistance par-semaine (`sauvegarder_slots`).
 *
 * Pour chaque date du cycle, on associe le `JourPlanning` du même jour de semaine
 * du planning généré. Un jour de semaine est UNIQUE dans une semaine ISO donnée →
 * aucune collision au sein d'une même semaine. Sur un cycle > 7 j, un jour de
 * semaine peut se répéter (dans une AUTRE semaine ISO) : il réutilise alors la
 * même recette générée (limitation mineure et assumée, cf. §9 « chevauchement »).
 * Jours sans `JourPlanning` correspondant omis (robustesse).
 */
export function planningGenereParSemaine(
  planningGenere: Planning, ancre: string, longueur: number,
): Map<string, JourPlanning[]> {
  const parJour = new Map(planningGenere.jours.map((jp) => [jp.jour, jp]))
  const parSemaine = new Map<string, JourPlanning[]>()
  for (const dateISO of joursDuCycle(ancre, longueur)) {
    const { semaine, jour } = dateVersSemaineJour(dateISO)
    const jp = parJour.get(jour)
    if (!jp) continue
    const liste = parSemaine.get(semaine) ?? []
    if (!liste.some((x) => x.jour === jour)) liste.push(jp)
    parSemaine.set(semaine, liste)
  }
  return parSemaine
}

/**
 * Planning synthétique limité aux jours du cycle, recollé depuis les plannings
 * par semaine chargés. Les doublons de `jour` (cycle > 7 j) sont conservés :
 * genererListeCourses agrège par ingrédient, pas par jour. Jours sans slot omis.
 */
export function planningDuCycle(
  plannings: Planning[], ancre: string, longueur: number,
): Planning {
  const parSemaine = new Map(plannings.map((p) => [p.semaine, p]))
  const jours: JourPlanning[] = []
  for (const dateISO of joursDuCycle(ancre, longueur)) {
    const { semaine, jour } = dateVersSemaineJour(dateISO)
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour)
    if (jp) jours.push(jp)
  }
  return { semaine: ancre, jours }
}

/**
 * Ancre du cycle qui CONTIENT la semaine ISO donnée (#279, dérivation
 * Semaine → Courses). Référence = jeudi de la semaine (même ancrage que
 * `saisonDeSemaine` de lib/semaines.ts) : le jeudi porte déjà l'année ISO, et
 * comme les ancres sont espacées de 7 j (cadence hebdomadaire fixe, cf. #257
 * D8), il n'existe qu'une seule ancre ≤ jeudi qui couvre effectivement cette
 * semaine — peu importe où tombe jourCourses dans la semaine.
 */
export function ancreDeSemaine(semaine: string, jourCourses: number): string {
  const jeudi = lundiDeSemaine(semaine)
  jeudi.setDate(jeudi.getDate() + 3)
  return ancreCourante(jeudi, jourCourses)
}

/**
 * Mise à jour optimiste de la vue Cycle (#301, US-49/RG-57) : remplace le
 * JourPlanning de même `jour` dans le planning de `semaine`, sans muter
 * l'entrée (nouvelle Map, nouveau Planning pour la seule semaine touchée ; les
 * autres semaines et jours gardent leur référence). Semaine absente ou jour
 * absent : copie au contenu identique.
 */
export function remplacerJourDansSemaines(
  parSemaine: ReadonlyMap<string, Planning>, semaine: string, jour: JourPlanning,
): Map<string, Planning> {
  const resultat = new Map(parSemaine)
  const planning = parSemaine.get(semaine)
  if (planning) {
    resultat.set(semaine, {
      ...planning,
      jours: planning.jours.map((jp) => (jp.jour === jour.jour ? jour : jp)),
    })
  }
  return resultat
}
