// Générateur de planning — logique métier pure (sans UI)
//
// Implémente les règles métier RG-01 à RG-04 de SPECS_FONCTIONNELLES.md (section 6).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en isolation.

import { semaineISO } from "@/lib/semaines"
import type {
  Recette,
  Planning,
  JourPlanning,
  Jour,
  TempsPreparation,
} from "@/types"

// Jours de semaine (lundi → vendredi) : l'éligibilité y est restreinte selon
// le type de repas (RG-01) ; le week-end accepte tout.
const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]

// Ordre canonique imposé par le modèle de données (section 5.5 : 7 entrées lundi → dimanche).
const ORDRE_JOURS: Jour[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
]

type TypeRepas = "diner" | "dejeuner"

type Slot = {
  jour: Jour
  typeRepas: TypeRepas
}

const TOUS_TEMPS: TempsPreparation[] = ["rapide", "normal", "long"]

// RG-01 — Éligibilité par slot (jour × type de repas). Table data-driven :
//   - dîner de semaine     → "rapide" uniquement (le soir, au plus court)
//   - déjeuner de semaine  → "rapide" ou "normal"
//   - week-end (déj + dîn)  → toutes les recettes (y compris "long")
// Centraliser la règle ici prépare le terrain pour #P09 (paramétrage par slot).
function tempsEligibles(jour: Jour, typeRepas: TypeRepas): TempsPreparation[] {
  if (!JOURS_SEMAINE.includes(jour)) return TOUS_TEMPS // week-end : tout
  return typeRepas === "diner" ? ["rapide"] : ["rapide", "normal"]
}

function estEligible(recette: Recette, jour: Jour, typeRepas: TypeRepas): boolean {
  return tempsEligibles(jour, typeRepas).includes(recette.tempsPreparation)
}

// RG-03 — Sélection aléatoire parmi les recettes éligibles.
function choisirAleatoire<T>(elements: T[]): T {
  const index = Math.floor(Math.random() * elements.length)
  return elements[index]!
}

// Clé unique d'un slot, utilisée pour mémoriser les attributions.
function cleSlot(jour: Jour, typeRepas: TypeRepas): string {
  return `${jour}-${typeRepas}`
}

// Le calcul de l'identifiant de semaine ISO vit dans lib/semaines.ts
// (semaineISO), partagé avec la page planning.

/**
 * Génère un planning complet pour la semaine.
 *
 * Composition (section 5.5) : un déjeuner ET un dîner chaque jour, du lundi au
 * dimanche — soit 14 repas.
 *
 * Règles métier appliquées :
 *  - RG-01 : éligibilité par slot (jour × type de repas) — dîner de semaine =
 *            "rapide", déjeuner de semaine = "rapide"/"normal", week-end = tout.
 *  - RG-02 : aucune recette n'apparaît deux fois dans la semaine, tous slots confondus.
 *  - RG-03 : parmi les recettes éligibles restantes, le choix est aléatoire.
 *
 * Stratégie de remplissage : les slots les plus contraints sont attribués en
 * premier (dîners de semaine = "rapide", puis déjeuners de semaine =
 * "rapide"/"normal", puis week-end = tout). Comme toute recette éligible sur un
 * slot contraint l'est aussi sur un slot plus permissif, cet ordre évite
 * d'épuiser à tort un vivier restreint et de faire échouer un slot alors qu'une
 * solution existe : il n'échoue que si aucune attribution valide n'existe.
 *
 * @param semaine identifiant ISO "AAAA-Wnn" de la semaine cible (US-11, RG-21).
 *                Défaut : la semaine courante.
 * @throws {Error} si le vivier de recettes éligibles est insuffisant pour remplir
 *                 les 14 slots sans répétition.
 */
export function genererPlanning(
  recettes: Recette[],
  semaine: string = semaineISO()
): Planning {
  const slots: Slot[] = ORDRE_JOURS.flatMap((jour): Slot[] => [
    { jour, typeRepas: "dejeuner" },
    { jour, typeRepas: "diner" },
  ])

  // Slots contraints (dîners de semaine, puis déjeuners de semaine) d'abord,
  // slots week-end (qui acceptent tout) ensuite.
  const slotsTries = [...slots].sort(
    (a, b) => poidsContrainte(a) - poidsContrainte(b)
  )

  const utilisees = new Set<string>() // RG-02 : ids déjà placés cette semaine
  const attributions = new Map<string, Recette>()

  for (const slot of slotsTries) {
    const eligibles = recettes.filter(
      (r) => !utilisees.has(r.id) && estEligible(r, slot.jour, slot.typeRepas)
    )
    if (eligibles.length === 0) {
      throw new Error(
        `Pas assez de recettes éligibles pour générer le planning ` +
          `(slot ${slot.jour} ${slot.typeRepas}).`
      )
    }
    const choisie = choisirAleatoire(eligibles)
    utilisees.add(choisie.id)
    attributions.set(cleSlot(slot.jour, slot.typeRepas), choisie)
  }

  // Réassemblage dans l'ordre canonique lundi → dimanche (section 5.5).
  // Déjeuner ET dîner sont peuplés chaque jour désormais.
  const jours: JourPlanning[] = ORDRE_JOURS.map((jour) => ({
    jour,
    dejeuner: attributions.get(cleSlot(jour, "dejeuner"))!,
    diner: attributions.get(cleSlot(jour, "diner"))!,
  }))

  return { semaine, jours }
}

// Poids de contrainte d'un slot : plus il est bas, plus le slot est restrictif
// et doit être servi tôt. On le mesure par la taille du vivier de temps éligibles
// (RG-01) : 1 (dîner de semaine, rapide) < 2 (déjeuner de semaine) < 3 (week-end).
function poidsContrainte(slot: Slot): number {
  return tempsEligibles(slot.jour, slot.typeRepas).length
}

/**
 * Remplace une seule recette d'un planning existant, sans toucher aux autres slots.
 *
 * Règles métier appliquées (RG-04) :
 *  - RG-01 : la recette de remplacement doit être éligible pour le jour ciblé.
 *  - RG-02 : elle ne doit pas être déjà utilisée ailleurs dans la semaine.
 *            Les recettes des autres slots restent « bloquées » : seul le slot ciblé
 *            est libéré, sa recette actuelle étant exclue des candidats pour garantir
 *            un vrai changement.
 *
 * Immutabilité : le planning passé en argument n'est jamais muté. Une nouvelle
 * structure est retournée (les `JourPlanning` non concernés sont réutilisés tels quels).
 *
 * @returns le nouveau planning, ou `null` si aucune recette de remplacement n'est
 *          disponible — ou si le slot ciblé n'existe pas (planning antérieur
 *          à 14 repas, sans déjeuner ce jour-là). L'UI affiche alors
 *          « Pas de recette disponible ».
 */
export function remplacerSlot(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  recettes: Recette[]
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null // jour absent du planning

  const actuelle =
    typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!actuelle) return null // aucun slot à remplacer (planning antérieur sans ce déjeuner)

  // RG-02 : on collecte tout ce qui est déjà utilisé SAUF le slot ciblé,
  // qui est sur le point d'être remplacé.
  const utilisees = new Set<string>()
  for (const jp of planning.jours) {
    const cibleDiner = jp.jour === jour && typeRepas === "diner"
    const cibleDejeuner = jp.jour === jour && typeRepas === "dejeuner"
    if (jp.diner && !cibleDiner) utilisees.add(jp.diner.id)
    if (jp.dejeuner && !cibleDejeuner) utilisees.add(jp.dejeuner.id)
  }

  // Candidats : éligibles pour ce slot (RG-01, jour × type), non utilisés
  // ailleurs (RG-02), et différents de la recette actuelle (US-04).
  const eligibles = recettes.filter(
    (r) =>
      !utilisees.has(r.id) &&
      r.id !== actuelle.id &&
      estEligible(r, jour, typeRepas)
  )
  if (eligibles.length === 0) return null

  const choisie = choisirAleatoire(eligibles)

  // Reconstruction immuable : seul le jour ciblé est recréé. Remplacer la
  // recette efface un éventuel marquage « restes » sur ce slot (RG-22 : on
  // recuisine).
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return typeRepas === "diner"
      ? { ...jp, diner: choisie, restes: { ...jp.restes, diner: false } }
      : { ...jp, dejeuner: choisie, restes: { ...jp.restes, dejeuner: false } }
  })

  return { semaine: planning.semaine, jours }
}

/**
 * Remplace un slot par une recette choisie PAR L'UTILISATEUR (US-06, RG-15).
 *
 * Contrairement à `remplacerSlot` (aléatoire), la sélection manuelle by-passe
 * RG-01 (une recette « long » est permise un soir de semaine) et RG-02 (le
 * doublon est permis) : l'utilisateur arbitre, informé par les badges du
 * sélecteur. L'opération ne peut donc échouer que si le slot ciblé n'existe
 * pas (planning antérieur sans ce déjeuner) — cas impossible depuis l'UI, qui
 * n'affiche un bouton que sur les slots existants.
 *
 * Immutabilité : même contrat que `remplacerSlot`.
 *
 * @returns le nouveau planning, ou `null` si le slot ciblé n'existe pas.
 */
export function remplacerSlotManuel(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  recette: Recette
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null // jour absent du planning

  const actuelle =
    typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!actuelle) return null // aucun slot à remplacer (planning antérieur sans ce déjeuner)

  // Reconstruction immuable : seul le jour ciblé est recréé. Choisir une
  // recette efface un éventuel marquage « restes » sur ce slot (RG-22).
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return typeRepas === "diner"
      ? { ...jp, diner: recette, restes: { ...jp.restes, diner: false } }
      : { ...jp, dejeuner: recette, restes: { ...jp.restes, dejeuner: false } }
  })

  return { semaine: planning.semaine, jours }
}

/**
 * Identifiants des recettes présentes dans le planning, tous slots confondus.
 * Sert au badge « déjà au planning » du sélecteur (US-06, RG-15).
 */
export function recettesUtilisees(planning: Planning): Set<string> {
  const ids = new Set<string>()
  for (const jp of planning.jours) {
    ids.add(jp.diner.id)
    if (jp.dejeuner) ids.add(jp.dejeuner.id)
  }
  return ids
}

// Vivier minimal pour générer une semaine (cf. genererPlanning, RG-01/RG-02) :
//   - 14 slots distincts au total ;
//   - 10 slots de semaine réservés aux recettes rapide/normal (5 déjeuners +
//     5 dîners) ;
//   - dont 5 dîners de semaine réservés aux recettes rapide.
// Les 4 slots de week-end absorbent le reste (recettes "long" comprises).
const SLOTS_TOTAL = 14
const SLOTS_RAPIDE_NORMAL = 10
const SLOTS_RAPIDE = 5

export type AnalyseVivier = {
  suffisant: boolean
  total: number
  /** Recettes rapide ou normale (les 10 slots de semaine). */
  rapideNormal: number
  /** Recettes rapide (les 5 dîners de semaine). */
  rapide: number
  /** Message d'alerte si insuffisant, sinon null. */
  message: string | null
}

/**
 * Analyse si le vivier de recettes permet de générer une semaine complète
 * (#2, bonus PR3) — anticipe l'échec « Pas de recette disponible » du
 * générateur en prévenant l'utilisateur avant qu'il ne génère. Le détail par
 * palier (total / rapide-normal / rapide) cible précisément ce qui manque.
 */
export function analyserVivier(recettes: Recette[]): AnalyseVivier {
  const total = recettes.length
  const rapide = recettes.filter((r) => r.tempsPreparation === "rapide").length
  const rapideNormal = recettes.filter(
    (r) => r.tempsPreparation !== "long"
  ).length
  const suffisant =
    total >= SLOTS_TOTAL &&
    rapideNormal >= SLOTS_RAPIDE_NORMAL &&
    rapide >= SLOTS_RAPIDE

  if (suffisant) {
    return { suffisant, total, rapideNormal, rapide, message: null }
  }
  return {
    suffisant,
    total,
    rapideNormal,
    rapide,
    message:
      `Pour générer une semaine (14 repas), il faut au moins ${SLOTS_TOTAL} recettes, ` +
      `dont ${SLOTS_RAPIDE_NORMAL} rapides/normales, dont ${SLOTS_RAPIDE} rapides. ` +
      `Tu en as ${total} (dont ${rapideNormal} rapide/normale, dont ${rapide} rapide).`,
  }
}

/**
 * Réinjecte une recette modifiée dans le planning (US-08/#2, RG-03) : tout slot
 * qui référence cette recette (par id) reçoit sa nouvelle version (nom, temps,
 * ingrédients), pour que la liste de courses reflète immédiatement l'édition.
 * Le nombre de personnes du slot (porté par le jour) est préservé.
 *
 * @returns un nouveau planning si au moins un slot était concerné, sinon `null`
 *          (la recette n'est pas au planning courant — rien à faire).
 */
export function remplacerRecetteDansPlanning(
  planning: Planning,
  recette: Recette
): Planning | null {
  let modifie = false
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    const nouveau: JourPlanning = { ...jp }
    if (jp.diner.id === recette.id) {
      nouveau.diner = recette
      modifie = true
    }
    if (jp.dejeuner && jp.dejeuner.id === recette.id) {
      nouveau.dejeuner = recette
      modifie = true
    }
    return nouveau
  })
  return modifie ? { semaine: planning.semaine, jours } : null
}
