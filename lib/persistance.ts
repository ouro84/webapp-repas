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
 *  lexicographique des id ISO "AAAA-Wnn" (zéro-paddés) = ordre chronologique.
 *  La RLS « foyer » (#56) restreint déjà aux lignes du foyer courant : pas de
 *  filtre d'appartenance ici, juste la borne (qui satisfait aussi l'exigence
 *  PostgREST d'un filtre sur tout DELETE). */
export async function purgerSemainesAvant(cutoff: string): Promise<void> {
  const supabase = createClient()

  const { error: e1 } = await supabase
    .from("planning")
    .delete()
    .lt("semaine", cutoff)
  if (e1) throw new Error(`Purge des plannings impossible : ${e1.message}`)

  const { error: e2 } = await supabase
    .from("etat_courses")
    .delete()
    .lt("semaine", cutoff)
  if (e2) throw new Error(`Purge des coches impossible : ${e2.message}`)
}

// Construit les slots à passer à la RPC sauvegarder_planning (sans planning_id :
// la RPC crée/retrouve la ligne planning et rattache les slots côté serveur).
function construireSlots(planning: Planning): Array<{
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
        recette_id: jp.dejeuner.id,
        jour: jp.jour,
        type_repas: "dejeuner" as const,
        personnes: jp.personnes?.dejeuner ?? 2,
        restes: jp.restes?.dejeuner ?? false,
      })
    }
    slots.push({
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
 * Persiste le planning d'une semaine via la RPC ATOMIQUE `sauvegarder_planning`
 * (#56 PR2) : upsert de la ligne planning (par foyer+semaine, conserve la même
 * ligne → la colonne `version` s'incrémente) + remplacement intégral des slots,
 * le tout en une transaction côté serveur. Le foyer est dérivé de mon_foyer()
 * (SECURITY DEFINER) — le client n'a pas à le connaître. Remplace l'ancien
 * delete→insert client non atomique (race cross-device à deux appareils).
 * Renvoie l'updated_at posé par le trigger serveur (#104), horloge de référence
 * du last-write-wins (#6, RG-23). Les autres semaines sont conservées (#5).
 */
export async function sauvegarderPlanningDistant(
  planning: Planning
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("sauvegarder_planning", {
    p_semaine: planning.semaine,
    p_slots: construireSlots(planning),
  })
  if (error || !data) {
    throw new Error(
      `Sauvegarde du planning impossible : ${error?.message ?? "réponse vide"}`
    )
  }
  return data as string
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
 * Persiste l'état des coches d'une semaine via la RPC `sauvegarder_coches`
 * (#56 PR2 ; upsert par foyer+semaine, foyer dérivé de mon_foyer()). Renvoie
 * l'`updated_at` posé par le trigger serveur (#104), horloge de référence du
 * last-write-wins (comme le planning).
 */
export async function sauvegarderCochesDistantes(
  semaine: string,
  cochesSerialise: string
): Promise<string> {
  const supabase = createClient()

  let coches: Record<string, number>
  try {
    coches = JSON.parse(cochesSerialise) as Record<string, number>
  } catch {
    coches = {}
  }

  const { data, error } = await supabase.rpc("sauvegarder_coches", {
    p_semaine: semaine,
    p_coches: coches,
  })
  if (error || !data) {
    throw new Error(
      `Sauvegarde des coches impossible : ${error?.message ?? "réponse vide"}`
    )
  }
  return data as string
}
