// Outil MCP ajouter_recette (#306, US-52, RG-76).
//
// Crée une recette DU FOYER (jamais au catalogue global : `foyer_id` prend son
// défaut mon_foyer() sous RLS, RG-71), avec la même validation que le
// formulaire de l'UI (validerSaisieRecette) et ses mêmes suggestions pour les
// champs omis (végétarien, accompagnement, saisons). OMQ n'appelle aucun LLM :
// l'assistant structure la recette, OMQ la contrôle.

import { creerRecette, type SaisieRecette } from "@/lib/recettes"
import { validerSaisieRecette } from "@/lib/validation-recette"
import { normaliser } from "@/lib/recherche"
import { suggererAccompagnement } from "@/lib/accompagnement"
import { suggererSaisons } from "@/lib/saisons"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import type { ClientSupabase } from "@/lib/supabase/types"
import type {
  Accompagnement,
  CategorieIngredient,
  Ingredient,
  Saison,
  TempsPreparation,
  Unite,
} from "@/types"

export type SaisieRecetteMcp = {
  nom: string
  temps_preparation: TempsPreparation
  vegetarien?: boolean
  accompagnement?: Accompagnement | null
  saisons?: Saison[]
  etapes?: string[]
  ingredients: Array<{
    nom: string
    quantite: number
    unite: Unite
    categorie: CategorieIngredient
    fond_de_placard?: boolean
  }>
}

export type RecetteAjouteeMcp = {
  recette: {
    nom: string
    temps_preparation: TempsPreparation
    vegetarien: boolean
    ingredients: number
    etapes: number
  }
}

type RecetteDuFoyer = {
  nom: string
  temps_preparation: string
  recette_ingredient: Array<{ ingredient: { nom: string } | null }> | null
}

// Saisie MCP → saisie du formulaire, champs omis = suggestions du formulaire.
function versSaisie(args: SaisieRecetteMcp): SaisieRecette {
  const ingredients: Ingredient[] = args.ingredients.map((i) => ({
    nom: i.nom.trim(),
    quantite: i.quantite,
    unite: i.unite,
    categorie: i.categorie,
    fondDePlacard: i.fond_de_placard === true,
  }))
  return {
    nom: args.nom.trim(),
    tempsPreparation: args.temps_preparation,
    vegetarien: args.vegetarien ?? ingredients.every((i) => i.categorie !== "viandes-poissons"),
    accompagnement: args.accompagnement !== undefined ? args.accompagnement : suggererAccompagnement(ingredients),
    saisons: args.saisons ?? suggererSaisons(ingredients),
    etapes: (args.etapes ?? []).map((e) => e.trim()).filter((e) => e !== ""),
    ingredients,
  }
}

/**
 * `ajouter_recette` (RG-76) : refuse si une recette du foyer porte déjà ce nom
 * (casse et accents ignorés) et la décrit, pour que l'assistant la réutilise.
 */
export async function ajouterRecette(
  supabase: ClientSupabase,
  auteurId: string,
  args: SaisieRecetteMcp
): Promise<RecetteAjouteeMcp> {
  const saisie = versSaisie(args)
  const invalide = validerSaisieRecette(saisie)
  if (invalide) throw new ErreurOutil(invalide)

  // RLS : recettes globales + du foyer ; `foyer_id` non nul = du foyer.
  const { data, error } = await supabase
    .from("recette")
    .select("nom, temps_preparation, recette_ingredient ( ingredient ( nom ) )")
    .not("foyer_id", "is", null)
  if (error) throw new Error(`Lecture des recettes du foyer impossible : ${error.message}`)
  const existante = ((data ?? []) as unknown as RecetteDuFoyer[]).find(
    (r) => normaliser(r.nom) === normaliser(saisie.nom)
  )
  if (existante) {
    const ingredients = (existante.recette_ingredient ?? [])
      .flatMap((l) => (l.ingredient ? [l.ingredient.nom] : []))
      .join(", ")
    throw new ErreurOutil(
      `Le foyer a déjà une recette « ${existante.nom} » (${existante.temps_preparation}, ingrédients : ${ingredients}). Utilise remplacer_repas avec ce nom, ou choisis un autre nom.`
    )
  }

  await creerRecette(saisie, supabase, auteurId)
  return {
    recette: {
      nom: saisie.nom,
      temps_preparation: saisie.tempsPreparation,
      vegetarien: saisie.vegetarien,
      ingredients: saisie.ingredients.length,
      etapes: saisie.etapes.length,
    },
  }
}
