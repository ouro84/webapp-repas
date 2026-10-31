import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { aujourdhuiParis } from "@/lib/semaines"
import { ancreParDefaut } from "@/lib/cycles"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { limitePanier } from "@/lib/rate-limit"
import { envoyerWebhook, MESSAGES_PANIER, type EnvoiWebhook } from "@/lib/panier"

const ROUTE = "POST /api/panier/demande"

// Adaptateur HTTP de la demande de panier (#308, RG-81) : authentification,
// rate-limit, puis RPC `creer_demande_panier` (RLS foyer, signature calculée
// dans Postgres) et envoi du webhook à l'exécuteur du foyer. Client à cookies,
// jamais de `service_role`. Aucun corps lu : la demande vise toujours le cycle
// courant (ancre = `ancreParDefaut`), le seul que l'exécuteur sait lire et
// cocher. Une demande déjà active ou un exécuteur absent donnent 409 (OMQ02 /
// OMQ01), garantis par la base (index unique partiel), pas par un select.
export async function POST() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError(
      ROUTE,
      authError,
      "Tu dois être connecté pour préparer ton panier.",
      401
    )
  }

  // Rate-limit par utilisateur (clé = user.id), no-op sans Upstash, fail-open.
  const { autorise } = await limitePanier(user.id)
  if (!autorise) {
    return apiError(
      ROUTE,
      null,
      "Trop de demandes de panier en peu de temps. Patiente une minute puis réessaie.",
      429
    )
  }

  const jourCourses = await chargerJourCoursesFoyer(supabase)
  const ancre = ancreParDefaut(aujourdhuiParis(), jourCourses)

  const { data, error } = await supabase.rpc("creer_demande_panier", { p_ancre: ancre })
  if (error) {
    if (error.code === "OMQ01" || error.code === "OMQ02") {
      return apiError(ROUTE, error, MESSAGES_PANIER[error.code], 409)
    }
    return apiError(
      ROUTE,
      error,
      "La demande de panier a échoué. Réessaie dans quelques instants.",
      500
    )
  }

  const envoi = data as EnvoiWebhook
  const resultat = await envoyerWebhook(envoi)
  if (!resultat.ok) {
    // Ferme la demande (échec / injoignable) pour qu'une nouvelle soit possible
    // aussitôt. Si cette fermeture échoue, l'expiration paresseuse à 5 min
    // (RG-83) la clôturera : on logue et on répond quand même 502.
    const { error: erreurFermeture } = await supabase.rpc("echouer_envoi_demande_panier", {
      p_demande: envoi.demande_id,
      p_motif: resultat.motif,
    })
    if (erreurFermeture) {
      console.error(`[${ROUTE}] fermeture de la demande impossible`, erreurFermeture)
    }
    return apiError(
      ROUTE,
      resultat.motif,
      "Ton exécuteur est injoignable : vérifie qu'il est allumé, puis réessaie.",
      502
    )
  }

  return NextResponse.json({ demande_id: envoi.demande_id }, { status: 202 })
}
