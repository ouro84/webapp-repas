// Accès aux réglages de génération — lecture/écriture côté CLIENT (#45, P09).
//
// Source de vérité : Supabase (table `reglages`, RLS propriétaire). Une ligne
// par utilisateur, identifiée par user_id ; ligne absente = réglages par défaut
// (REGLAGES_DEFAUT). La génération complète lit les réglages côté serveur
// (route /api/planning/generer) ; ce module sert les besoins client : la page
// de réglages (PR2) et le remplacement unitaire « ↺ changer » de la page
// planning (qui applique l'éligibilité côté client).

import { createClient } from "@/lib/supabase/client"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"
import {
  dbReglagesToDomain,
  reglagesToDb,
  REGLAGES_DEFAUT,
} from "@/lib/reglages"
import type { DbReglages, ReglagesGeneration } from "@/types"

// Colonnes de la table reglages (même forme que DbReglages).
const SELECT_REGLAGES = `
  personnes_defaut,
  max_dejeuner_semaine,
  max_diner_semaine,
  max_dejeuner_weekend,
  max_diner_weekend,
  vege_dejeuner_semaine,
  vege_diner_semaine,
  vege_dejeuner_weekend,
  vege_diner_weekend,
  mix_accompagnement_jour,
  saisonnalite
` as const

/**
 * Charge les réglages de l'utilisateur connecté. La RLS ne renvoie que sa
 * propre ligne (ou aucune) → ligne absente = REGLAGES_DEFAUT.
 * Client injectable (#304) : appelable côté serveur en tant que l'utilisateur.
 */
export async function chargerReglages(
  supabase: ClientSupabase = clientParDefaut()
): Promise<ReglagesGeneration> {
  const { data, error } = await supabase
    .from("reglages")
    .select(SELECT_REGLAGES)
    .maybeSingle()

  if (error) {
    throw new Error(`Chargement des réglages impossible : ${error.message}`)
  }
  return data ? dbReglagesToDomain(data as DbReglages) : REGLAGES_DEFAUT
}

/**
 * Enregistre (upsert par user_id) les réglages de l'utilisateur connecté.
 * Les contraintes CHECK de la table valident l'enum et les bornes en dernier
 * ressort (la saisie est déjà validée par validerReglages côté formulaire).
 */
export async function sauvegarderReglages(
  reglages: ReglagesGeneration
): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Tu dois être connecté pour enregistrer tes réglages.")
  }

  const { error } = await supabase
    .from("reglages")
    .upsert({ user_id: user.id, ...reglagesToDb(reglages) })

  if (error) {
    throw new Error(`Enregistrement des réglages impossible : ${error.message}`)
  }
}
