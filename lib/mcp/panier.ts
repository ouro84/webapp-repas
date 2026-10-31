// Outils MCP de l'exécuteur de panier : prendre_demande_panier et
// rapporter_panier (#308, US-53, RG-81→84).
//
// Appelés par l'exécuteur du foyer (Hermes) sous son propre jeton OAuth : RLS
// mon_foyer() (RG-71), jamais `service_role`. Toute la logique (expiration
// paresseuse, une seule demande active, rapport tardif) vit dans les RPC
// `prendre_demande_panier` et `rapporter_panier` ; ce module ne fait que
// traduire leurs réponses et leurs codes d'erreur pour l'assistant.

import { ErreurOutil } from "@/lib/mcp/erreurs"
import { MESSAGES_PANIER, type RapportPanier } from "@/lib/panier"
import type { ClientSupabase } from "@/lib/supabase/types"

export type DemandePrise = { id: string; ancre: string }

/**
 * `prendre_demande_panier` : passe la plus ancienne demande `en_attente` du
 * foyer en `en_cours` et la renvoie. `{ demande: null }` s'il n'y a rien à
 * faire (webhook forgé, demande expirée, autre foyer) : l'exécuteur s'arrête.
 */
export async function prendreDemandePanier(
  supabase: ClientSupabase
): Promise<{ demande: DemandePrise | null }> {
  const { data, error } = await supabase.rpc("prendre_demande_panier")
  if (error) throw new Error(`Prise de la demande de panier impossible : ${error.message}`)
  if (!data) return { demande: null }
  const { id, ancre } = data as DemandePrise
  return { demande: { id, ancre } }
}

export type ArgsRapport = {
  demande_id: string
  statut: "terminee" | "echec"
  motif?: string
} & RapportPanier

/**
 * `rapporter_panier` : compte-rendu de fin de run (RG-84). Un échec exige un
 * motif, lu ensuite par le foyer. Une demande close ou remplacée par une plus
 * récente lève OMQ03, traduit en message qui dit à l'assistant de s'arrêter
 * (RG-83).
 */
export async function rapporterPanier(
  supabase: ClientSupabase,
  args: ArgsRapport
): Promise<{ statut: "terminee" | "echec"; rapport_tardif: boolean }> {
  const motif = args.motif?.trim() || null
  if (args.statut === "echec" && !motif) {
    throw new ErreurOutil(
      "Un rapport en échec exige `motif` : explique en une phrase pourquoi le panier n'a pas pu être fait, puis rappelle rapporter_panier."
    )
  }

  const rapport: RapportPanier = {
    ajoutes: args.ajoutes,
    a_choisir: args.a_choisir,
    introuvables: args.introuvables,
  }
  const { data, error } = await supabase.rpc("rapporter_panier", {
    p_demande: args.demande_id,
    p_statut: args.statut,
    p_rapport: rapport,
    p_motif: motif,
  })
  if (error) {
    if (error.code === "OMQ03") throw new ErreurOutil(MESSAGES_PANIER.OMQ03)
    throw new Error(`Rapport de panier impossible : ${error.message}`)
  }
  const { statut, rapport_tardif } = data as { statut: "terminee" | "echec"; rapport_tardif: boolean }
  return { statut, rapport_tardif }
}
