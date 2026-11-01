import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { aujourdhuiParis } from "@/lib/semaines"
import { ancreParDefaut, estDateISO } from "@/lib/cycles"
import { limitePanier } from "@/lib/rate-limit"
import { creerEtEnvoyerDemande, ERREUR_GENERIQUE } from "@/lib/panier-demande"

const ROUTE = "POST /api/panier/demande"

// Le webhook peut attendre 10 s (RG-81), plus les RPC autour : marge large.
export const maxDuration = 30

// Adaptateur HTTP de la demande de panier (#308, #320, RG-81) : authentification,
// rate-limit, lecture de l'ancre, puis `creerEtEnvoyerDemande` (RPC
// `creer_demande_panier` sous RLS foyer, webhook à l'exécuteur, fermeture si
// injoignable : séquence partagée avec le MCP). Client à cookies, jamais de
// `service_role`. Corps JSON optionnel `{ ancre?: string }` : le cycle visé par
// la demande ; absent ou vide, c'est le cycle courant (`ancreParDefaut`). Une
// ancre mal formée donne 400 sans aucune RPC. Une demande déjà active, un
// exécuteur absent ou un cycle terminé donnent 409 (OMQ02 / OMQ01 / OMQ04),
// garantis par la base (index unique partiel, garde de date), pas par la route.

type Corps = { ancre?: string } | "invalide"

/** Lit le corps optionnel : vide → `{}` ; JSON non objet ou ancre mal formée → "invalide". */
async function lireCorps(request: Request): Promise<Corps> {
  const texte = (await request.text()).trim()
  if (texte === "") return {}
  let json: unknown
  try {
    json = JSON.parse(texte)
  } catch {
    return "invalide"
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return "invalide"
  const { ancre } = json as { ancre?: unknown }
  if (ancre === undefined) return {}
  if (typeof ancre !== "string" || !estDateISO(ancre)) return "invalide"
  return { ancre }
}

export async function POST(request: Request) {
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

  const corps = await lireCorps(request)
  if (corps === "invalide") {
    return apiError(ROUTE, "ancre invalide", "Cycle invalide.", 400)
  }

  let ancre = corps.ancre
  if (ancre === undefined) {
    // Lecture directe plutôt que `chargerJourCoursesFoyer`, qui retombe sur
    // lundi en cas d'erreur : une ancre fausse viserait un autre cycle que
    // celui que l'exécuteur lit et coche. La RLS (`id = mon_foyer()`) borne la ligne.
    const { data: foyer, error: erreurFoyer } = await supabase
      .from("foyers")
      .select("jour_courses")
      .maybeSingle()
    if (erreurFoyer || !foyer) {
      return apiError(ROUTE, erreurFoyer ?? "foyer introuvable", ERREUR_GENERIQUE, 500)
    }
    ancre = ancreParDefaut(aujourdhuiParis(), foyer.jour_courses)
  }

  const resultat = await creerEtEnvoyerDemande(supabase, ancre, { contexte: ROUTE })
  if (!resultat.ok) {
    return apiError(ROUTE, resultat.cause ?? resultat.message, resultat.message, resultat.statut)
  }
  return NextResponse.json({ demande_id: resultat.demandeId }, { status: 202 })
}
