// Résolution d'une date quelconque en ANCRE de cycle (#320, RG-85), partagée par
// les outils MCP (`ancreDemandee`) et par `POST /api/panier/demande` : la base
// (`creer_demande_panier`, `p_ancre`) attend une ancre résolue, jamais une date
// en milieu de cycle (la garde OMQ04 lit les jours du cycle depuis l'ancre).

import { chargerLongueurCycle } from "@/lib/persistance"
import { chargerJourCoursesStrict } from "@/lib/foyer"
import { semaineDansPlage } from "@/lib/generation"
import { ancreCourante, cycleDecale, dateVersSemaineJour, estDateISO, joursDuCycle } from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
import type { ClientSupabase } from "@/lib/supabase/types"

export type ResolutionAncre =
  | { ok: true; ancre: string }
  | { ok: false; motif: "invalide" | "hors_plage" }

/**
 * Ancre du cycle qui contient `date` (AAAA-MM-JJ). Une date entre deux cycles
 * (cycle raccourci) désigne le cycle suivant. `invalide` si la date est mal
 * formée, `hors_plage` si le cycle sort de −12 / +6 semaines. Lit le jour de
 * courses en lecture stricte : lève si la lecture échoue (jamais de repli sur
 * lundi, qui viserait un autre cycle).
 */
export async function resoudreAncreCycle(
  supabase: ClientSupabase,
  date: string,
  aujourdhui: Date
): Promise<ResolutionAncre> {
  if (!estDateISO(date)) return { ok: false, motif: "invalide" }
  let resolue = ancreCourante(depuisISO(date), await chargerJourCoursesStrict(supabase))
  // Cycle raccourci (longueur < 7) : la date peut tomber dans le trou avant le
  // prochain jour de courses ; ancreCourante la ramènerait au cycle courant.
  // Une date après le dernier jour du cycle désigne le cycle suivant.
  const jours = joursDuCycle(resolue, await chargerLongueurCycle(resolue, supabase))
  if (date > jours[jours.length - 1]) resolue = cycleDecale(resolue, 1)
  if (!semaineDansPlage(semaineISO(aujourdhui), dateVersSemaineJour(resolue).semaine)) {
    return { ok: false, motif: "hors_plage" }
  }
  return { ok: true, ancre: resolue }
}

function depuisISO(date: string): Date {
  const [a, m, j] = date.split("-").map(Number)
  return new Date(a, m - 1, j)
}
