import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { aujourdhuiParis } from "@/lib/semaines"
import { ancreParDefaut, estDateISO } from "@/lib/cycles"
import { chargerJourCoursesStrict } from "@/lib/foyer"
import { resoudreAncreCycle } from "@/lib/ancre-cycle"
import { limitePanier } from "@/lib/rate-limit"
import { creerEtEnvoyerDemande, ERREUR_GENERIQUE, MESSAGE_TROP_DE_DEMANDES } from "@/lib/panier-demande"

const ROUTE = "POST /api/panier/demande"

// Le webhook peut attendre 10 s (RG-81), plus les RPC autour : marge large.
export const maxDuration = 30

// Adaptateur HTTP de la demande de panier (#308, #320, RG-81) : authentification,
// rate-limit, lecture de l'ancre, puis `creerEtEnvoyerDemande` (RPC
// `creer_demande_panier` sous RLS foyer, webhook à l'exécuteur, fermeture si
// injoignable : séquence partagée avec le MCP). Client à cookies, jamais de
// `service_role`. Corps JSON optionnel `{ ancre?: string }` : une date du cycle
// visé, résolue en ancre de cycle (`resoudreAncreCycle`, comme le MCP) ; absent
// ou vide, c'est le cycle courant (`ancreParDefaut`). Une date mal formée ou
// d'un cycle hors plage donne 400 sans aucune RPC. Une demande déjà active, un
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
    return apiError(ROUTE, null, MESSAGE_TROP_DE_DEMANDES, 429)
  }

  const corps = await lireCorps(request)
  if (corps === "invalide") {
    return apiError(ROUTE, "ancre invalide", "Cycle invalide.", 400)
  }

  let ancre: string
  try {
    const aujourdhui = aujourdhuiParis()
    if (corps.ancre === undefined) {
      // Lecture stricte plutôt que `chargerJourCoursesFoyer`, qui retombe sur
      // lundi en cas d'erreur : une ancre fausse viserait un autre cycle que
      // celui que l'exécuteur lit et coche. La RLS (`id = mon_foyer()`) borne la ligne.
      ancre = ancreParDefaut(aujourdhui, await chargerJourCoursesStrict(supabase))
    } else {
      // `p_ancre` doit être une ANCRE de cycle : une date en milieu de cycle
      // contournerait la garde OMQ04 (la base lit les jours depuis l'ancre) et
      // la plage. Même résolution que les outils MCP (`lib/ancre-cycle.ts`).
      const resolution = await resoudreAncreCycle(supabase, corps.ancre, aujourdhui)
      if (!resolution.ok) {
        return apiError(ROUTE, `ancre ${resolution.motif}`, "Cycle invalide.", 400)
      }
      ancre = resolution.ancre
    }
  } catch (erreurFoyer) {
    return apiError(ROUTE, erreurFoyer, ERREUR_GENERIQUE, 500)
  }

  const resultat = await creerEtEnvoyerDemande(supabase, ancre, { contexte: ROUTE })
  if (!resultat.ok) {
    return apiError(ROUTE, resultat.cause ?? resultat.message, resultat.message, resultat.statut)
  }
  return NextResponse.json({ demande_id: resultat.demandeId }, { status: 202 })
}
