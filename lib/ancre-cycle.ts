// Résolution du CYCLE VISÉ (#320, #360, RG-85) : la seule décision « quel
// cycle ? » côté serveur, partagée par les outils MCP (`cycleVise`,
// lib/mcp/cycle.ts), `POST /api/panier/demande`, l'exécuteur de panier et le
// lien profond de la vue Cycle. La base (`creer_demande_panier`, `p_ancre`)
// attend une ancre résolue, jamais une date en milieu de cycle (la garde OMQ04
// lit les jours du cycle depuis l'ancre).

import { chargerLongueurCycle } from "@/lib/persistance"
import { chargerJourCoursesStrict } from "@/lib/foyer"
import { semaineDansPlage } from "@/lib/generation"
import {
  ancreCourante,
  ancreParDefaut,
  cycleDecale,
  dateVersSemaineJour,
  depuisISO,
  estDateISO,
  joursDuCycle,
  semainesDuCycle,
} from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
import type { ClientSupabase } from "@/lib/supabase/types"

export type CycleResolu = {
  ancre: string
  longueur: number
  jours: string[]
  semaines: string[]
  du: string
  au: string
}

export type ResolutionCycle =
  | { ok: true; cycle: CycleResolu }
  | { ok: false; motif: "invalide" | "hors_plage" }

/**
 * Cycle visé : sans `date`, le cycle COURANT (`ancreParDefaut`, comme /courses) ;
 * avec, le cycle qui contient `date` (AAAA-MM-JJ). Une date entre deux cycles
 * (cycle raccourci) désigne le cycle suivant. `invalide` si la date est mal
 * formée, `hors_plage` si le cycle sort de −12 / +6 semaines.
 *
 * Lit TOUJOURS le jour de courses en lecture stricte : lève si la lecture échoue
 * ou si le foyer est absent. Pourquoi : un repli sur lundi viserait un autre
 * cycle, et `generer_cycle(remplacer)`, une coche ou une demande de panier
 * agiraient dessus (#360).
 */
export async function resoudreCycle(
  supabase: ClientSupabase,
  demande: { date?: string },
  aujourdhui: Date
): Promise<ResolutionCycle> {
  const { date } = demande
  if (date !== undefined && !estDateISO(date)) return { ok: false, motif: "invalide" }
  const jourCourses = await chargerJourCoursesStrict(supabase)

  let ancre = date === undefined ? ancreParDefaut(aujourdhui, jourCourses) : ancreCourante(depuisISO(date), jourCourses)
  let longueur = await chargerLongueurCycle(ancre, supabase)
  // Cycle raccourci (longueur < 7) : la date peut tomber dans le trou avant le
  // prochain jour de courses ; ancreCourante la ramènerait au cycle courant.
  // Une date après le dernier jour du cycle désigne le cycle suivant.
  if (date !== undefined) {
    const derniers = joursDuCycle(ancre, longueur)
    if (date > derniers[derniers.length - 1]) {
      ancre = cycleDecale(ancre, 1)
      longueur = await chargerLongueurCycle(ancre, supabase)
    }
  }
  if (!semaineDansPlage(semaineISO(aujourdhui), dateVersSemaineJour(ancre).semaine)) {
    return { ok: false, motif: "hors_plage" }
  }
  const jours = joursDuCycle(ancre, longueur)
  return {
    ok: true,
    cycle: {
      ancre,
      longueur,
      jours,
      semaines: semainesDuCycle(ancre, longueur),
      du: jours[0],
      au: jours[jours.length - 1],
    },
  }
}

// Transitoire (#360, retirée en Task 3) : ancien contrat « ancre seule ».
export type ResolutionAncre =
  | { ok: true; ancre: string }
  | { ok: false; motif: "invalide" | "hors_plage" }

export async function resoudreAncreCycle(
  supabase: ClientSupabase,
  date: string,
  aujourdhui: Date
): Promise<ResolutionAncre> {
  const r = await resoudreCycle(supabase, { date }, aujourdhui)
  return r.ok ? { ok: true, ancre: r.cycle.ancre } : r
}
