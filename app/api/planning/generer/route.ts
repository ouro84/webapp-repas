import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { aujourdhuiParis } from "@/lib/semaines"
import { limiteGeneration } from "@/lib/rate-limit"
import {
  ErreurGeneration,
  genererPourUtilisateur,
  type DemandeGeneration,
} from "@/lib/generation"

const ROUTE = "POST /api/planning/generer"

// Adaptateur HTTP de la génération (#304) : authentification, rate-limit,
// lecture du corps et traduction des erreurs. La logique (validation de plage,
// lectures RLS, génération) vit dans lib/generation.ts, partagée avec le
// serveur MCP (#302). La route NE PERSISTE PAS : le client écrit ensuite
// (`sauvegarder_planning` en mode semaine, `sauvegarder_cycle` en mode cycle).
export async function POST(request: Request) {
  const supabase = await createClient()

  // Vérifie que l'utilisateur est connecté
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError(
      ROUTE,
      authError,
      "Tu dois être connecté pour générer un planning.",
      401
    )
  }

  // Rate-limiting (#191, audit F-04) : borne le nombre de générations par
  // utilisateur (clé = user.id). No-op si Upstash non configuré (CI/dev) et
  // fail-open si indisponible — cf. lib/rate-limit.ts.
  const { autorise } = await limiteGeneration(user.id)
  if (!autorise) {
    return apiError(
      ROUTE,
      null,
      "Trop de générations en peu de temps. Patiente une minute puis réessaie.",
      429
    )
  }

  // Corps : deux modes exclusifs (#259) — `{ ancre, longueur? }` (cycle) si
  // `ancre` est une chaîne, sinon `{ semaine }` si c'est une chaîne, sinon la
  // semaine par défaut. Un corps illisible vaut la semaine par défaut.
  const corps = (await request.json().catch(() => null)) as {
    semaine?: unknown
    ancre?: unknown
    longueur?: unknown
  } | null

  let demande: DemandeGeneration = {}
  if (corps != null && typeof corps.ancre === "string") {
    demande = {
      ancre: corps.ancre,
      longueur: corps.longueur === undefined ? undefined : Number(corps.longueur),
    }
  } else if (corps && typeof corps.semaine === "string") {
    demande = { semaine: corps.semaine }
  }

  try {
    // Date du jour à Paris (le serveur tourne en UTC) : la semaine par défaut
    // de l'onboarding (corps vide) suit celle du navigateur (#305).
    const resultat = await genererPourUtilisateur(supabase, demande, { aujourdhui: aujourdhuiParis() })
    const { vegeNonHonore, mixNonHonore, saisonNonHonore } = resultat

    // Mode cycle : jours du cycle par semaine ISO touchée, persistés ensuite
    // par le client via `sauvegarder_cycle` (#304).
    if (resultat.mode === "cycle") {
      return NextResponse.json(
        { semaines: resultat.semaines, vegeNonHonore, mixNonHonore, saisonNonHonore },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { planning: resultat.planning, vegeNonHonore, mixNonHonore, saisonNonHonore },
      { status: 200 }
    )
  } catch (erreur) {
    if (erreur instanceof ErreurGeneration) {
      return apiError(ROUTE, erreur.cause ?? null, erreur.message, erreur.statut)
    }
    return apiError(
      ROUTE,
      erreur,
      "La génération a échoué. Réessaie dans quelques instants.",
      500
    )
  }
}
