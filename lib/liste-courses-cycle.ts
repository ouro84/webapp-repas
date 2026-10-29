// Service serveur « liste de courses du cycle » (#304) — pour l'outil MCP
// lire_liste_courses (#305, RG-78). Lit le cycle EN TANT QUE l'utilisateur du
// client injecté (RLS mon_foyer(), RG-71) et compose la liste avec le même
// assembleur pur que /courses (lib/liste-courses.ts, règle du jumeau). /courses
// reste sur ses stores temps réel (lib/sync.ts) et n'appelle pas ce service.

import {
  chargerArticlesManuelsDistants,
  chargerCochesDistantes,
  chargerLongueurCycle,
  chargerPlanningDistant,
} from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { chargerReglages } from "@/lib/reglages-data"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import { ancreParDefaut, planningDuCycle, semainesDuCycle } from "@/lib/cycles"
import { assemblerListeCourses } from "@/lib/liste-courses"
import type { Coches } from "@/lib/coches"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { ListeCourses, Planning, ReglagesGeneration } from "@/types"

export type ListeCoursesCycle = {
  ancre: string
  longueur: number
  // Liste complète (cochés compris), articles manuels inclus — filtrer avec
  // retirerArticlesCoches pour « ce qu'il reste à acheter ».
  liste: ListeCourses
  coches: Coches
}

/**
 * Liste de courses d'un cycle : le cycle COURANT par défaut (ancre du jour de
 * courses du foyer, `ancreParDefaut` comme /courses), ou celui de `ancre`.
 * Les erreurs de lecture du planning, des articles manuels et des coches se
 * propagent ; les réglages illisibles retombent sur les défauts (comme /courses).
 */
export async function chargerListeCoursesCycle(
  supabase: ClientSupabase,
  options: { ancre?: string; aujourdhui?: Date } = {}
): Promise<ListeCoursesCycle> {
  const ancre =
    options.ancre ??
    ancreParDefaut(options.aujourdhui ?? new Date(), await chargerJourCoursesFoyer(supabase))
  const longueur = await chargerLongueurCycle(ancre, supabase)

  const resultats = await Promise.all(
    semainesDuCycle(ancre, longueur).map((s) => chargerPlanningDistant(s, supabase))
  )
  const plannings: Planning[] = resultats.flatMap((r) => (r ? [r.planning] : []))
  const planning = planningDuCycle(plannings, ancre, longueur)

  const [reglages, articlesManuels, coches] = await Promise.all([
    chargerReglages(supabase).catch((erreur): ReglagesGeneration => {
      console.error("Chargement des réglages échoué (défauts appliqués).", erreur)
      return REGLAGES_DEFAUT
    }),
    chargerArticlesManuelsDistants(ancre, supabase),
    chargerCochesDistantes(ancre, supabase),
  ])

  return {
    ancre,
    longueur,
    liste: assemblerListeCourses(planning, reglages, articlesManuels),
    coches,
  }
}
