// Création d'une demande de panier, envoi du webhook et fermeture si
// l'exécuteur est injoignable (#308, #320, RG-81, RG-83). Extrait de la route
// `POST /api/panier/demande` pour que le web et le MCP suivent la même séquence
// (règle du jumeau) : le client Supabase est injecté (cookies pour la route,
// jeton pour le MCP), la RLS et la garde de cycle terminé (OMQ04) sont celles de
// la base, jamais refaites ici. Serveur uniquement (webhook sortant).

import { envoyerWebhook, MESSAGE_INJOIGNABLE, MESSAGES_PANIER, type EnvoiWebhook } from "@/lib/panier"
import type { ClientSupabase } from "@/lib/supabase/types"

export const ERREUR_GENERIQUE = "La demande de panier a échoué. Réessaie dans quelques instants."

/** Réponse au dépassement du quota `limitePanier` : route (429) et MCP (règle du jumeau). */
export const MESSAGE_TROP_DE_DEMANDES =
  "Trop de demandes de panier en peu de temps. Patiente une minute puis réessaie."

export type ResultatDemande =
  | { ok: true; demandeId: string }
  | {
      ok: false
      statut: 409 | 500 | 502
      message: string
      code?: "OMQ01" | "OMQ02" | "OMQ04"
      /** Cause brute, pour le log de l'appelant (`apiError`) ; jamais montrée. */
      cause?: unknown
    }

const CODES_REFUSES = ["OMQ01", "OMQ02", "OMQ04"] as const

/**
 * Crée la demande sur `ancre` (RPC `creer_demande_panier`), envoie le webhook
 * signé, et ferme la demande (`echouer_envoi_demande_panier`) si l'exécuteur
 * n'a pas répondu. `OMQ01` / `OMQ02` / `OMQ04` → 409. Si la fermeture renvoie
 * `false`, la demande n'était plus `en_attente` : l'exécuteur l'a prise malgré
 * le délai, c'est un succès. Ne lève pas ; l'appelant journalise `cause`.
 * `contexte` préfixe le seul log émis ici (fermeture impossible).
 */
export async function creerEtEnvoyerDemande(
  supabase: ClientSupabase,
  ancre: string,
  options: { fetch?: typeof fetch; contexte?: string } = {}
): Promise<ResultatDemande> {
  const contexte = options.contexte ?? "panier"

  const { data, error } = await supabase.rpc("creer_demande_panier", { p_ancre: ancre })
  if (error) {
    const code = CODES_REFUSES.find((c) => c === error.code)
    if (code) {
      return { ok: false, statut: 409, message: MESSAGES_PANIER[code], code, cause: error }
    }
    return { ok: false, statut: 500, message: ERREUR_GENERIQUE, cause: error }
  }
  if (!data) {
    return {
      ok: false,
      statut: 500,
      message: ERREUR_GENERIQUE,
      cause: "creer_demande_panier n'a rien renvoyé",
    }
  }

  const envoi = data as EnvoiWebhook
  const resultat = await envoyerWebhook(envoi, { fetch: options.fetch })
  if (!resultat.ok) {
    // Ferme la demande (échec / injoignable) pour qu'une nouvelle soit possible
    // aussitôt. Si cette fermeture échoue, l'expiration paresseuse à 5 min
    // (RG-83) la clôturera : on logue et on répond quand même 502.
    const { data: fermee, error: erreurFermeture } = await supabase.rpc(
      "echouer_envoi_demande_panier",
      { p_demande: envoi.demande_id, p_motif: resultat.motif }
    )
    if (erreurFermeture) {
      console.error(`[${contexte}] fermeture de la demande impossible`, erreurFermeture)
    } else if (fermee === false) {
      // La demande n'était plus `en_attente` : l'exécuteur l'a prise malgré
      // le délai. Elle suit son cours, ce n'est pas un échec.
      return { ok: true, demandeId: envoi.demande_id }
    }
    return { ok: false, statut: 502, message: MESSAGE_INJOIGNABLE, cause: resultat.motif }
  }

  return { ok: true, demandeId: envoi.demande_id }
}
