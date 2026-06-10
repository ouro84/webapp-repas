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
import type {
  Accompagnement,
  DbRecette,
  Ingredient,
  Recette,
  Saison,
} from "@/types"

// Données d'un formulaire de recette (création/édition) — sans id (généré par
// la base) ni user_id (posé à l'enregistrement depuis la session).
export type SaisieRecette = {
  nom: string
  tempsPreparation: Recette["tempsPreparation"]
  vegetarien: boolean
  // Accompagnement (#49) : `null` = non caractérisé (l'utilisateur peut laisser
  // « Aucun »).
  accompagnement: Accompagnement | null
  // Saisons (#23) : liste (éventuellement vide = toute l'année).
  saisons: Saison[]
  ingredients: Ingredient[]
}

// Sélection partagée : même forme imbriquée que la route serveur, pour que
// l'adaptateur dbRecetteToDomain s'applique des deux côtés.
const SELECT_RECETTE = `
  id,
  nom,
  temps_preparation,
  vegetarien,
  accompagnement,
  saisons,
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

// Recette annotée pour la page de gestion : `editable` distingue les recettes
// personnelles (modifiables) des recettes globales (catalogue, lecture seule).
export type RecetteGeree = { recette: Recette; editable: boolean }

/**
 * Charge les recettes pour la page de gestion (#2), en marquant celles qui
 * appartiennent à l'utilisateur (les globales, user_id NULL, sont en lecture
 * seule — cf. RLS).
 */
export async function chargerRecettesGerees(): Promise<RecetteGeree[]> {
  const supabase = createClient()
  const [{ data, error }, { data: { user } }] = await Promise.all([
    supabase.from("recette").select(`user_id, ${SELECT_RECETTE}`),
    supabase.auth.getUser(),
  ])

  if (error) {
    throw new Error(`Chargement des recettes impossible : ${error.message}`)
  }
  return (data as unknown as (DbRecette & { user_id: string | null })[]).map(
    (db) => ({
      recette: dbRecetteToDomain(db),
      editable: db.user_id !== null && db.user_id === user?.id,
    })
  )
}

// ============================================================================
// Écritures (recettes personnelles) — #2 PR2
// ============================================================================

type Client = ReturnType<typeof createClient>

/**
 * Find-or-create d'un ingrédient du catalogue, identifié par le triplet
 * (nom, catégorie, fond de placard) — pas d'unicité SQL sur le nom seul, on
 * déduplique donc explicitement pour ne pas gonfler le catalogue partagé.
 * Retourne l'id de l'ingrédient.
 */
async function trouverOuCreerIngredient(
  client: Client,
  ingredient: Ingredient
): Promise<string> {
  const { data: existant, error: erreurLecture } = await client
    .from("ingredient")
    .select("id")
    .eq("nom", ingredient.nom)
    .eq("categorie", ingredient.categorie)
    .eq("fond_de_placard", ingredient.fondDePlacard)
    .limit(1)
    .maybeSingle()

  if (erreurLecture) {
    throw new Error(`Lecture d'un ingrédient impossible : ${erreurLecture.message}`)
  }
  if (existant) return existant.id

  const { data: cree, error: erreurInsertion } = await client
    .from("ingredient")
    .insert({
      nom: ingredient.nom,
      categorie: ingredient.categorie,
      fond_de_placard: ingredient.fondDePlacard,
    })
    .select("id")
    .single()

  if (erreurInsertion || !cree) {
    throw new Error(
      `Création d'un ingrédient impossible : ${erreurInsertion?.message ?? "réponse vide"}`
    )
  }
  return cree.id
}

// Lie les ingrédients saisis à une recette : résout chaque ingrédient
// (find-or-create) puis insère les lignes recette_ingredient.
async function lierIngredients(
  client: Client,
  recetteId: string,
  ingredients: Ingredient[]
): Promise<void> {
  const liens = await Promise.all(
    ingredients.map(async (ing) => ({
      recette_id: recetteId,
      ingredient_id: await trouverOuCreerIngredient(client, ing),
      quantite: ing.quantite,
      unite: ing.unite,
    }))
  )
  const { error } = await client.from("recette_ingredient").insert(liens)
  if (error) {
    throw new Error(`Enregistrement des ingrédients impossible : ${error.message}`)
  }
}

/**
 * Crée une recette personnelle (RLS : user_id = utilisateur courant).
 * Retourne la recette créée en domaine (avec son id de base).
 */
export async function creerRecette(saisie: SaisieRecette): Promise<Recette> {
  const client = createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error("Tu dois être connecté pour enregistrer une recette.")

  const { data: recette, error } = await client
    .from("recette")
    .insert({
      nom: saisie.nom,
      temps_preparation: saisie.tempsPreparation,
      vegetarien: saisie.vegetarien,
      accompagnement: saisie.accompagnement,
      saisons: saisie.saisons.length > 0 ? saisie.saisons : null,
      user_id: user.id,
    })
    .select("id")
    .single()

  if (error || !recette) {
    throw new Error(`Création de la recette impossible : ${error?.message ?? "réponse vide"}`)
  }

  await lierIngredients(client, recette.id, saisie.ingredients)

  return saisieVersRecette(recette.id, saisie)
}

// Reconstruit une Recette domaine depuis une saisie enregistrée, en omettant
// l'accompagnement quand il est `null` (cohérent avec l'optionnalité du champ).
function saisieVersRecette(id: string, saisie: SaisieRecette): Recette {
  const recette: Recette = {
    id,
    nom: saisie.nom,
    tempsPreparation: saisie.tempsPreparation,
    vegetarien: saisie.vegetarien,
    ingredients: saisie.ingredients,
  }
  if (saisie.accompagnement) recette.accompagnement = saisie.accompagnement
  if (saisie.saisons.length > 0) recette.saisons = saisie.saisons
  return recette
}

/**
 * Modifie une recette personnelle existante (RG-02 : déclenché par
 * « Enregistrer »). Réconcilie les ingrédients en remplaçant l'ensemble des
 * liens (simple et sûr : delete puis re-insert). Retourne la recette à jour.
 */
export async function modifierRecette(
  id: string,
  saisie: SaisieRecette
): Promise<Recette> {
  const client = createClient()

  const { error: erreurRecette } = await client
    .from("recette")
    .update({
      nom: saisie.nom,
      temps_preparation: saisie.tempsPreparation,
      vegetarien: saisie.vegetarien,
      accompagnement: saisie.accompagnement,
      saisons: saisie.saisons.length > 0 ? saisie.saisons : null,
    })
    .eq("id", id)

  if (erreurRecette) {
    throw new Error(`Modification de la recette impossible : ${erreurRecette.message}`)
  }

  // Remplacement intégral des liens ingrédients.
  const { error: erreurSuppression } = await client
    .from("recette_ingredient")
    .delete()
    .eq("recette_id", id)
  if (erreurSuppression) {
    throw new Error(`Mise à jour des ingrédients impossible : ${erreurSuppression.message}`)
  }
  await lierIngredients(client, id, saisie.ingredients)

  return saisieVersRecette(id, saisie)
}

/**
 * Supprime une recette personnelle (RG-01 : la confirmation est gérée par
 * l'UI en amont). La RLS interdit la suppression d'une recette globale ou
 * d'autrui ; les liens recette_ingredient partent en cascade (FK).
 */
export async function supprimerRecette(id: string): Promise<void> {
  const client = createClient()
  const { error } = await client.from("recette").delete().eq("id", id)
  if (error) {
    throw new Error(`Suppression impossible : ${error.message}`)
  }
}
