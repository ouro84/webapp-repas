import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { genererPlanning, joursSansLegume, slotsVegeNonHonores } from "@/lib/generateur"
import { decalageEntre, semaineISO, semaineParDefaut } from "@/lib/semaines"
import { dbRecetteToDomain } from "@/lib/adapters"
import { dbReglagesToDomain, REGLAGES_DEFAUT } from "@/lib/reglages"

// Plage de génération autorisée (#5) : navigation historique −12 → +6 semaines.
const SEMAINES_PASSEES = 12
const SEMAINES_FUTURES = 6
import type { DbRecette, DbReglages } from "@/types"

export async function POST(request: Request) {
  const supabase = await createClient()

  // Vérifie que l'utilisateur est connecté
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError(
      "POST /api/planning/generer",
      authError,
      "Tu dois être connecté pour générer un planning.",
      401
    )
  }

  // Semaine cible (US-11/US-14) : lue dans le corps, validée contre la plage de
  // navigation (−12 → +6 semaines) calculée côté serveur — le client n'en est
  // pas l'autorité. Corps absent / sans semaine → défaut (semaine courante, ou
  // prochaine le week-end).
  const corps = (await request.json().catch(() => null)) as {
    semaine?: unknown
  } | null
  let semaine = semaineParDefaut()
  if (corps && typeof corps.semaine === "string") {
    if (!/^\d{4}-W\d{2}$/.test(corps.semaine)) {
      return apiError("POST /api/planning/generer", null, "Semaine invalide.", 400)
    }
    const decalage = decalageEntre(semaineISO(new Date()), corps.semaine)
    if (decalage < -SEMAINES_PASSEES || decalage > SEMAINES_FUTURES) {
      return apiError(
        "POST /api/planning/generer",
        null,
        "Semaine cible hors de la plage autorisée.",
        400
      )
    }
    semaine = corps.semaine
  }

  // Récupère les recettes de l'utilisateur
  const { data: recettes, error: recettesError } = await supabase
    .from("recette")
    .select(`
      id,
      nom,
      temps_preparation,
      vegetarien,
      accompagnement,
      recette_ingredient (
        quantite,
        unite,
        ingredient (
          nom,
          categorie,
          fond_de_placard
        )
      )
    `)

  if (recettesError) {
    return apiError(
      "POST /api/planning/generer",
      recettesError,
      "Impossible de récupérer tes recettes. Réessaie dans quelques instants."
    )
  }

  // Conversion DB → domaine, puis génération (RG-01 à RG-03).
  const recettesDomain = (recettes as unknown as DbRecette[]).map(
    dbRecetteToDomain
  )

  // Réglages de génération personnalisés (#45, P09) : la RLS ne renvoie que la
  // ligne de l'utilisateur (ou aucune → réglages par défaut). Le client n'en
  // est pas l'autorité (les contraintes DB garantissent la validité). En cas
  // d'erreur de lecture, on retombe sur les défauts pour ne pas bloquer la
  // génération (et on le journalise).
  const { data: dbReglages, error: reglagesError } = await supabase
    .from("reglages")
    .select(
      "personnes_defaut, max_dejeuner_semaine, max_diner_semaine, max_dejeuner_weekend, max_diner_weekend, vege_dejeuner_semaine, vege_diner_semaine, vege_dejeuner_weekend, vege_diner_weekend, mix_accompagnement_jour"
    )
    .maybeSingle()
  if (reglagesError) {
    console.error("Lecture des réglages échouée (défauts appliqués).", reglagesError)
  }
  const reglages = dbReglages
    ? dbReglagesToDomain(dbReglages as DbReglages)
    : REGLAGES_DEFAUT

  try {
    const planning = genererPlanning(recettesDomain, semaine, reglages)
    // RG-26 — préférence végé souple : on signale le NOMBRE de repas qui n'ont
    // pas pu être végétariens (vivier insuffisant) sans bloquer la génération.
    // Le client en fait un toast d'information (#86 PR2).
    const vegeNonHonore = slotsVegeNonHonores(planning, reglages).length
    // RG-27 — préférence « ≥1 légume/jour » souple : on signale le NOMBRE de
    // jours sans aucun repas « légumes » (vivier insuffisant), idem (#49 PR2).
    const mixNonHonore = joursSansLegume(planning, reglages).length
    return NextResponse.json(
      { planning, vegeNonHonore, mixNonHonore },
      { status: 200 }
    )
  } catch (erreur) {
    // genererPlanning lève si le vivier est insuffisant (trop peu de recettes
    // rapide/normal pour remplir la semaine) — message actionnable (RG-09).
    return apiError(
      "POST /api/planning/generer",
      erreur,
      "Pas assez de recettes pour générer un planning complet. Ajoute des recettes (notamment rapides ou normales) puis réessaie.",
      422
    )
  }
}
