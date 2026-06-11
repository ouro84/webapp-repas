// Persistance distante du planning et des coches — sync multi-device (#6) +
// historique multi-semaines (#5). La base Supabase est la source de vérité ;
// localStorage sert de cache.
//
// Lecture/écriture sous RLS propriétaire. Depuis #5 : un planning ET un état de
// coches PAR (user, semaine) — la sauvegarde remplace seulement la semaine
// concernée (upsert par semaine), de sorte que les semaines s'accumulent en
// historique (borné par purge, cf. purgerSemainesAvant). La navigation entre
// semaines est câblée en PR2.

import { createClient } from "@/lib/supabase/client"
import { dbPlanningToDomain } from "@/lib/adapters"
import type { DbPlanningSlot, Planning } from "@/types"

// Sélection imbriquée : le planning, ses slots (avec personnes/restes) et la
// recette complète de chaque slot (avec ingrédients) — nécessaire pour
// reconstruire la liste de courses côté client.
const SELECT_PLANNING = `
  semaine,
  updated_at,
  planning_slot (
    jour,
    type_repas,
    personnes,
    restes,
    recette:recette_id (
      id,
      nom,
      temps_preparation,
      recette_ingredient (
        quantite,
        unite,
        ingredient ( nom, categorie, fond_de_placard )
      )
    )
  )
` as const

/**
 * Planning distant de l'utilisateur + son horodatage (last-write-wins), ou null.
 * Sans `semaine`, renvoie le planning le plus récemment modifié (comportement
 * historique, semaine active). Avec `semaine`, renvoie cette semaine précise
 * (navigation dans l'historique, PR2).
 */
export async function chargerPlanningDistant(semaine?: string): Promise<{
  planning: Planning
  updatedAt: string
} | null> {
  const supabase = createClient()
  let requete = supabase.from("planning").select(SELECT_PLANNING)
  requete = semaine
    ? requete.eq("semaine", semaine)
    : requete.order("updated_at", { ascending: false }).limit(1)

  const { data, error } = await requete.maybeSingle()

  if (error) {
    throw new Error(`Chargement du planning distant impossible : ${error.message}`)
  }
  if (!data) return null

  const row = data as unknown as {
    semaine: string
    updated_at: string
    planning_slot: DbPlanningSlot[]
  }
  return {
    planning: dbPlanningToDomain(row.semaine, row.planning_slot),
    updatedAt: row.updated_at,
  }
}

/** Liste des semaines (ISO) ayant un planning stocké, plus récentes d'abord —
 *  bornes du navigateur d'historique (PR2). */
export async function listerSemainesDistantes(): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("planning")
    .select("semaine")
    .order("semaine", { ascending: false })
  if (error) {
    throw new Error(`Liste des semaines impossible : ${error.message}`)
  }
  return (data ?? []).map((r) => (r as { semaine: string }).semaine)
}

/** Purge l'historique : supprime plannings (slots en cascade) et coches des
 *  semaines strictement antérieures à `cutoff` (rétention, #5). La comparaison
 *  lexicographique des id ISO "AAAA-Wnn" (zéro-paddés) = ordre chronologique. */
export async function purgerSemainesAvant(cutoff: string): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { error: e1 } = await supabase
    .from("planning")
    .delete()
    .eq("user_id", user.id)
    .lt("semaine", cutoff)
  if (e1) throw new Error(`Purge des plannings impossible : ${e1.message}`)

  const { error: e2 } = await supabase
    .from("etat_courses")
    .delete()
    .eq("user_id", user.id)
    .lt("semaine", cutoff)
  if (e2) throw new Error(`Purge des coches impossible : ${e2.message}`)
}

// Construit les lignes planning_slot à insérer depuis un planning domaine.
function construireSlots(
  planningId: string,
  planning: Planning
): Array<{
  planning_id: string
  recette_id: string
  jour: string
  type_repas: "dejeuner" | "diner"
  personnes: number
  restes: boolean
}> {
  const slots = []
  for (const jp of planning.jours) {
    if (jp.dejeuner) {
      slots.push({
        planning_id: planningId,
        recette_id: jp.dejeuner.id,
        jour: jp.jour,
        type_repas: "dejeuner" as const,
        personnes: jp.personnes?.dejeuner ?? 2,
        restes: jp.restes?.dejeuner ?? false,
      })
    }
    slots.push({
      planning_id: planningId,
      recette_id: jp.diner.id,
      jour: jp.jour,
      type_repas: "diner" as const,
      personnes: jp.personnes?.diner ?? 2,
      restes: jp.restes?.diner ?? false,
    })
  }
  return slots
}

/**
 * Persiste le planning d'une semaine : remplace SEULEMENT la semaine concernée
 * (delete (user, semaine) → insert ; les slots partent en cascade). Les autres
 * semaines sont conservées (historique, #5). Non transactionnel côté PostgREST
 * — la robustesse (file de rejeu) vit dans lib/sync.
 */
export async function sauvegarderPlanningDistant(
  planning: Planning
): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Tu dois être connecté pour sauvegarder le planning.")

  const { error: erreurSuppression } = await supabase
    .from("planning")
    .delete()
    .eq("user_id", user.id)
    .eq("semaine", planning.semaine)
  if (erreurSuppression) {
    throw new Error(`Sauvegarde du planning impossible : ${erreurSuppression.message}`)
  }

  // updated_at n'est PAS fourni par le client : un trigger SQL le pose à now()
  // (horloge serveur) à l'insert (#104). On récupère cette valeur via le
  // RETURNING (.select(), qui reflète les triggers BEFORE) et on la renvoie —
  // elle sert d'horloge de référence au last-write-wins (#6, RG-23).
  const { data: cree, error: erreurInsertion } = await supabase
    .from("planning")
    .insert({
      user_id: user.id,
      semaine: planning.semaine,
    })
    .select("id, updated_at")
    .single()
  if (erreurInsertion || !cree) {
    throw new Error(
      `Sauvegarde du planning impossible : ${erreurInsertion?.message ?? "réponse vide"}`
    )
  }

  const { error: erreurSlots } = await supabase
    .from("planning_slot")
    .insert(construireSlots(cree.id, planning))
  if (erreurSlots) {
    throw new Error(`Sauvegarde des repas impossible : ${erreurSlots.message}`)
  }

  return cree.updated_at as string
}

/** Coches distantes d'une semaine (sérialisées comme localStorage) + horodatage, ou null. */
export async function chargerCochesDistantes(semaine: string): Promise<{
  coches: string
  updatedAt: string
} | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("etat_courses")
    .select("coches, updated_at")
    .eq("semaine", semaine)
    .maybeSingle()

  if (error) {
    throw new Error(`Chargement des coches distantes impossible : ${error.message}`)
  }
  if (!data) return null
  return { coches: JSON.stringify(data.coches ?? {}), updatedAt: data.updated_at }
}

/**
 * Persiste l'état des coches d'une semaine (upsert sur (user, semaine)). Renvoie
 * l'`updated_at` (horloge de référence du last-write-wins, comme le planning).
 */
export async function sauvegarderCochesDistantes(
  semaine: string,
  cochesSerialise: string
): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Tu dois être connecté pour sauvegarder les coches.")

  let coches: Record<string, number>
  try {
    coches = JSON.parse(cochesSerialise) as Record<string, number>
  } catch {
    coches = {}
  }

  // updated_at posé par le trigger SQL (now(), horloge serveur) — #104. On le
  // récupère via le RETURNING (.select()) et on le renvoie comme horloge de
  // référence du last-write-wins (signature inchangée).
  const { data: ligne, error } = await supabase
    .from("etat_courses")
    .upsert({
      user_id: user.id,
      semaine,
      coches,
    })
    .select("updated_at")
    .single()
  if (error || !ligne) {
    throw new Error(
      `Sauvegarde des coches impossible : ${error?.message ?? "réponse vide"}`
    )
  }
  return ligne.updated_at as string
}
