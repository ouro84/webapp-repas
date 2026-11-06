// Adaptateur MCP du cycle visé (#360, RG-85) : traduit le refus métier de
// `resoudreCycle` (lib/ancre-cycle.ts) en `ErreurOutil`. Seule porte d'entrée
// des outils vers un cycle : lectures, generer_cycle, cocher_article,
// ajouter_article_courses, lancer_demande_panier.

import { resoudreCycle, type CycleResolu } from "@/lib/ancre-cycle"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { MESSAGE_DATE_INVALIDE } from "@/lib/mcp/repas"
import type { ClientSupabase } from "@/lib/supabase/types"

export const CYCLE_HORS_PLAGE =
  "Ce cycle est hors de la plage autorisée (12 semaines en arrière, 6 en avant). Choisis une date plus proche."

/**
 * Cycle COURANT (`ancre` absente) ou cycle qui contient `ancre` (une date
 * quelconque, AAAA-MM-JJ). Lève `ErreurOutil` si la date est invalide ou le
 * cycle hors plage −12 / +6 semaines ; lève une `Error` (masquée par
 * `executer`) si le jour de courses ne peut pas être lu : jamais de repli.
 */
export async function cycleVise(
  supabase: ClientSupabase,
  ancre: string | undefined,
  aujourdhui: Date
): Promise<CycleResolu> {
  const resolution = await resoudreCycle(supabase, ancre === undefined ? {} : { date: ancre }, aujourdhui)
  if (!resolution.ok) {
    throw new ErreurOutil(resolution.motif === "invalide" ? MESSAGE_DATE_INVALIDE : CYCLE_HORS_PLAGE)
  }
  return resolution.cycle
}
