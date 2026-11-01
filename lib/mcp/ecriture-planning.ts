// Outils MCP d'ÉCRITURE du planning (#306, US-52, RG-74→77, RG-79).
//
// Chaque fonction reçoit le client Supabase « par jeton » de l'utilisateur
// (RG-71 : RLS mon_foyer(), jamais `service_role`) et COMPOSE les services de
// l'UI (règle du jumeau) : génération serveur, RPC sauvegarder_cycle /
// sauvegarder_slots. Une écriture MCP est donc une modification ordinaire :
// bump de `version`, temps réel et alerte « en magasin » (US-21) sans code
// dédié (RG-79).

import {
  chargerLongueurCycle,
  chargerPlanningDistant,
  sauvegarderCycleDistant,
  sauvegarderSlotsDistant,
} from "@/lib/persistance"
import { chargerRecettes } from "@/lib/recettes"
import { chargerPreferences } from "@/lib/preferences"
import { normaliser, rechercherRecettes } from "@/lib/recherche"
import { modifierPersonnes, personnesDuSlot, PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes"
import { estRestes, marquerRestes } from "@/lib/restes"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { ErreurGeneration, genererPourUtilisateur, semaineDansPlage } from "@/lib/generation"
import {
  creneauActif,
  joursSansLegume,
  prefereVegeSlot,
  remplacerSlot,
  remplacerSlotManuel,
  reposNonSaison,
  retirerCreneauxDesactives,
} from "@/lib/generateur"
import {
  ancreParDefaut,
  dateVersSemaineJour,
  joursDuCycle,
  semainesDuCycle,
} from "@/lib/cycles"
import { semaineISO } from "@/lib/semaines"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { idsRecettesDuFoyer } from "@/lib/mcp/recherche-recettes"
import { localiserRepas, repasAuxDates, TYPE_REPAS, type Creneau } from "@/lib/mcp/repas"
import {
  ancreDemandee,
  CYCLE_HORS_PLAGE,
  libellePeriode,
  libelleRepas,
  planningsAffiches,
  reglagesOuDefaut,
  versRepasMcp,
  type RepasMcp,
} from "@/lib/mcp/lecture"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Jour, JourPlanning, Planning, Recette, ReglagesGeneration } from "@/types"

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
 *
 * `verifierQuota` (quota de génération, lève `ErreurOutil` au-delà) n'est
 * appelé que juste avant de générer : un refus ne consomme rien.
 */
export async function genererCycle(
  supabase: ClientSupabase,
  args: { ancre?: string; remplacer?: boolean },
  aujourdhui: Date = new Date(),
  verifierQuota: () => Promise<void> = async () => {}
): Promise<CycleGenereMcp> {
  let ancre: string
  if (args.ancre !== undefined) {
    ancre = await ancreDemandee(supabase, args.ancre, aujourdhui)
  } else {
    ancre = ancreParDefaut(aujourdhui, await chargerJourCoursesFoyer(supabase))
    if (!semaineDansPlage(semaineISO(aujourdhui), dateVersSemaineJour(ancre).semaine)) {
      throw new ErreurOutil(CYCLE_HORS_PLAGE)
    }
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

  await verifierQuota()
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

const MESSAGE_PERSONNES = "Nombre de personnes invalide : choisis un entier entre 1 et 12."

type RepasCible = {
  semaine: string
  jour: Jour
  type: "dejeuner" | "diner"
  planning: Planning
  reglages: ReglagesGeneration
}

// Repas existant et AFFICHÉ visé par date + créneau (planning brut pour
// l'écriture) ; sinon ErreurOutil, rien n'est écrit.
async function repasCible(
  supabase: ClientSupabase,
  args: { date: string; creneau: Creneau },
  aujourdhui: Date
): Promise<RepasCible> {
  const { semaine, jour } = localiserRepas(args.date, aujourdhui)
  const type = TYPE_REPAS[args.creneau]
  const [charge, reglages] = await Promise.all([
    chargerPlanningDistant(semaine, supabase),
    reglagesOuDefaut(supabase),
  ])
  const jp = charge?.planning.jours.find((j) => j.jour === jour)
  if (!charge || !jp?.[type] || !creneauActif(jour, type, reglages)) {
    throw new ErreurOutil(
      `Aucun repas prévu ${libelleRepas(args.date, args.creneau, jour)}. Appelle lire_planning pour voir les repas prévus, ou generer_cycle pour en créer.`
    )
  }
  return { semaine, jour, type, planning: charge.planning, reglages }
}

// Écrit le SEUL créneau visé (sauvegarder_slots n'upserte que les slots
// fournis) : le repas voisin du même jour n'est jamais réécrit, même si un
// autre appareil vient de le changer.
async function ecrireCreneau(
  supabase: ClientSupabase,
  cible: RepasCible,
  planning: Planning,
  args: { date: string; creneau: Creneau }
): Promise<RepasMcp> {
  const jp = planning.jours.find((j) => j.jour === cible.jour)!
  const reduit: JourPlanning = {
    jour: cible.jour,
    [cible.type]: jp[cible.type],
    personnes: { [cible.type]: personnesDuSlot(jp, cible.type) },
    restes: { [cible.type]: estRestes(jp, cible.type) },
  }
  await sauvegarderSlotsDistant(cible.semaine, [reduit], supabase)
  return versRepasMcp({ date: args.date, creneau: args.creneau, jour: cible.jour, jp })
}

// Homonymes exacts (une recette du catalogue copiée dans le foyer, ou deux
// catalogues fusionnés, RG-33) : la recette du foyer l'emporte, c'est celle que
// l'utilisateur a ajoutée ou personnalisée. RLS : foyer_id non nul = du foyer.
async function homonymeDuFoyer(supabase: ClientSupabase, homonymes: Recette[]): Promise<Recette> {
  const idsFoyer = await idsRecettesDuFoyer(supabase)
  return homonymes.find((r) => idsFoyer.has(r.id)) ?? homonymes[0]
}

export type RemplacementMcp =
  | { modifie: true; repas: RepasMcp; avertissements?: string[] }
  | { modifie: false; candidats: string[]; total: number }

const CANDIDATS_MAX = 10

// Préférences souples non honorées par un tirage, pour ce seul repas : les
// mêmes messages que les toasts du site après « ↺ changer » (RG-26/27/28).
function avertissementsTirage(planning: Planning, cible: RepasCible): string[] {
  const { jour, type, reglages } = cible
  const remplacante = planning.jours.find((jp) => jp.jour === jour)?.[type]
  const messages: string[] = []
  if (prefereVegeSlot(jour, type, reglages) && remplacante?.vegetarien !== true) {
    messages.push("Pas de recette végétarienne disponible pour ce repas.")
  }
  if (joursSansLegume(planning, reglages).includes(jour)) {
    messages.push("Ce jour n’a pas de repas « légumes » (pas assez de recettes légumes).")
  }
  if (reposNonSaison(planning, reglages).some((s) => s.jour === jour && s.typeRepas === type)) {
    messages.push("Ce repas est hors saison (pas assez de recettes de saison).")
  }
  return messages
}

/**
 * `remplacer_repas` (RG-75) : sans `recette`, tirage automatique identique au
 * « ↺ changer » (RG-04, préférences RG-62) ; avec `recette`, recherche dans
 * les recettes visibles du foyer (masquées exclues) : un résultat → sélection
 * manuelle (RG-15), plusieurs → candidats sans rien écrire, aucun → erreur.
 * Les personnes du slot sont conservées (RG-16).
 */
export async function remplacerRepas(
  supabase: ClientSupabase,
  args: { date: string; creneau: Creneau; recette?: string },
  aujourdhui: Date = new Date()
): Promise<RemplacementMcp> {
  const cible = await repasCible(supabase, args, aujourdhui)
  const recettes = await chargerRecettes(supabase)

  let planning: Planning
  if (args.recette === undefined) {
    const preferences = await chargerPreferences(supabase).catch((erreur) => {
      console.error("Lecture des préférences échouée (tirage sans préférence).", erreur)
      return new Map() as Awaited<ReturnType<typeof chargerPreferences>>
    })
    const tire = remplacerSlot(cible.planning, cible.jour, cible.type, recettes, cible.reglages, Math.random, preferences)
    if (!tire) {
      throw new ErreurOutil(
        "Aucune autre recette ne convient à ce créneau. Propose une recette précise (paramètre recette) ou ajoute-en une avec ajouter_recette."
      )
    }
    return {
      modifie: true,
      repas: await ecrireCreneau(supabase, cible, tire, args),
      avertissements: avertissementsTirage(tire, cible),
    }
  } else {
    let trouvees = rechercherRecettes(recettes, args.recette)
    if (trouvees.length > 1 && trouvees.every((r) => normaliser(r.nom) === normaliser(trouvees[0].nom))) {
      trouvees = [await homonymeDuFoyer(supabase, trouvees)]
    }
    if (trouvees.length === 0) {
      throw new ErreurOutil(
        `Aucune recette « ${args.recette} » dans le catalogue ni dans les recettes du foyer. Propose de l’ajouter avec ajouter_recette.`
      )
    }
    if (trouvees.length > 1) {
      return {
        modifie: false,
        candidats: trouvees
          .map((r) => r.nom)
          .sort((a, b) => a.localeCompare(b, "fr"))
          .slice(0, CANDIDATS_MAX),
        total: trouvees.length,
      }
    }
    planning = remplacerSlotManuel(cible.planning, cible.jour, cible.type, trouvees[0])!
  }

  return { modifie: true, repas: await ecrireCreneau(supabase, cible, planning, args) }
}

/** `changer_personnes` (RG-77) : nombre de personnes d'un repas, borné [1 ; 12] (RG-16). */
export async function changerPersonnes(
  supabase: ClientSupabase,
  args: { date: string; creneau: Creneau; personnes: number },
  aujourdhui: Date = new Date()
): Promise<{ repas: RepasMcp }> {
  const n = args.personnes
  if (!Number.isInteger(n) || n < PERSONNES_MIN || n > PERSONNES_MAX) throw new ErreurOutil(MESSAGE_PERSONNES)
  const cible = await repasCible(supabase, args, aujourdhui)
  // repasCible garantit que le slot existe : marquerRestes / modifierPersonnes ne renvoient pas null.
  const planning = modifierPersonnes(cible.planning, cible.jour, cible.type, n)!
  return { repas: await ecrireCreneau(supabase, cible, planning, args) }
}

/**
 * `marquer_restes` (RG-85, RG-22) : marque le repas comme restes (rien à
 * cuisiner, ingrédients exclus de la liste de courses) ou, avec
 * `restes: false`, le démarque. La recette sous-jacente est conservée : la
 * démarquer la restitue. IDEMPOTENT (pas une bascule) : un assistant qui rejoue
 * l'appel ne doit pas annuler son propre marquage. Seul le créneau visé est
 * écrit (`ecrireCreneau`).
 */
export async function marquerRestesRepas(
  supabase: ClientSupabase,
  args: { date: string; creneau: Creneau; restes?: boolean },
  aujourdhui: Date = new Date()
): Promise<{ repas: RepasMcp }> {
  const cible = await repasCible(supabase, args, aujourdhui)
  // repasCible garantit que le slot existe : marquerRestes / modifierPersonnes ne renvoient pas null.
  const planning = marquerRestes(cible.planning, cible.jour, cible.type, args.restes ?? true)!
  return { repas: await ecrireCreneau(supabase, cible, planning, args) }
}
