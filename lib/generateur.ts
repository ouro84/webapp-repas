// Générateur de planning — logique métier pure (sans UI)
//
// Implémente les règles métier RG-01 à RG-04 de SPECS_FONCTIONNELLES.md (section 6).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en isolation.

import { semaineISO } from "@/lib/semaines"
import {
  ORDRE_TEMPS,
  rangTemps,
  REGLAGES_DEFAUT,
  tempsAuPlafond,
} from "@/lib/reglages"
import type {
  Recette,
  Planning,
  JourPlanning,
  Jour,
  TempsPreparation,
  ReglagesGeneration,
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

// RG-01 — Éligibilité par slot (jour × type de repas), paramétrée par les
// réglages utilisateur (#45, P09). Chaque créneau a un temps de préparation
// MAXIMUM autorisé (« plafond ») ; une recette est éligible si son temps est ≤
// plafond. Les réglages par défaut (REGLAGES_DEFAUT) reproduisent l'ancienne
// table en dur : dîner de semaine "rapide", déjeuner de semaine "normal",
// week-end "long" (tout).
type CleCreneau = keyof ReglagesGeneration["plafonds"]

// Créneau (jour × type de repas) → clé des réglages. Partagé par le plafond de
// temps (#45) et la préférence végé (#86 PR2) pour éviter de dupliquer la
// logique semaine/week-end.
function creneauSlot(jour: Jour, typeRepas: TypeRepas): CleCreneau {
  const enSemaine = JOURS_SEMAINE.includes(jour)
  if (enSemaine) return typeRepas === "diner" ? "dinerSemaine" : "dejeunerSemaine"
  return typeRepas === "diner" ? "dinerWeekend" : "dejeunerWeekend"
}

function plafondSlot(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): TempsPreparation {
  return reglages.plafonds[creneauSlot(jour, typeRepas)]
}

/**
 * Vrai si l'utilisateur a demandé de privilégier le végétarien sur ce créneau
 * (#86 PR2, RG-26). Préférence SOUPLE : exploitée comme biais de sélection, pas
 * comme contrainte. Absente (réglages sans `vegetarienPrefere`) = false.
 */
export function prefereVegeSlot(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): boolean {
  return reglages.vegetarienPrefere?.[creneauSlot(jour, typeRepas)] ?? false
}

/**
 * Restreint des candidats éligibles au sous-ensemble végétarien SI le créneau
 * privilégie le végé ET qu'au moins une recette végé est disponible ; sinon
 * renvoie les candidats tels quels (repli souple, RG-26). Le biais reste dans
 * le même palier de temps → la faisabilité de la génération est inchangée.
 */
function biaiserVege(
  candidats: Recette[],
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): Recette[] {
  if (!prefereVegeSlot(jour, typeRepas, reglages)) return candidats
  const vege = candidats.filter((r) => r.vegetarien === true)
  return vege.length > 0 ? vege : candidats
}

function tempsEligibles(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): TempsPreparation[] {
  return tempsAuPlafond(plafondSlot(jour, typeRepas, reglages))
}

function estEligible(
  recette: Recette,
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): boolean {
  return tempsEligibles(jour, typeRepas, reglages).includes(
    recette.tempsPreparation
  )
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
  semaine: string = semaineISO(),
  reglages: ReglagesGeneration = REGLAGES_DEFAUT
): Planning {
  const slots: Slot[] = ORDRE_JOURS.flatMap((jour): Slot[] => [
    { jour, typeRepas: "dejeuner" },
    { jour, typeRepas: "diner" },
  ])

  // Slots contraints (plafond le plus bas → vivier le plus restreint) d'abord,
  // slots permissifs ensuite (RG-01). Comme toute recette éligible sur un slot
  // contraint l'est aussi sur un slot plus permissif (plafonds = seuils sur un
  // ordre total), cet ordre évite d'épuiser à tort un vivier restreint.
  // À palier de contrainte égal, les créneaux « privilégier végé » (#86 PR2)
  // passent en premier pour capter les recettes végé avant les autres slots
  // (meilleur taux d'honoring de la préférence souple ; sans incidence sur la
  // faisabilité, cf. biaiserVege).
  const slotsTries = [...slots].sort((a, b) => {
    const d = poidsContrainte(a, reglages) - poidsContrainte(b, reglages)
    if (d !== 0) return d
    const va = prefereVegeSlot(a.jour, a.typeRepas, reglages) ? 0 : 1
    const vb = prefereVegeSlot(b.jour, b.typeRepas, reglages) ? 0 : 1
    return va - vb
  })

  const utilisees = new Set<string>() // RG-02 : ids déjà placés cette semaine
  const attributions = new Map<string, Recette>()

  for (const slot of slotsTries) {
    const eligibles = recettes.filter(
      (r) =>
        !utilisees.has(r.id) &&
        estEligible(r, slot.jour, slot.typeRepas, reglages)
    )
    if (eligibles.length === 0) {
      throw new Error(
        `Pas assez de recettes éligibles pour générer le planning ` +
          `(slot ${slot.jour} ${slot.typeRepas}).`
      )
    }
    // RG-26 — préférence végé souple : on tire parmi les éligibles végé si le
    // créneau le demande et qu'il en reste, sinon parmi tous les éligibles.
    const choisie = choisirAleatoire(
      biaiserVege(eligibles, slot.jour, slot.typeRepas, reglages)
    )
    utilisees.add(choisie.id)
    attributions.set(cleSlot(slot.jour, slot.typeRepas), choisie)
  }

  // Réassemblage dans l'ordre canonique lundi → dimanche (section 5.5).
  // Déjeuner ET dîner sont peuplés chaque jour désormais. Chaque slot est doté
  // du nombre de personnes par défaut des réglages (#45) — base recette 2
  // inchangée (RG-16), seul le défaut affiché change.
  const jours: JourPlanning[] = ORDRE_JOURS.map((jour) => ({
    jour,
    dejeuner: attributions.get(cleSlot(jour, "dejeuner"))!,
    diner: attributions.get(cleSlot(jour, "diner"))!,
    personnes: {
      dejeuner: reglages.personnesDefaut,
      diner: reglages.personnesDefaut,
    },
  }))

  return { semaine, jours }
}

// Poids de contrainte d'un slot : plus il est bas, plus le slot est restrictif
// et doit être servi tôt. Mesuré par la taille du vivier de temps éligibles
// (RG-01) selon le plafond du créneau (1 si plafond "rapide", 2 si "normal",
// 3 si "long").
function poidsContrainte(slot: Slot, reglages: ReglagesGeneration): number {
  return tempsEligibles(slot.jour, slot.typeRepas, reglages).length
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
  recettes: Recette[],
  reglages: ReglagesGeneration = REGLAGES_DEFAUT
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
      estEligible(r, jour, typeRepas, reglages)
  )
  if (eligibles.length === 0) return null

  // RG-26 — même préférence végé souple que la génération complète (Q4).
  const choisie = choisirAleatoire(
    biaiserVege(eligibles, jour, typeRepas, reglages)
  )

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

/**
 * Slots dont le créneau privilégie le végétarien mais qui portent une recette
 * NON végétarienne (#86 PR2, RG-26) — c.-à-d. les cas où la préférence souple
 * n'a pas pu être honorée (vivier végé insuffisant). Calculé depuis le planning
 * final : indépendant de l'aléatoire de génération, et valable aussi bien après
 * une génération complète qu'après un remplacement unitaire. Sert à avertir
 * l'utilisateur sans bloquer (la génération aboutit toujours).
 */
export function slotsVegeNonHonores(
  planning: Planning,
  reglages: ReglagesGeneration
): Slot[] {
  const slots: Slot[] = []
  for (const jp of planning.jours) {
    if (
      jp.dejeuner &&
      prefereVegeSlot(jp.jour, "dejeuner", reglages) &&
      jp.dejeuner.vegetarien !== true
    ) {
      slots.push({ jour: jp.jour, typeRepas: "dejeuner" })
    }
    if (
      jp.diner &&
      prefereVegeSlot(jp.jour, "diner", reglages) &&
      jp.diner.vegetarien !== true
    ) {
      slots.push({ jour: jp.jour, typeRepas: "diner" })
    }
  }
  return slots
}

// Nombre de slots par créneau dans une semaine (section 5.5) : 5 jours de
// semaine + 2 jours de week-end, chacun déjeuner + dîner → 14 slots.
const SLOTS_PAR_CRENEAU = {
  dejeunerSemaine: 5,
  dinerSemaine: 5,
  dejeunerWeekend: 2,
  dinerWeekend: 2,
} as const

export type AnalyseVivier = {
  suffisant: boolean
  total: number
  /** Recettes rapide ou normale (temps ≠ long). */
  rapideNormal: number
  /** Recettes rapide. */
  rapide: number
  /** Message d'alerte si insuffisant, sinon null. */
  message: string | null
}

/**
 * Analyse si le vivier de recettes permet de générer une semaine complète
 * (#2, bonus PR3) sous les réglages donnés (#45) — anticipe l'échec « Pas de
 * recette disponible » du générateur. Sert aussi de garde de faisabilité avant
 * d'enregistrer des réglages (B3).
 *
 * Faisabilité (affectation distincte recette → slot) : comme les temps sont
 * totalement ordonnés et l'éligibilité est « temps ≤ plafond », les viviers
 * sont emboîtés. Par le théorème de Hall, il suffit qu'à CHAQUE niveau `k`
 * (rapide ⊂ rapide+normal ⊂ tout) le nombre de slots de plafond ≤ k ne dépasse
 * pas le nombre de recettes de temps ≤ k. Avec REGLAGES_DEFAUT, on retrouve
 * exactement les anciens seuils 14 / 10 / 5.
 */
export function analyserVivier(
  recettes: Recette[],
  reglages: ReglagesGeneration = REGLAGES_DEFAUT
): AnalyseVivier {
  const total = recettes.length
  const rapide = recettes.filter((r) => r.tempsPreparation === "rapide").length
  const rapideNormal = recettes.filter((r) => r.tempsPreparation !== "long").length
  // Recettes cumulées par niveau (≤ rang) : index 0 = rapide, 1 = +normal, 2 = tout.
  const recettesCum = [rapide, rapideNormal, total]

  // Slots requis cumulés par niveau : un créneau de plafond de rang r pèse sur
  // tous les niveaux ≥ r (ses slots ne peuvent piocher que dans temps ≤ r).
  const besoin = ORDRE_TEMPS.map(() => 0)
  const p = reglages.plafonds
  const creneaux: [keyof typeof SLOTS_PAR_CRENEAU, TempsPreparation][] = [
    ["dejeunerSemaine", p.dejeunerSemaine],
    ["dinerSemaine", p.dinerSemaine],
    ["dejeunerWeekend", p.dejeunerWeekend],
    ["dinerWeekend", p.dinerWeekend],
  ]
  for (const [cle, plafond] of creneaux) {
    for (let k = rangTemps(plafond); k < ORDRE_TEMPS.length; k++) {
      besoin[k]! += SLOTS_PAR_CRENEAU[cle]
    }
  }

  const suffisant = besoin.every((req, k) => req <= recettesCum[k]!)
  if (suffisant) {
    return { suffisant, total, rapideNormal, rapide, message: null }
  }

  const reqTotal = besoin[2]! // tous les slots → toujours 14
  const reqRapideNormal = besoin[1]!
  const reqRapide = besoin[0]!
  const message =
    `Pour générer une semaine (14 repas), il faut au moins ${reqTotal} recettes` +
    (reqRapideNormal > 0 ? `, dont ${reqRapideNormal} rapides/normales` : ``) +
    (reqRapide > 0 ? `, dont ${reqRapide} rapides` : ``) +
    `. Tu en as ${total} (dont ${rapideNormal} rapide/normale, dont ${rapide} rapide).`
  return { suffisant, total, rapideNormal, rapide, message }
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
