// Outils MCP d'ÉCRITURE du planning (#306, US-52, RG-74→77, RG-79).
//
// Chaque fonction reçoit le client Supabase « par jeton » de l'utilisateur
// (RG-71 : RLS mon_foyer(), jamais `service_role`) et COMPOSE les services de
// l'UI (règle du jumeau) : génération serveur, RPC sauvegarder_cycle /
// sauvegarder_slots. Une écriture MCP est donc une modification ordinaire :
// bump de `version`, temps réel et alerte « en magasin » (US-21) sans code
// dédié (RG-79).

import { chargerLongueurCycle, sauvegarderCycleDistant } from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { ErreurGeneration, genererPourUtilisateur, semaineDansPlage } from "@/lib/generation"
import { retirerCreneauxDesactives } from "@/lib/generateur"
import {
  ancreCourante,
  ancreParDefaut,
  dateVersSemaineJour,
  joursDuCycle,
  semainesDuCycle,
} from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { repasAuxDates, validerDate } from "@/lib/mcp/repas"
import {
  depuisISO,
  libellePeriode,
  planningsAffiches,
  reglagesOuDefaut,
  versRepasMcp,
  type RepasMcp,
} from "@/lib/mcp/lecture"
import type { ClientSupabase } from "@/lib/supabase/types"

const CYCLE_HORS_PLAGE =
  "Ce cycle est hors de la plage autorisée (12 semaines en arrière, 6 en avant). Choisis une date plus proche."

export type CycleGenereMcp = {
  periode: { du: string; au: string; libelle: string }
  repas: RepasMcp[]
  avertissements: { vege_non_honore: number; mix_non_honore: number; saison_non_honore: number }
}

/**
 * `generer_cycle` (RG-74) : génère le cycle COURANT (même ancre que /courses)
 * ou celui qui contient `ancre`, avec les réglages du foyer, comme « Générer
 * mon cycle ». Refuse si la fenêtre porte déjà un repas affiché, sauf
 * `remplacer: true`. Écriture atomique `sauvegarder_cycle` : jours hors cycle
 * préservés (RG-56), coches du cycle réinitialisées (RG-13).
 */
export async function genererCycle(
  supabase: ClientSupabase,
  args: { ancre?: string; remplacer?: boolean },
  aujourdhui: Date = new Date()
): Promise<CycleGenereMcp> {
  const jourCourses = await chargerJourCoursesFoyer(supabase)
  let ancre: string
  if (args.ancre !== undefined) {
    const invalide = validerDate(args.ancre)
    if (invalide) throw new ErreurOutil(invalide)
    ancre = ancreCourante(depuisISO(args.ancre), jourCourses)
  } else {
    ancre = ancreParDefaut(aujourdhui, jourCourses)
  }
  if (!semaineDansPlage(semaineISO(aujourdhui), dateVersSemaineJour(ancre).semaine)) {
    throw new ErreurOutil(CYCLE_HORS_PLAGE)
  }

  const longueur = await chargerLongueurCycle(ancre, supabase)
  const dates = joursDuCycle(ancre, longueur)
  const du = dates[0]
  const au = dates[dates.length - 1]
  const reglages = await reglagesOuDefaut(supabase)

  if (args.remplacer !== true) {
    // Repas AFFICHÉS seulement (créneaux désactivés retirés, comme /planning).
    const existants = repasAuxDates(
      await planningsAffiches(supabase, semainesDuCycle(ancre, longueur), reglages),
      dates
    )
    if (existants.length > 0) {
      throw new ErreurOutil(
        `Un cycle existe déjà ${libellePeriode(du, au)} (${existants.length} repas prévus). Demande confirmation à l’utilisateur avant de l’écraser, puis rappelle generer_cycle avec remplacer: true.`
      )
    }
  }

  let resultat
  try {
    resultat = await genererPourUtilisateur(supabase, { ancre, longueur }, { aujourdhui })
  } catch (erreur) {
    if (erreur instanceof ErreurGeneration && erreur.statut === 400) throw new ErreurOutil(CYCLE_HORS_PLAGE)
    if (erreur instanceof ErreurGeneration && erreur.statut === 422) throw new ErreurOutil(erreur.message)
    throw erreur
  }
  if (resultat.mode !== "cycle") throw new Error("Génération : mode cycle attendu.")

  await sauvegarderCycleDistant(ancre, resultat.semaines, supabase)

  const plannings = resultat.semaines.map((s) => retirerCreneauxDesactives(s, reglages))
  return {
    periode: { du, au, libelle: libellePeriode(du, au) },
    repas: repasAuxDates(plannings, dates).map(versRepasMcp),
    avertissements: {
      vege_non_honore: resultat.vegeNonHonore,
      mix_non_honore: resultat.mixNonHonore,
      saison_non_honore: resultat.saisonNonHonore,
    },
  }
}
