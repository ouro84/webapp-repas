// Persistance distante du planning et des coches — synchronisation multi-device
// (#6, US-13). La base Supabase est la source de vérité ; localStorage sert de
// cache (le câblage hydratation/écriture vit dans les pages, PR2/PR3).
//
// Lecture/écriture sous RLS propriétaire (cf. migration ..._sync_planning_coches).
// Mono-actif : un seul planning conservé par utilisateur (l'historique
// multi-semaines est une feature distincte, #P08).

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

/** Planning distant de l'utilisateur + son horodatage (last-write-wins), ou null. */
export async function chargerPlanningDistant(): Promise<{
  planning: Planning
  updatedAt: string
} | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("planning")
    .select(SELECT_PLANNING)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

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
 * Persiste le planning actif (mono-actif) : remplace l'éventuel planning
 * existant de l'utilisateur (delete → insert ; les slots partent en cascade).
 * NB : non transactionnel côté PostgREST — la robustesse (file de rejeu) est
 * ajoutée au câblage (PR2).
 */
export async function sauvegarderPlanningDistant(
  planning: Planning
): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Tu dois être connecté pour sauvegarder le planning.")

  const { error: erreurSuppression } = await supabase
    .from("planning")
    .delete()
    .eq("user_id", user.id)
  if (erreurSuppression) {
    throw new Error(`Sauvegarde du planning impossible : ${erreurSuppression.message}`)
  }

  const { data: cree, error: erreurInsertion } = await supabase
    .from("planning")
    .insert({ user_id: user.id, semaine: planning.semaine })
    .select("id")
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
}

/** Coches distantes de l'utilisateur (sérialisées comme localStorage) + horodatage, ou null. */
export async function chargerCochesDistantes(): Promise<{
  coches: string
  updatedAt: string
} | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("etat_courses")
    .select("coches, updated_at")
    .maybeSingle()

  if (error) {
    throw new Error(`Chargement des coches distantes impossible : ${error.message}`)
  }
  if (!data) return null
  return { coches: JSON.stringify(data.coches ?? {}), updatedAt: data.updated_at }
}

/** Persiste l'état des coches (upsert sur la ligne de l'utilisateur). */
export async function sauvegarderCochesDistantes(
  cochesSerialise: string
): Promise<void> {
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

  const { error } = await supabase.from("etat_courses").upsert({
    user_id: user.id,
    coches,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    throw new Error(`Sauvegarde des coches impossible : ${error.message}`)
  }
}
