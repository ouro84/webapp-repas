// Accès aux recettes — lecture côté client (#2, PR1).
//
// Source de vérité des recettes : Supabase (et non plus data/recettes.json,
// qui n'est conservé que comme asset d'amorçage du catalogue global, cf.
// migration ...recettes_globales.sql). La RLS renvoie automatiquement les
// recettes globales (user_id IS NULL) ET celles de l'utilisateur connecté.
//
// La génération du planning, elle, se fait côté serveur (route
// /api/planning/generer). Cette fonction sert les besoins CLIENT qui ont
// besoin de la liste : sélecteur manuel (#14), remplacement aléatoire, et
// l'alerte de vivier (PR3).

import { createClient } from "@/lib/supabase/client"
import { dbRecetteToDomain } from "@/lib/adapters"
import type { DbRecette, Recette } from "@/types"

// Sélection partagée : même forme imbriquée que la route serveur, pour que
// l'adaptateur dbRecetteToDomain s'applique des deux côtés.
const SELECT_RECETTE = `
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
` as const

/**
 * Charge les recettes visibles par l'utilisateur (globales + personnelles).
 * Lève une erreur explicite en cas d'échec réseau / Supabase.
 */
export async function chargerRecettes(): Promise<Recette[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from("recette").select(SELECT_RECETTE)

  if (error) {
    throw new Error(`Chargement des recettes impossible : ${error.message}`)
  }
  return (data as unknown as DbRecette[]).map(dbRecetteToDomain)
}
