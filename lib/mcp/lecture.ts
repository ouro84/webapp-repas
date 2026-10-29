// Outils de LECTURE du serveur MCP (#305, US-51, RG-73, RG-78).
//
// Chaque fonction reçoit le client Supabase « par jeton » de l'utilisateur
// (RG-71 : la RLS mon_foyer() borne tout au foyer) et COMPOSE les services
// existants plutôt que de les réimplémenter (règle du jumeau) :
// chargerPlanningDistant, chargerListeCoursesCycle, retirerArticlesCoches,
// retirerCreneauxDesactives, ingredientsAEchelle, formaterQuantite.

import { chargerLongueurCycle, chargerPlanningDistant } from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { chargerReglages } from "@/lib/reglages-data"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import { chargerListeCoursesCycle } from "@/lib/liste-courses-cycle"
import { retirerArticlesCoches } from "@/lib/liste-courses"
import { retirerCreneauxDesactives } from "@/lib/generateur"
import { semaineDansPlage } from "@/lib/generation"
import {
  ancreParDefaut,
  dateVersSemaineJour,
  joursDuCycle,
  libelleCycle,
  semainesDuCycle,
} from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
import { LIBELLES_CATEGORIES } from "@/lib/courses"
import { estCoche, type Coches } from "@/lib/coches"
import { aQuantiteRenseignee } from "@/lib/articles-manuels"
import { accorderNom } from "@/lib/pluriels"
import { formaterQuantite } from "@/lib/unites"
import { ingredientsAEchelle, personnesDuSlot } from "@/lib/personnes"
import { estRestes } from "@/lib/restes"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import {
  datesDeSemaine,
  repasAuxDates,
  TYPE_REPAS,
  validerDate,
  type Creneau,
} from "@/lib/mcp/repas"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Ingredient, Jour, Planning, ReglagesGeneration, TempsPreparation } from "@/types"

const HORS_PLAGE =
  "Cette date est hors de la plage consultable (12 semaines en arrière, 6 en avant). Choisis une date plus proche."

export type PlanningMcp = {
  periode: { du: string; au: string; libelle: string }
  repas: Array<{
    date: string
    creneau: Creneau
    jour: Jour
    recette: string
    personnes: number
    restes: boolean
    vegetarien: boolean
    temps_preparation: TempsPreparation
  }>
}

export type ArticleMcp = { nom: string; quantite: string; manuel: boolean; coche?: boolean }

export type ListeMcp = {
  cycle: { du: string; au: string; libelle: string }
  categories: Array<{ categorie: string; articles: ArticleMcp[] }>
  a_verifier_au_placard: ArticleMcp[]
  nombre_articles: number
}

export type RecetteMcp = {
  date: string
  creneau: Creneau
  recette: string
  personnes: number
  restes: boolean
  vegetarien: boolean
  temps_preparation: TempsPreparation
  ingredients: Array<{ nom: string; quantite: string }>
  a_verifier_au_placard: Array<{ nom: string; quantite: string }>
  etapes: string[]
}

function depuisISO(date: string): Date {
  const [a, m, j] = date.split("-").map(Number)
  return new Date(a, m - 1, j)
}

function moisLong(d: Date): string {
  return d.toLocaleDateString("fr-FR", { month: "long" })
}

// « du 29 octobre au 4 novembre »
function libellePeriode(du: string, au: string): string {
  const [d, a] = [depuisISO(du), depuisISO(au)]
  return `du ${d.getDate()} ${moisLong(d)} au ${a.getDate()} ${moisLong(a)}`
}

// Réglages best-effort, comme /courses et /planning : illisibles → défauts.
async function reglagesOuDefaut(supabase: ClientSupabase): Promise<ReglagesGeneration> {
  return chargerReglages(supabase).catch((erreur): ReglagesGeneration => {
    console.error("Chargement des réglages échoué (défauts appliqués).", erreur)
    return REGLAGES_DEFAUT
  })
}

async function planningsAffiches(
  supabase: ClientSupabase,
  semaines: string[],
  reglages: ReglagesGeneration
): Promise<Planning[]> {
  const resultats = await Promise.all(semaines.map((s) => chargerPlanningDistant(s, supabase)))
  // Créneaux désactivés retirés comme sur /planning (RG-46).
  return resultats.flatMap((r) => (r ? [retirerCreneauxDesactives(r.planning, reglages)] : []))
}

/**
 * `lire_planning` : repas du cycle COURANT (ancre du jour de courses, comme
 * /courses) ou de la semaine ISO `semaine`, chacun désigné par date + créneau.
 */
export async function lirePlanning(
  supabase: ClientSupabase,
  args: { semaine?: string },
  aujourdhui: Date = new Date()
): Promise<PlanningMcp> {
  let dates: string[]
  let semaines: string[]
  if (args.semaine !== undefined) {
    if (!/^\d{4}-W\d{2}$/.test(args.semaine)) {
      throw new ErreurOutil("Semaine invalide : utilise le format AAAA-Www (ex. 2026-W44).")
    }
    if (!semaineDansPlage(semaineISO(aujourdhui), args.semaine)) throw new ErreurOutil(HORS_PLAGE)
    dates = datesDeSemaine(args.semaine)
    semaines = [args.semaine]
  } else {
    const ancre = ancreParDefaut(aujourdhui, await chargerJourCoursesFoyer(supabase))
    const longueur = await chargerLongueurCycle(ancre, supabase)
    dates = joursDuCycle(ancre, longueur)
    semaines = semainesDuCycle(ancre, longueur)
  }

  const reglages = await reglagesOuDefaut(supabase)
  const plannings = await planningsAffiches(supabase, semaines, reglages)
  const du = dates[0]
  const au = dates[dates.length - 1]

  return {
    periode: { du, au, libelle: libellePeriode(du, au) },
    repas: repasAuxDates(plannings, dates).map(({ date, creneau, jour, jp }) => {
      const type = TYPE_REPAS[creneau]
      const recette = jp[type]!
      return {
        date,
        creneau,
        jour,
        recette: recette.nom,
        personnes: personnesDuSlot(jp, type),
        restes: estRestes(jp, type),
        vegetarien: recette.vegetarien === true,
        temps_preparation: recette.tempsPreparation,
      }
    }),
  }
}

function versArticle(i: Ingredient, coches: Coches | null): ArticleMcp {
  return {
    nom: accorderNom(i),
    quantite: aQuantiteRenseignee(i) ? formaterQuantite(i) : "",
    manuel: i.source === "manuel",
    ...(coches ? { coche: estCoche(coches, i) } : {}),
  }
}

/**
 * `lire_liste_courses` : liste du cycle courant, articles NON cochés par défaut
 * (RG-78), groupés par catégorie, articles manuels compris.
 */
export async function lireListeCourses(
  supabase: ClientSupabase,
  args: { inclure_coches?: boolean },
  aujourdhui: Date = new Date()
): Promise<ListeMcp> {
  const { ancre, longueur, liste, coches } = await chargerListeCoursesCycle(supabase, { aujourdhui })
  const inclure = args.inclure_coches === true
  const affichee = inclure ? liste : retirerArticlesCoches(liste, coches)
  const cochesAffichees = inclure ? coches : null

  const categories = affichee.normal.map((ligne) => ({
    categorie: LIBELLES_CATEGORIES[ligne.categorie],
    articles: ligne.ingredients.map((i) => versArticle(i, cochesAffichees)),
  }))
  const placard = affichee.fondDePlacard.map((i) => versArticle(i, cochesAffichees))
  const jours = joursDuCycle(ancre, longueur)

  return {
    cycle: { du: jours[0], au: jours[jours.length - 1], libelle: libelleCycle(ancre, longueur) },
    categories,
    a_verifier_au_placard: placard,
    nombre_articles: categories.reduce((n, c) => n + c.articles.length, 0) + placard.length,
  }
}

/**
 * `lire_recette` : recette du repas `date` + `creneau`, ingrédients à
 * l'échelle des personnes du repas (RG-17) et étapes (RG-78).
 */
export async function lireRecette(
  supabase: ClientSupabase,
  args: { date: string; creneau: Creneau },
  aujourdhui: Date = new Date()
): Promise<RecetteMcp> {
  const invalide = validerDate(args.date)
  if (invalide) throw new ErreurOutil(invalide)
  const { semaine, jour } = dateVersSemaineJour(args.date)
  if (!semaineDansPlage(semaineISO(aujourdhui), semaine)) throw new ErreurOutil(HORS_PLAGE)

  const reglages = await reglagesOuDefaut(supabase)
  const [planning] = await planningsAffiches(supabase, [semaine], reglages)
  const type = TYPE_REPAS[args.creneau]
  const jp = planning?.jours.find((j) => j.jour === jour)
  const recette = jp?.[type]
  if (!jp || !recette) {
    const d = depuisISO(args.date)
    const moment = args.creneau === "midi" ? "au midi" : "au soir"
    throw new ErreurOutil(
      `Aucun repas prévu le ${jour} ${d.getDate()} ${moisLong(d)} ${moment}. Appelle lire_planning pour voir les repas prévus.`
    )
  }

  const personnes = personnesDuSlot(jp, type)
  const ingredients = ingredientsAEchelle(recette.ingredients, personnes)
  const enTexte = (i: Ingredient) => ({ nom: accorderNom(i), quantite: formaterQuantite(i) })

  return {
    date: args.date,
    creneau: args.creneau,
    recette: recette.nom,
    personnes,
    restes: estRestes(jp, type),
    vegetarien: recette.vegetarien === true,
    temps_preparation: recette.tempsPreparation,
    ingredients: ingredients.filter((i) => !i.fondDePlacard).map(enTexte),
    a_verifier_au_placard: ingredients.filter((i) => i.fondDePlacard).map(enTexte),
    etapes: recette.etapes ?? [],
  }
}
