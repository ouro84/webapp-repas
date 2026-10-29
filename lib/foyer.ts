// Accès au Foyer partagé — lecture/écriture côté CLIENT (#56 PR3, US-19).
//
// Modèle « foyer de 1 systématique » (PR1) : tout utilisateur a toujours un
// foyer. Ce module sert la section « Mon foyer » de /profil (déplacée depuis
// /reglages en #22 PR1) : compteur de
// membres, génération/partage du code d'invitation (RG-30 : tout membre peut),
// jonction par code (RG-33) et sortie (RG-29).
//
// Les écritures passent par des RPC SECURITY DEFINER (definies dans les
// migrations #56 PR1/PR3) qui dérivent le foyer de mon_foyer() — le client ne
// fournit jamais d'identifiant de foyer. Les messages d'erreur levés par les
// RPC sont déjà en français et lisibles : on les remonte tels quels.

import { createClient } from "@/lib/supabase/client"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"

export type EtatFoyer = {
  // Nombre de membres rattachés au foyer (1 = solo). La RLS de `profiles` ne
  // renvoie que les membres du foyer courant.
  membres: number
  // Code d'invitation courant (null si jamais généré). Reste valide jusqu'à
  // expiration (multi-jonction, pas usage unique).
  code: string | null
  // Expiration ISO du code (null si pas de code). Le code peut être expiré
  // même si non-null : l'UI le compare à l'instant courant.
  expireLe: string | null
  // Jour de courses du foyer (ISO 1=lundi … 7=dimanche), ancre du cycle de
  // courses non calendaire (#257). Défaut serveur 1 (rétro-compatible ≡ semaine
  // ISO tant que non modifié).
  jourCourses: number
}

/** Charge l'état du foyer de l'utilisateur courant (compteur + code + jour de courses). */
export async function chargerFoyer(): Promise<EtatFoyer> {
  const supabase = createClient()
  const [membresRes, foyerRes] = await Promise.all([
    supabase.from("profiles").select("user_id", { count: "exact", head: true }),
    supabase.from("foyers").select("code_invitation, expire_le, jour_courses").maybeSingle(),
  ])
  if (membresRes.error) {
    throw new Error(`Chargement du foyer impossible : ${membresRes.error.message}`)
  }
  if (foyerRes.error) {
    throw new Error(`Chargement du foyer impossible : ${foyerRes.error.message}`)
  }
  return {
    membres: membresRes.count ?? 1,
    code: foyerRes.data?.code_invitation ?? null,
    expireLe: foyerRes.data?.expire_le ?? null,
    jourCourses: foyerRes.data?.jour_courses ?? 1,
  }
}

/**
 * Jour de courses du foyer (ISO 1=lundi … 7=dimanche ; défaut 1 si absent ou
 * en erreur — jamais bloquant, cf. `chargerReglages`/dégradation gracieuse).
 * La RLS de `foyers` (`id = mon_foyer()`) restreint déjà la lecture à la seule
 * ligne du foyer courant : pas besoin de scoper explicitement par id.
 * Client injectable (#304) : appelable côté serveur en tant que l'utilisateur.
 */
export async function chargerJourCoursesFoyer(
  supabase: ClientSupabase = clientParDefaut()
): Promise<number> {
  const { data, error } = await supabase.from("foyers").select("jour_courses").maybeSingle()
  if (error || !data) return 1
  return data.jour_courses
}

/**
 * Écrit le jour de courses du foyer. Le grant-colonne posé par la migration
 * (#257, même pattern que `profiles` en #22 PR1) restreint le client à cette
 * seule colonne — `code_invitation`/`expire_le` restent hors de portée. Comme
 * pour la lecture, la RLS (`id = mon_foyer()`) scope déjà la ligne cible.
 */
export async function definirJourCoursesFoyer(jour: number): Promise<void> {
  const supabase = createClient()
  // Filtre OBLIGATOIRE : PostgREST rejette un UPDATE sans clause WHERE
  // (« 21000: UPDATE requires a WHERE clause », garde anti-écrasement de table).
  // `not id is null` matche toutes les lignes ; la RLS (`id = mon_foyer()`) borne
  // déjà la mise à jour à la SEULE ligne du foyer courant (le client ne connaît
  // pas son foyer_id sans lecture). Miroir du helper e2e reinitialiserJourCoursesDistant.
  const { error } = await supabase
    .from("foyers")
    .update({ jour_courses: jour })
    .not("id", "is", null)
  if (error) {
    throw new Error(`Réglage du jour de courses impossible : ${error.message}`)
  }
}

/**
 * Génère (ou régénère) le code d'invitation du foyer (RG-30 : tout membre).
 * La RPC pose une expiration à +7 jours côté serveur ; l'appelant recharge
 * l'état (chargerFoyer) pour obtenir l'expiration faisant foi. Renvoie le code.
 */
export async function genererCodeInvitation(): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("generer_code_invitation")
  if (error || !data) {
    throw new Error(
      `Génération du code impossible : ${error?.message ?? "réponse vide"}`
    )
  }
  return data as string
}

/**
 * Rejoint un foyer par code (RG-33 : migre le catalogue perso ; RG-29 : exige
 * d'être solo). Le message d'erreur de la RPC (code invalide/expiré, foyer
 * partagé à quitter d'abord…) est déjà lisible — on le remonte tel quel.
 */
export async function rejoindreFoyer(code: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc("rejoindre_foyer", { p_code: code })
  if (error) {
    throw new Error(error.message || "Impossible de rejoindre ce foyer.")
  }
}

/**
 * Quitte le foyer courant et repart sur un foyer solo neuf, en CLONANT vers
 * celui-ci recettes, plannings et coches du foyer quitté (#56 PR6, RG-34 : zéro
 * perte des deux côtés). Tout est fait côté serveur par la RPC SECURITY DEFINER
 * transactionnelle `quitter_foyer` ; le client recharge ensuite (cf. PanneauFoyer
 * → reinitialiserCacheFoyer) pour réhydrater depuis le nouveau foyer.
 */
export async function quitterFoyer(): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc("quitter_foyer")
  if (error) {
    throw new Error(error.message || "Impossible de quitter le foyer.")
  }
}
