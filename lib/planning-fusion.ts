// Fusion des éditions locales en attente avec un planning distant — logique
// PURE (#355, US-21). Aucune I/O, aucune mutation des arguments.
//
// Contexte : quand l’alerte temps réel US-21 déclenche une relecture alors que
// des éditions locales ne sont pas encore poussées (stepper, restes, échange de
// recette), remplacer le planning local par le distant les ferait disparaître.
// Décision produit : on REJOUE les éditions locales sur les créneaux que le
// distant n’a pas touchés ; sur un même créneau modifié des deux côtés, le
// DISTANT GAGNE (l’alerte le signale).
//
// Un créneau = (jour, typeRepas). Son contenu comparé = id de recette (ou
// absence), personnes (défaut 2, RG-16), drapeau restes (défaut faux, RG-22) :
// même définition que `signaturePlanning` (lib/planning-diff.ts), pour que
// « personnes absentes » et « 2 explicite » ne comptent jamais comme une
// modification (#352).

import type { Jour, JourPlanning, Planning } from "@/types"
import { personnesDuSlot } from "@/lib/personnes"
import { estRestes } from "@/lib/restes"

type TypeRepas = "dejeuner" | "diner"

/** Clé d’un créneau : `"lundi:diner"`. */
export type CleCreneau = `${Jour}:${TypeRepas}`

const JOURS: readonly Jour[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
]
const TYPES_REPAS: readonly TypeRepas[] = ["dejeuner", "diner"]

function cle(jour: Jour, typeRepas: TypeRepas): CleCreneau {
  return `${jour}:${typeRepas}`
}

/** Ordre stable : jour de la semaine, puis déjeuner avant dîner. */
function comparerCles(a: CleCreneau, b: CleCreneau): number {
  const [ja, ta] = a.split(":") as [Jour, TypeRepas]
  const [jb, tb] = b.split(":") as [Jour, TypeRepas]
  return (
    JOURS.indexOf(ja) - JOURS.indexOf(jb) ||
    TYPES_REPAS.indexOf(ta) - TYPES_REPAS.indexOf(tb)
  )
}

function jourDe(planning: Planning, jour: Jour): JourPlanning | undefined {
  return planning.jours.find((jp) => jp.jour === jour)
}

/** Empreinte du contenu d’un créneau (jour absent = créneau vide, défauts). */
function contenu(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas
): string {
  const jp = jourDe(planning, jour)
  if (!jp) return `|${personnesDuSlot({ jour }, typeRepas)}|0`
  return [
    jp[typeRepas]?.id ?? "",
    personnesDuSlot(jp, typeRepas),
    estRestes(jp, typeRepas) ? "1" : "0",
  ].join("|")
}

/** Tous les créneaux mentionnés par au moins un des plannings. */
function creneauxConnus(...plannings: Planning[]): CleCreneau[] {
  const connus = new Set<CleCreneau>()
  for (const p of plannings) {
    for (const jp of p.jours) {
      for (const t of TYPES_REPAS) connus.add(cle(jp.jour, t))
    }
  }
  return [...connus].sort(comparerCles)
}

/**
 * Créneaux dont le contenu (recette, personnes avec défaut 2, restes) diffère
 * entre `reference` et `autre`. Un jour absent d’un planning vaut créneaux
 * vides, personnes par défaut.
 */
export function creneauxModifies(
  reference: Planning,
  autre: Planning
): Set<CleCreneau> {
  const modifies = new Set<CleCreneau>()
  for (const k of creneauxConnus(reference, autre)) {
    const [jour, typeRepas] = k.split(":") as [Jour, TypeRepas]
    if (contenu(reference, jour, typeRepas) !== contenu(autre, jour, typeRepas)) {
      modifies.add(k)
    }
  }
  return modifies
}

/** Copie du jour `cible` où le créneau `typeRepas` prend le contenu de `source`. */
function reappliquerCreneau(
  cible: JourPlanning,
  source: JourPlanning | undefined,
  typeRepas: TypeRepas
): JourPlanning {
  const jour: JourPlanning = { ...cible }
  const recette = source?.[typeRepas]
  if (recette) jour[typeRepas] = recette
  else delete jour[typeRepas]

  const personnes = source
    ? personnesDuSlot(source, typeRepas)
    : personnesDuSlot({ jour: cible.jour }, typeRepas)
  jour.personnes = { ...cible.personnes, [typeRepas]: personnes }

  const restes = { ...cible.restes }
  if (source && estRestes(source, typeRepas)) restes[typeRepas] = true
  else delete restes[typeRepas]
  if (Object.keys(restes).length > 0) jour.restes = restes
  else delete jour.restes

  return jour
}

/**
 * Part du `distant` et y réapplique le contenu `local` des créneaux modifiés
 * localement (`local` ≠ `confirme`) ET non modifiés à distance (`distant` =
 * `confirme`).
 *
 * - `rejoues` : créneaux réappliqués (à repousser vers le serveur) ;
 * - `conflits` : créneaux modifiés des deux côtés vers des contenus différents
 *   — le distant gagne, la version locale est perdue (l’alerte US-21 le
 *   signale). Modifiés des deux côtés vers le même contenu : ni rejoués ni en
 *   conflit (rien n’est perdu).
 *
 * `confirme` = dernier planning connu du serveur (base de comparaison des
 * éditions locales). Retourne un nouveau planning ; les entrées ne sont pas
 * mutées.
 */
export function fusionnerEditionsLocales(
  confirme: Planning,
  local: Planning,
  distant: Planning
): { planning: Planning; rejoues: CleCreneau[]; conflits: CleCreneau[] } {
  const modifiesLocal = creneauxModifies(confirme, local)
  const modifiesDistant = creneauxModifies(confirme, distant)

  const rejoues: CleCreneau[] = []
  const conflits: CleCreneau[] = []
  for (const k of [...modifiesLocal].sort(comparerCles)) {
    if (!modifiesDistant.has(k)) {
      rejoues.push(k)
      continue
    }
    // Modifié des deux côtés vers le MÊME contenu (même recette, mêmes
    // personnes, mêmes restes) : rien à rejouer ni rien de perdu (#355).
    const [jour, typeRepas] = k.split(":") as [Jour, TypeRepas]
    if (contenu(local, jour, typeRepas) !== contenu(distant, jour, typeRepas)) {
      conflits.push(k)
    }
  }

  let jours: JourPlanning[] = [...distant.jours]
  for (const k of rejoues) {
    const [jour, typeRepas] = k.split(":") as [Jour, TypeRepas]
    const source = jourDe(local, jour)
    const existant = jours.find((jp) => jp.jour === jour)
    if (existant) {
      jours = jours.map((jp) =>
        jp === existant ? reappliquerCreneau(jp, source, typeRepas) : jp
      )
    } else {
      // Jour absent du distant : on le recrée, à sa place dans la semaine.
      const cree = reappliquerCreneau({ jour }, source, typeRepas)
      const rang = JOURS.indexOf(jour)
      const idx = jours.findIndex((jp) => JOURS.indexOf(jp.jour) > rang)
      if (idx === -1) jours.push(cree)
      else jours.splice(idx, 0, cree)
    }
  }

  return { planning: { ...distant, jours }, rejoues, conflits }
}
