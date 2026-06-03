// Générateur de planning — logique métier pure (sans UI)
//
// Implémente les règles métier RG-01 à RG-04 de SPECS_FONCTIONNELLES.md (section 6).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en isolation.

import type { Recette, Planning, JourPlanning, Jour } from "@/types"

// Jours de semaine (lundi → vendredi) : seuls les dîners y existent en MVP,
// et seules les recettes "rapide" ou "normal" y sont éligibles (RG-01).
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

// RG-01 — Éligibilité par jour.
// L'éligibilité ne dépend que du jour (semaine vs week-end), pas du type de repas :
//   - lundi → vendredi : "rapide" ou "normal" uniquement
//   - samedi / dimanche : toutes les recettes (y compris "long")
function estEligible(recette: Recette, jour: Jour): boolean {
  if (JOURS_SEMAINE.includes(jour)) {
    return (
      recette.tempsPreparation === "rapide" ||
      recette.tempsPreparation === "normal"
    )
  }
  return true
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

// Numéro de semaine ISO 8601 au format "AAAA-Wnn" (ex: "2026-W23").
// L'année renvoyée est l'année ISO (celle du jeudi de la semaine), qui peut
// différer de l'année civile autour du 1er janvier / 31 décembre.
function numeroSemaineISO(date: Date = new Date()): string {
  // On se place à midi UTC pour neutraliser les effets de fuseau horaire.
  const cible = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  // ISO : le lundi vaut 1, le dimanche vaut 7 (et non 0).
  const jourSemaine = cible.getUTCDay() || 7
  // On décale jusqu'au jeudi de la semaine courante : il porte l'année ISO.
  cible.setUTCDate(cible.getUTCDate() + 4 - jourSemaine)
  const debutAnnee = new Date(Date.UTC(cible.getUTCFullYear(), 0, 1))
  const numero = Math.ceil(
    ((cible.getTime() - debutAnnee.getTime()) / 86_400_000 + 1) / 7
  )
  return `${cible.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`
}

/**
 * Génère un planning complet pour la semaine.
 *
 * Composition (section 5.5) : un dîner du lundi au dimanche (7 slots),
 * plus un déjeuner le samedi et un déjeuner le dimanche (2 slots) — soit 9 repas.
 *
 * Règles métier appliquées :
 *  - RG-01 : lundi → vendredi, seules les recettes "rapide" ou "normal" sont éligibles ;
 *            le week-end, toutes les recettes le sont.
 *  - RG-02 : aucune recette n'apparaît deux fois dans la semaine, tous slots confondus.
 *  - RG-03 : parmi les recettes éligibles restantes, le choix est aléatoire.
 *
 * Stratégie de remplissage : les slots les plus contraints (dîners de semaine,
 * limités à "rapide"/"normal") sont attribués en premier, avant les slots week-end
 * qui acceptent tout. Comme toute recette éligible en semaine l'est aussi le week-end,
 * cet ordre évite d'épuiser le vivier "rapide"/"normal" sur un slot week-end et de
 * faire échouer à tort un slot de semaine : il n'échoue que si aucune attribution
 * valide n'existe réellement.
 *
 * @throws {Error} si le vivier de recettes éligibles est insuffisant pour remplir
 *                 les 9 slots sans répétition.
 */
export function genererPlanning(recettes: Recette[]): Planning {
  const slots: Slot[] = [
    ...ORDRE_JOURS.map((jour): Slot => ({ jour, typeRepas: "diner" })),
    { jour: "samedi", typeRepas: "dejeuner" },
    { jour: "dimanche", typeRepas: "dejeuner" },
  ]

  // Slots contraints (dîners de semaine) d'abord, slots week-end ensuite.
  const slotsTries = [...slots].sort(
    (a, b) => poidsContrainte(a) - poidsContrainte(b)
  )

  const utilisees = new Set<string>() // RG-02 : ids déjà placés cette semaine
  const attributions = new Map<string, Recette>()

  for (const slot of slotsTries) {
    const eligibles = recettes.filter(
      (r) => !utilisees.has(r.id) && estEligible(r, slot.jour)
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
  const jours: JourPlanning[] = ORDRE_JOURS.map((jour) => {
    const diner = attributions.get(cleSlot(jour, "diner"))!
    const dejeuner = attributions.get(cleSlot(jour, "dejeuner"))
    return dejeuner ? { jour, dejeuner, diner } : { jour, diner }
  })

  return { semaine: numeroSemaineISO(), jours }
}

// Poids de contrainte d'un slot : plus il est bas, plus le slot est restrictif
// et doit être servi tôt. Dîner de semaine = 0 (restreint), week-end = 1 (libre).
function poidsContrainte(slot: Slot): number {
  return JOURS_SEMAINE.includes(slot.jour) ? 0 : 1
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
 *          disponible — ou si le slot ciblé n'existe pas (ex: déjeuner en semaine).
 *          L'UI affiche alors « Pas de recette disponible ».
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
  if (!actuelle) return null // aucun slot à remplacer (ex: déjeuner lun→ven)

  // RG-02 : on collecte tout ce qui est déjà utilisé SAUF le slot ciblé,
  // qui est sur le point d'être remplacé.
  const utilisees = new Set<string>()
  for (const jp of planning.jours) {
    const cibleDiner = jp.jour === jour && typeRepas === "diner"
    const cibleDejeuner = jp.jour === jour && typeRepas === "dejeuner"
    if (jp.diner && !cibleDiner) utilisees.add(jp.diner.id)
    if (jp.dejeuner && !cibleDejeuner) utilisees.add(jp.dejeuner.id)
  }

  // Candidats : éligibles pour ce jour (RG-01), non utilisés ailleurs (RG-02),
  // et différents de la recette actuelle (« une autre recette », US-04).
  const eligibles = recettes.filter(
    (r) =>
      !utilisees.has(r.id) && r.id !== actuelle.id && estEligible(r, jour)
  )
  if (eligibles.length === 0) return null

  const choisie = choisirAleatoire(eligibles)

  // Reconstruction immuable : seul le jour ciblé est recréé.
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return typeRepas === "diner"
      ? { ...jp, diner: choisie }
      : { ...jp, dejeuner: choisie }
  })

  return { semaine: planning.semaine, jours }
}
