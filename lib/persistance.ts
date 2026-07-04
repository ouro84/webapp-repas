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
import { LONGUEUR_DEFAUT } from "@/lib/cycles"
import type { DbPlanningSlot, Planning } from "@/types"

// Sélection imbriquée : le planning, ses slots (avec personnes/restes) et la
// recette complète de chaque slot (avec ingrédients) — nécessaire pour
// reconstruire la liste de courses côté client.
//
// ⚠️ La recette DOIT inclure `vegetarien`, `accompagnement`, `saisons` et
// `etapes` (#164, #233) : sans eux, un planning hydraté depuis la base (2ᵉ
// appareil, navigation entre semaines, cache évincé) perd ces données → badges
// manquants (US-10/RG-20), étapes manquantes (RG-43) et biais végé/légumes/saison
// faussés (joursSansLegume, slotsVegeNonHonores, reposNonSaison, remplacerSlot).
// Doit rester aligné avec SELECT_RECETTE de lib/recettes.ts et la route de
// génération. Exporté pour la garde de test.
export const SELECT_PLANNING = `
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
      vegetarien,
      accompagnement,
      saisons,
      etapes,
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

/** Purge l'historique : supprime les plannings (slots en cascade) des semaines
 *  strictement antérieures à `cutoff` (rétention, #5). La comparaison
 *  lexicographique des id ISO "AAAA-Wnn" (zéro-paddés) = ordre chronologique.
 *  La RLS « foyer » (#56) restreint déjà aux lignes du foyer courant : pas de
 *  filtre d'appartenance ici, juste la borne (qui satisfait aussi l'exigence
 *  PostgREST d'un filtre sur tout DELETE). Le volet coches est purgé
 *  séparément par `purgerCyclesAvant` (#257, ancre ≠ semaine). */
export async function purgerSemainesAvant(cutoff: string): Promise<void> {
  const supabase = createClient()

  const { error: e1 } = await supabase
    .from("planning")
    .delete()
    .lt("semaine", cutoff)
  if (e1) throw new Error(`Purge des plannings impossible : ${e1.message}`)
}

/** Purge des coches des cycles dont l'ancre est antérieure au cutoff (#257). */
export async function purgerCyclesAvant(cutoffAncre: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article").delete().lt("ancre", cutoffAncre)
  if (error) throw new Error(`Purge coches impossible : ${error.message}`)
  // cycle_courses : purge des longueurs obsolètes.
  await supabase.from("cycle_courses").delete().lt("ancre", cutoffAncre)
}

/** Foyer de l'utilisateur courant (pour scoper les canaux temps réel par foyer,
 *  #56 PR4). La RLS de `profiles` ne renvoie que la ligne du membre courant. */
export async function chargerFoyerId(): Promise<string | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("foyer_id")
    .maybeSingle()
  if (error) {
    throw new Error(`Chargement du foyer impossible : ${error.message}`)
  }
  return (data as { foyer_id: string } | null)?.foyer_id ?? null
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

// Construit les slots d'une liste de jours (génération fenêtrée #259) — même
// forme que construireSlots mais sur un sous-ensemble de jours (les jours du
// cycle tombant dans UNE semaine ISO). Réutilise la logique par jour.
function construireSlotsJours(jours: Planning["jours"]): ReturnType<typeof construireSlots> {
  return construireSlots({ semaine: "", jours })
}

/**
 * Persiste SEULEMENT les slots fournis d'une semaine via la RPC ATOMIQUE
 * `sauvegarder_slots` (#259) : upsert des (jour, type_repas) fournis sans toucher
 * aux autres jours de la semaine (contrairement à sauvegarder_planning qui
 * remplace toute la semaine). Utilisée par la génération fenêtrée « Générer mon
 * cycle » : un cycle non calendaire ne couvre qu'une partie de chaque semaine ISO
 * touchée. Renvoie l'updated_at posé par le trigger serveur (#104).
 */
export async function sauvegarderSlotsDistant(
  semaine: string,
  jours: Planning["jours"]
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("sauvegarder_slots", {
    p_semaine: semaine,
    p_slots: construireSlotsJours(jours),
  })
  if (error || !data) {
    throw new Error(
      `Sauvegarde des slots impossible : ${error?.message ?? "réponse vide"}`
    )
  }
  return data as string
}

/**
 * Coches distantes d'une ancre de cycle, reconstruites en blob `{ "nom|unité":
 * quantité }` depuis les lignes par-article (#56 PR4, #257). Renvoie un objet
 * vide si aucune ligne (pas de null : l'absence de coche = blob vide).
 */
export async function chargerCochesDistantes(
  ancre: string
): Promise<Record<string, number>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("etat_courses_article")
    .select("cle, quantite")
    .eq("ancre", ancre)

  if (error) {
    throw new Error(`Chargement des coches distantes impossible : ${error.message}`)
  }
  const coches: Record<string, number> = {}
  for (const ligne of (data ?? []) as Array<{ cle: string; quantite: number }>) {
    coches[ligne.cle] = ligne.quantite
  }
  return coches
}

// ---------------------------------------------------------------------------
// Écritures par-article (#56 PR4) — accès DIRECT sous RLS « foyer » (chaque
// opération porte sur UNE ligne, donc atomique : plus besoin de RPC comme pour
// le blob). foyer_id est posé par le default mon_foyer() : le client ne le
// fournit jamais. L'anti-clobber (RG-32) vient de la granularité par-article.
// ---------------------------------------------------------------------------

/** Coche un article (upsert d'une ligne ; mémorise la quantité pour RG-12). */
export async function cocherArticleDistant(
  ancre: string,
  cle: string,
  quantite: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article")
    .upsert(
      { ancre, cle, quantite },
      { onConflict: "foyer_id,ancre,cle" }
    )
  if (error) {
    throw new Error(`Cochage impossible : ${error.message}`)
  }
}

/** Décoche un article (delete de sa ligne ; le foyer est filtré par la RLS). */
export async function decocherArticleDistant(
  ancre: string,
  cle: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article")
    .delete()
    .eq("ancre", ancre)
    .eq("cle", cle)
  if (error) {
    throw new Error(`Décochage impossible : ${error.message}`)
  }
}

/** Vide toutes les coches d'une ancre de cycle (« Tout décocher » /
 *  régénération RG-13). Un seul DELETE par ancre plutôt que N décochages. */
export async function viderCochesDistantes(ancre: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article")
    .delete()
    .eq("ancre", ancre)
  if (error) {
    throw new Error(`Vidage des coches impossible : ${error.message}`)
  }
}

/** Longueur persistée d'un cycle (défaut LONGUEUR_DEFAUT si aucune ligne,
 *  #257). Best-effort : une erreur de lecture retombe sur le défaut plutôt que
 *  de bloquer l'affichage de la liste de courses. */
export async function chargerLongueurCycle(ancre: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("cycle_courses").select("longueur").eq("ancre", ancre).maybeSingle()
  if (error) return LONGUEUR_DEFAUT
  return data?.longueur ?? LONGUEUR_DEFAUT
}

/** Écrit la longueur d'un cycle (upsert) ; supprime la ligne si elle revient
 *  au défaut (#257 — pas de ligne = comportement par défaut implicite). */
export async function definirLongueurCycle(ancre: string, longueur: number): Promise<void> {
  const supabase = createClient()
  if (longueur === LONGUEUR_DEFAUT) {
    const { error } = await supabase.from("cycle_courses").delete().eq("ancre", ancre)
    if (error) throw new Error(`Réglage cycle impossible : ${error.message}`)
    return
  }
  const { error } = await supabase
    .from("cycle_courses").upsert({ ancre, longueur }, { onConflict: "foyer_id,ancre" })
  if (error) throw new Error(`Réglage cycle impossible : ${error.message}`)
}
