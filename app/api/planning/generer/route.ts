import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { genererPlanning } from "@/lib/generateur"
import { dbRecetteToDomain } from "@/lib/adapters"
import type { DbRecette } from "@/types"

export async function POST() {
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

  // Récupère les recettes de l'utilisateur
  const { data: recettes, error: recettesError } = await supabase
    .from("recette")
    .select(`
      id,
      nom,
      temps_preparation,
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

  try {
    const planning = genererPlanning(recettesDomain)
    return NextResponse.json({ planning }, { status: 200 })
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
