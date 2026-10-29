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
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"
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
  // Étapes de préparation (#233) : liste ordonnée (éventuellement vide).
  etapes: string[]
  ingredients: Ingredient[]
}

// Sélection partagée : réutilisée telle quelle par la génération serveur
// (lib/generation.ts, #304), pour que l'adaptateur dbRecetteToDomain
// s'applique des deux côtés.
export const SELECT_RECETTE = `
  id,
  nom,
  temps_preparation,
  vegetarien,
  accompagnement,
  saisons,
  etapes,
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

// Client injectable (#306) : navigateur par défaut, client « par jeton » côté
// serveur MCP (RLS mon_foyer(), RG-71).
type Client = ClientSupabase

/**
 * Ids des recettes « supprimées » (masquées) par l'utilisateur courant (#105).
 * La RLS de recette_masquee ne renvoie que les lignes de l'utilisateur → pas
 * besoin de filtrer par user_id. Set vide si aucune. Sert à exclure les recettes
 * masquées du catalogue partout côté client (génération : filtrage serveur).
 */
async function chargerIdsMasques(client: Client): Promise<Set<string>> {
  const { data, error } = await client
    .from("recette_masquee")
    .select("recette_id")
  if (error) {
    throw new Error(`Chargement des recettes masquées impossible : ${error.message}`)
  }
  return new Set((data ?? []).map((r) => (r as { recette_id: string }).recette_id))
}

/**
 * Charge les recettes visibles par l'utilisateur (globales + personnelles),
 * EXCLUANT celles qu'il a supprimées (masquées, #105).
 * Lève une erreur explicite en cas d'échec réseau / Supabase.
 */
export async function chargerRecettes(
  supabase: ClientSupabase = clientParDefaut()
): Promise<Recette[]> {
  const [{ data, error }, masques] = await Promise.all([
    supabase.from("recette").select(SELECT_RECETTE),
    chargerIdsMasques(supabase),
  ])

  if (error) {
    throw new Error(`Chargement des recettes impossible : ${error.message}`)
  }
  return (data as unknown as DbRecette[])
    .map(dbRecetteToDomain)
    .filter((r) => !masques.has(r.id))
}

// Recette annotée pour la page de gestion : `editable` distingue les recettes
// personnelles (modifiables) des recettes globales (catalogue, lecture seule).
export type RecetteGeree = { recette: Recette; editable: boolean }

/**
 * Charge les recettes pour la page de gestion (#2), en marquant celles qui sont
 * éditables. Depuis le scope foyer (#56 PR2), une recette est éditable par TOUT
 * membre du foyer (RG-30) → `editable` = « c'est une recette du foyer », càd
 * `foyer_id !== null` (les globales, foyer_id NULL, restent en lecture seule —
 * cf. RLS). Plus besoin de comparer au user courant.
 */
export async function chargerRecettesGerees(): Promise<RecetteGeree[]> {
  const supabase = createClient()
  const [{ data, error }, masques] = await Promise.all([
    supabase.from("recette").select(`foyer_id, ${SELECT_RECETTE}`),
    chargerIdsMasques(supabase),
  ])

  if (error) {
    throw new Error(`Chargement des recettes impossible : ${error.message}`)
  }
  return (data as unknown as (DbRecette & { foyer_id: string | null })[])
    .filter((db) => !masques.has(db.id))
    .map((db) => ({
      recette: dbRecetteToDomain(db),
      editable: db.foyer_id !== null,
    }))
}

// ============================================================================
// Écritures (recettes personnelles) — #2 PR2
// ============================================================================

// Relit l'id d'un ingrédient par son triplet d'identité (nom, catégorie, fond
// de placard). Sert au find-or-create et au repli en cas de course concurrente.
async function lireIngredientParTriplet(
  client: Client,
  ingredient: Ingredient
): Promise<string | null> {
  const { data, error } = await client
    .from("ingredient")
    .select("id")
    .eq("nom", ingredient.nom)
    .eq("categorie", ingredient.categorie)
    .eq("fond_de_placard", ingredient.fondDePlacard)
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`Lecture d'un ingrédient impossible : ${error.message}`)
  }
  return data?.id ?? null
}

/**
 * Find-or-create d'un ingrédient du catalogue, identifié par le triplet
 * (nom, catégorie, fond de placard). La contrainte UNIQUE (#193, audit F-06)
 * garantit l'unicité côté base ; on déduplique aussi côté client (fast path)
 * et on gère la COURSE concurrente : si un autre insert crée le même triplet
 * entre notre SELECT et notre INSERT, la contrainte lève 23505 → on relit la
 * ligne gagnante au lieu d'échouer. Retourne l'id de l'ingrédient.
 */
async function trouverOuCreerIngredient(
  client: Client,
  ingredient: Ingredient
): Promise<string> {
  const existant = await lireIngredientParTriplet(client, ingredient)
  if (existant) return existant

  const { data: cree, error: erreurInsertion } = await client
    .from("ingredient")
    .insert({
      nom: ingredient.nom,
      categorie: ingredient.categorie,
      fond_de_placard: ingredient.fondDePlacard,
    })
    .select("id")
    .single()

  if (cree) return cree.id

  // 23505 = unique_violation : course concurrente sur le même triplet → relire.
  if (erreurInsertion?.code === "23505") {
    const apresCourse = await lireIngredientParTriplet(client, ingredient)
    if (apresCourse) return apresCourse
  }

  throw new Error(
    `Création d'un ingrédient impossible : ${erreurInsertion?.message ?? "réponse vide"}`
  )
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
 *
 * `auteurId` (#306) : fourni par le serveur MCP, dont le client « par jeton »
 * n'a pas de session pour `auth.getUser()`. Sans lui (web), l'auteur est lu
 * dans la session.
 */
export async function creerRecette(
  saisie: SaisieRecette,
  client: ClientSupabase = clientParDefaut(),
  auteurId?: string
): Promise<Recette> {
  let userId = auteurId
  if (!userId) {
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) throw new Error("Tu dois être connecté pour enregistrer une recette.")
    userId = user.id
  }

  const { data: recette, error } = await client
    .from("recette")
    .insert({
      nom: saisie.nom,
      temps_preparation: saisie.tempsPreparation,
      vegetarien: saisie.vegetarien,
      accompagnement: saisie.accompagnement,
      saisons: saisie.saisons.length > 0 ? saisie.saisons : null,
      etapes: saisie.etapes.length > 0 ? saisie.etapes : null,
      user_id: userId,
    })
    .select("id")
    .single()

  if (error || !recette) {
    throw new Error(`Création de la recette impossible : ${error?.message ?? "réponse vide"}`)
  }

  try {
    await lierIngredients(client, recette.id, saisie.ingredients)
  } catch (erreur) {
    // Pas de recette orpheline sans ingrédients (#306) : elle serait tirée par
    // la génération et bloquerait un nouvel essai sous le même nom.
    const { error: erreurSuppression } = await client.from("recette").delete().eq("id", recette.id)
    if (erreurSuppression) console.error("Recette orpheline non supprimée.", erreurSuppression)
    throw erreur
  }

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
  if (saisie.etapes.length > 0) recette.etapes = saisie.etapes
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
      etapes: saisie.etapes.length > 0 ? saisie.etapes : null,
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
 * Supprime une recette personnelle (la confirmation/undo est gérée par l'UI).
 * La RLS interdit la suppression d'une recette globale ou d'autrui ; les liens
 * recette_ingredient partent en cascade (FK).
 */
export async function supprimerRecette(id: string): Promise<void> {
  const client = createClient()
  const { error } = await client.from("recette").delete().eq("id", id)
  if (error) {
    throw new Error(`Suppression impossible : ${error.message}`)
  }
}

// ============================================================================
// Masquage des recettes par défaut — « Supprimer » sur le catalogue (#105 PR1)
// ============================================================================
//
// Le catalogue (user_id IS NULL) est partagé en lecture seule : on ne peut pas
// le détruire. « Supprimer » une recette par défaut = l'inscrire dans
// recette_masquee (propre à l'utilisateur). C'est réversible (undo transitoire,
// même esprit que l'undo planning US-09) via demasquerRecette.

/**
 * Masque (« supprime » côté UX) une recette par défaut pour l'utilisateur
 * courant. Idempotent du point de vue UX : si déjà masquée, la PK rejette le
 * doublon — on remonte l'erreur, l'appelant ne devrait pas y arriver (la
 * recette n'est plus listée une fois masquée).
 */
export async function masquerRecette(recetteId: string): Promise<void> {
  const client = createClient()
  // foyer_id est rempli par le default mon_foyer() (#56 PR2) ; le masquage
  // devient propre au foyer. La RLS insert (with check foyer_id = mon_foyer())
  // rejette si non connecté.
  const { error } = await client
    .from("recette_masquee")
    .insert({ recette_id: recetteId })
  if (error) {
    throw new Error(`Suppression impossible : ${error.message}`)
  }
}

/**
 * Démasque une recette par défaut : inverse de masquerRecette, utilisé par
 * l'« Annuler » (undo) du toast de suppression.
 */
export async function demasquerRecette(recetteId: string): Promise<void> {
  const client = createClient()
  const { error } = await client
    .from("recette_masquee")
    .delete()
    .eq("recette_id", recetteId)
  if (error) {
    throw new Error(`Annulation impossible : ${error.message}`)
  }
}

/**
 * Convertit une recette domaine en saisie de formulaire (#105) : sert à RECRÉER
 * une recette personnelle supprimée lors d'un « Annuler » (undo). Les flags
 * optionnels absents reprennent leurs valeurs neutres.
 */
export function recetteVersSaisie(recette: Recette): SaisieRecette {
  return {
    nom: recette.nom,
    tempsPreparation: recette.tempsPreparation,
    vegetarien: recette.vegetarien ?? false,
    accompagnement: recette.accompagnement ?? null,
    saisons: recette.saisons ?? [],
    etapes: recette.etapes ?? [],
    ingredients: recette.ingredients,
  }
}
