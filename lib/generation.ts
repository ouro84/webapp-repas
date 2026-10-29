// Génération d'un planning côté serveur, EN TANT QUE l'utilisateur (#304).
//
// Logique extraite de POST /api/planning/generer pour être partagée par la
// route (web) et le serveur MCP (#305/#306, RG-74) : le client Supabase est
// INJECTÉ (client à cookies côté route, client « par jeton » côté MCP) et la
// RLS mon_foyer() borne toutes les lectures au foyer de l'utilisateur (RG-71).
// Aucune persistance ici : le web écrit via `sauvegarder_cycle` /
// `sauvegarder_planning`, le MCP fera de même (règle du jumeau, RG-79).

import {
  FENETRE_VARIETE,
  genererPlanning,
  joursSansLegume,
  reposNonSaison,
  slotsVegeNonHonores,
  type HistoriqueVariete,
  type PreferencesRecettes,
  type RecettePreference,
} from "@/lib/generateur"
import {
  decalageEntre,
  semaineDecalee,
  semaineISO,
  semaineParDefaut,
} from "@/lib/semaines"
import {
  dateVersSemaineJour,
  LONGUEUR_DEFAUT,
  LONGUEUR_MAX,
  planningGenereParSemaine,
} from "@/lib/cycles"
import { dbRecetteToDomain } from "@/lib/adapters"
import { dbReglagesToDomain, REGLAGES_DEFAUT } from "@/lib/reglages"
import { SELECT_RECETTE } from "@/lib/recettes"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { DbRecette, DbReglages, Planning, SemaineGeneree } from "@/types"

// Plage de génération autorisée (#5, RG-24, RG-73) : navigation historique
// −12 → +6 semaines autour de la semaine courante.
export const SEMAINES_PASSEES = 12
export const SEMAINES_FUTURES = 6

/**
 * Demande de génération, deux modes exclusifs (#259) :
 *  • SEMAINE (US-11/US-14, /planning) : `{ semaine? }` → 14 slots de cette
 *    semaine ISO (défaut : semaineParDefaut, la suivante le week-end) ;
 *  • CYCLE (US-48, « Générer mon cycle ») : `{ ancre, longueur? }` → les jours
 *    du cycle (fenêtre non calendaire), répartis par semaine ISO touchée.
 */
export type DemandeGeneration = { semaine?: string } | { ancre: string; longueur?: number }

/** Préférences souples non honorées, dérivées du planning final (RG-26/27/28). */
export type AvertissementsGeneration = {
  vegeNonHonore: number
  mixNonHonore: number
  saisonNonHonore: number
}

export type ResultatGeneration =
  | ({ mode: "semaine"; planning: Planning } & AvertissementsGeneration)
  | ({
      mode: "cycle"
      ancre: string
      longueur: number
      semaines: SemaineGeneree[]
    } & AvertissementsGeneration)

/** Échec de génération porteur de son statut HTTP et d'un message actionnable. */
export class ErreurGeneration extends Error {
  readonly statut: 400 | 422 | 500
  readonly cause?: unknown

  constructor(message: string, statut: 400 | 422 | 500, cause?: unknown) {
    super(message)
    this.name = "ErreurGeneration"
    this.statut = statut
    this.cause = cause
  }
}

/**
 * Génère un planning (semaine) ou un cycle pour l'utilisateur du client
 * injecté. Lève `ErreurGeneration` (400 entrée invalide ou hors plage, 500
 * recettes illisibles, 422 vivier insuffisant). `aujourdhui` sert aux tests.
 */
export async function genererPourUtilisateur(
  supabase: ClientSupabase,
  demande: DemandeGeneration,
  options: { aujourdhui?: Date } = {}
): Promise<ResultatGeneration> {
  const aujourdhui = options.aujourdhui ?? new Date()
  const semaineCourante = semaineISO(aujourdhui)
  const modeCycle = "ancre" in demande

  // Semaine cible de la GÉNÉRATION (et de l'historique de variété). En mode
  // cycle, c'est la semaine ISO de l'ancre (saison = ancre du cycle, cf. design).
  // La plage est validée ici, côté serveur : le client n'en est pas l'autorité.
  let semaine = semaineParDefaut(aujourdhui)
  let ancre = ""
  let longueur = LONGUEUR_DEFAUT

  if ("ancre" in demande) {
    ancre = demande.ancre
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre)) {
      throw new ErreurGeneration("Ancre de cycle invalide.", 400)
    }
    if (demande.longueur !== undefined) {
      const n = demande.longueur
      if (!Number.isInteger(n) || n < 1 || n > LONGUEUR_MAX) {
        throw new ErreurGeneration("Longueur de cycle invalide.", 400)
      }
      longueur = n
    }
    semaine = dateVersSemaineJour(ancre).semaine
    const decalage = decalageEntre(semaineCourante, semaine)
    if (decalage < -SEMAINES_PASSEES || decalage > SEMAINES_FUTURES) {
      throw new ErreurGeneration("Cycle hors de la plage autorisée.", 400)
    }
  } else if (demande.semaine !== undefined) {
    if (!/^\d{4}-W\d{2}$/.test(demande.semaine)) {
      throw new ErreurGeneration("Semaine invalide.", 400)
    }
    const decalage = decalageEntre(semaineCourante, demande.semaine)
    if (decalage < -SEMAINES_PASSEES || decalage > SEMAINES_FUTURES) {
      throw new ErreurGeneration("Semaine cible hors de la plage autorisée.", 400)
    }
    semaine = demande.semaine
  }

  // Recettes visibles du foyer (catalogue global + recettes du foyer, RLS).
  const { data: recettes, error: recettesError } = await supabase
    .from("recette")
    .select(SELECT_RECETTE)

  if (recettesError) {
    throw new ErreurGeneration(
      "Impossible de récupérer tes recettes. Réessaie dans quelques instants.",
      500,
      recettesError
    )
  }

  // Recettes « supprimées » (masquées) par le foyer (#105) : exclues de la
  // génération. En cas d'erreur de lecture, on n'exclut rien (la génération
  // prime) et on journalise — jamais de catch muet.
  const { data: masques, error: masquesError } = await supabase
    .from("recette_masquee")
    .select("recette_id")
  if (masquesError) {
    console.error("Lecture des recettes masquées échouée (aucune exclusion).", masquesError)
  }
  const idsMasques = new Set(
    (masques ?? []).map((m) => (m as { recette_id: string }).recette_id)
  )

  // Conversion DB → domaine, exclusion des masquées, puis génération (RG-01 à RG-03).
  const recettesDomain = (recettes as unknown as DbRecette[])
    .map(dbRecetteToDomain)
    .filter((r) => !idsMasques.has(r.id))

  // Réglages de génération personnalisés (#45, P09) : la RLS ne renvoie que la
  // ligne de l'utilisateur (ou aucune → réglages par défaut). En cas d'erreur
  // de lecture, on retombe sur les défauts pour ne pas bloquer la génération
  // (et on le journalise).
  const { data: dbReglages, error: reglagesError } = await supabase
    .from("reglages")
    .select(
      "personnes_defaut, max_dejeuner_semaine, max_diner_semaine, max_dejeuner_weekend, max_diner_weekend, vege_dejeuner_semaine, vege_diner_semaine, vege_dejeuner_weekend, vege_diner_weekend, mix_accompagnement_jour, saisonnalite"
    )
    .maybeSingle()
  if (reglagesError) {
    console.error("Lecture des réglages échouée (défauts appliqués).", reglagesError)
  }
  const reglages = dbReglages
    ? dbReglagesToDomain(dbReglages as DbReglages)
    : REGLAGES_DEFAUT

  // RG-49/50/52 — Mémoire de variété (#218) : plannings du foyer des
  // FENETRE_VARIETE semaines PRÉCÉDANT la cible, pour défavoriser dans le
  // tirage les recettes servies récemment. Best-effort : en cas d'erreur, on
  // génère sans mémoire (jamais de blocage) et on journalise. La sélection
  // manuelle n'est pas concernée (RG-03 #23).
  const borneInf = semaineDecalee(semaine, -FENETRE_VARIETE)
  const { data: historique, error: historiqueError } = await supabase
    .from("planning")
    .select("semaine, planning_slot ( recette_id )")
    .gte("semaine", borneInf)
    .lt("semaine", semaine)
  if (historiqueError) {
    console.error(
      "Lecture de l'historique de variété échouée (variété ignorée).",
      historiqueError
    )
  }
  // id de recette → ancienneté en semaines de son apparition la PLUS RÉCENTE
  // (pénalité maximale) ; une recette vue plusieurs semaines ne compte qu'une fois.
  const historiqueVariete: HistoriqueVariete = new Map()
  for (const ligne of (historique ?? []) as Array<{
    semaine: string
    planning_slot: Array<{ recette_id: string }>
  }>) {
    const ancien = decalageEntre(ligne.semaine, semaine) // semaines écoulées (> 0)
    if (ancien < 1) continue
    for (const slot of ligne.planning_slot ?? []) {
      const courant = historiqueVariete.get(slot.recette_id)
      if (courant === undefined || ancien < courant) {
        historiqueVariete.set(slot.recette_id, ancien)
      }
    }
  }

  // RG-58/60/61 — Favoris/évités (#219) : préférences du FOYER appliquées comme
  // poids multiplicatif, composé avec la mémoire de variété. Best-effort : en
  // cas d'erreur de lecture, on génère sans biais de préférence et on journalise.
  const { data: preferencesDb, error: preferencesError } = await supabase
    .from("recette_preference")
    .select("recette_id, preference")
  if (preferencesError) {
    console.error(
      "Lecture des préférences favoris/évités échouée (préférence ignorée).",
      preferencesError
    )
  }
  const preferences: PreferencesRecettes = new Map(
    (preferencesDb ?? []).map((p) => [
      (p as { recette_id: string }).recette_id,
      (p as { preference: RecettePreference }).preference,
    ])
  )

  let planning: Planning
  try {
    planning = genererPlanning(
      recettesDomain,
      semaine,
      reglages,
      undefined,
      historiqueVariete,
      preferences
    )
  } catch (erreur) {
    // genererPlanning lève si le vivier est insuffisant (trop peu de recettes
    // rapide/normal pour remplir la semaine) — message actionnable (RG-09).
    throw new ErreurGeneration(
      "Pas assez de recettes pour générer un planning complet. Ajoute des recettes (notamment rapides ou normales) puis réessaie.",
      422,
      erreur
    )
  }

  // RG-26/27/28 — préférences souples (végé, ≥1 légume/jour, saison) : on
  // signale le NOMBRE de repas/jours non honorés sans bloquer la génération.
  const avertissements: AvertissementsGeneration = {
    vegeNonHonore: slotsVegeNonHonores(planning, reglages).length,
    mixNonHonore: joursSansLegume(planning, reglages).length,
    saisonNonHonore: reposNonSaison(planning, reglages).length,
  }

  // Mode cycle (#259) : on projette le planning généré sur les jours du cycle,
  // regroupés par semaine ISO (unité d'écriture de `sauvegarder_cycle`).
  if (modeCycle) {
    const parSemaine = planningGenereParSemaine(planning, ancre, longueur)
    const semaines = Array.from(parSemaine, ([s, jours]) => ({ semaine: s, jours }))
    return { mode: "cycle", ancre, longueur, semaines, ...avertissements }
  }

  return { mode: "semaine", planning, ...avertissements }
}
