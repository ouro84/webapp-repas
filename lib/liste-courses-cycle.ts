// Service serveur « liste de courses du cycle » (#304) — pour l'outil MCP
// lire_liste_courses (#305, RG-78). Lit le cycle EN TANT QUE l'utilisateur du
// client injecté (RLS mon_foyer(), RG-71) et compose la liste avec le même
// assembleur pur que /courses (lib/liste-courses.ts, règle du jumeau). /courses
// reste sur ses stores temps réel (lib/sync.ts) et n'appelle pas ce service.

import { chargerArticlesManuelsDistants, chargerCochesDistantes } from "@/lib/persistance"
import { chargerReglages } from "@/lib/reglages-data"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import { lireCycle } from "@/lib/lecture-cycle"
import { assemblerListeCourses } from "@/lib/liste-courses"
import type { Coches } from "@/lib/coches"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { ListeCourses, ReglagesGeneration } from "@/types"

export type ListeCoursesCycle = {
  ancre: string
  longueur: number
  // Liste complète (cochés compris), articles manuels inclus — filtrer avec
  // retirerArticlesCoches pour « ce qu'il reste à acheter ».
  liste: ListeCourses
  coches: Coches
}

/**
 * Liste de courses d'un cycle DÉJÀ résolu (`resoudreCycle` / `cycleVise`, ou
 * l'ancre d'une demande de panier et sa longueur) : ce service ne choisit jamais
 * le cycle (#360). Les erreurs de lecture du planning, des articles manuels et
 * des coches se propagent ; les réglages illisibles retombent sur les défauts
 * (comme /courses).
 */
export async function chargerListeCoursesCycle(
  supabase: ClientSupabase,
  { ancre, longueur }: { ancre: string; longueur: number }
): Promise<ListeCoursesCycle> {
  // Lecteur de cycle unique (chantier 05) : une semaine illisible rejette
  // l'ensemble (ErreurLectureCycle), propagée.
  const { planning } = await lireCycle({ ancre, longueur }, supabase)

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
