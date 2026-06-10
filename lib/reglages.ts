// Réglages de génération — cœur métier PUR (#45, P09).
//
// Aucune dépendance React / navigateur / Supabase : importable par le
// générateur (lib/generateur.ts) et testable en isolation. L'accès base de
// données (lecture/écriture sous RLS) vit dans lib/reglages-data.ts.
//
// « Plafond » = temps de préparation MAXIMUM autorisé sur un créneau. Comme les
// temps sont totalement ordonnés (rapide < normal < long), l'éligibilité « ≤
// plafond » généralise la table en dur d'avant #45 : les valeurs par défaut
// (REGLAGES_DEFAUT) reproduisent exactement le comportement antérieur.

import type { ReglagesGeneration, DbReglages, TempsPreparation } from "@/types"
import { PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes"

// Ordre croissant des temps de préparation : le rang sert de comparaison
// (un temps est éligible sur un créneau si son rang ≤ rang du plafond).
export const ORDRE_TEMPS: TempsPreparation[] = ["rapide", "normal", "long"]

export function rangTemps(temps: TempsPreparation): number {
  return ORDRE_TEMPS.indexOf(temps)
}

/** Temps de préparation autorisés sur un créneau de plafond donné (≤ plafond). */
export function tempsAuPlafond(plafond: TempsPreparation): TempsPreparation[] {
  const max = rangTemps(plafond)
  return ORDRE_TEMPS.filter((t) => rangTemps(t) <= max)
}

// Valeurs par défaut = comportement d'avant #45 (cf. ancienne table
// tempsEligibles) : dîner de semaine "rapide", déjeuner de semaine "normal"
// (donc rapide + normal), week-end "long" (tout). Personnes : 2 (RG-16).
export const REGLAGES_DEFAUT: ReglagesGeneration = {
  personnesDefaut: 2,
  plafonds: {
    dejeunerSemaine: "normal",
    dinerSemaine: "rapide",
    dejeunerWeekend: "long",
    dinerWeekend: "long",
  },
}

function estTemps(valeur: unknown): valeur is TempsPreparation {
  return typeof valeur === "string" && ORDRE_TEMPS.includes(valeur as TempsPreparation)
}

// Normalise la préférence végé par créneau (#86 PR2). Optionnelle : `undefined`
// reste `undefined` (= aucune préférence). Si présente, chaque créneau absent
// ou non booléen est ramené à `false` (tolérant : la préférence est souple).
function normaliserVegePrefere(
  brut: unknown
): ReglagesGeneration["vegetarienPrefere"] {
  if (typeof brut !== "object" || brut === null) return undefined
  const v = brut as Record<string, unknown>
  return {
    dejeunerSemaine: v.dejeunerSemaine === true,
    dinerSemaine: v.dinerSemaine === true,
    dejeunerWeekend: v.dejeunerWeekend === true,
    dinerWeekend: v.dinerWeekend === true,
  }
}

/**
 * Valide/normalise des réglages issus d'une saisie (formulaire) ou d'une
 * source non fiable. Renvoie les réglages validés, ou `null` si invalides
 * (plafond hors enum, personnes hors bornes ou non entier). Utilisé par la
 * page de réglages (PR2) et la garde de faisabilité (B3).
 */
export function validerReglages(brut: unknown): ReglagesGeneration | null {
  if (typeof brut !== "object" || brut === null) return null
  const o = brut as Record<string, unknown>
  const p = o.plafonds as Record<string, unknown> | undefined
  if (typeof p !== "object" || p === null) return null

  const personnes = o.personnesDefaut
  if (
    typeof personnes !== "number" ||
    !Number.isInteger(personnes) ||
    personnes < PERSONNES_MIN ||
    personnes > PERSONNES_MAX
  ) {
    return null
  }

  const { dejeunerSemaine, dinerSemaine, dejeunerWeekend, dinerWeekend } = p
  if (
    !estTemps(dejeunerSemaine) ||
    !estTemps(dinerSemaine) ||
    !estTemps(dejeunerWeekend) ||
    !estTemps(dinerWeekend)
  ) {
    return null
  }

  // La préférence végé est optionnelle : absente → on ne la pose pas (pas de
  // régression). Présente → normalisée en 4 booléens.
  const vegetarienPrefere = normaliserVegePrefere(o.vegetarienPrefere)

  // Mix accompagnement (#49 PR2) : optionnel comme la préférence végé. Booléen
  // présent → on le pose ; absent → on ne le pose pas (= désactivé).
  const mixAccompagnementJour =
    typeof o.mixAccompagnementJour === "boolean"
      ? o.mixAccompagnementJour
      : undefined

  return {
    personnesDefaut: personnes,
    plafonds: { dejeunerSemaine, dinerSemaine, dejeunerWeekend, dinerWeekend },
    ...(vegetarienPrefere ? { vegetarienPrefere } : {}),
    ...(mixAccompagnementJour !== undefined ? { mixAccompagnementJour } : {}),
  }
}

// --- Adaptateurs DB ↔ domaine -------------------------------------------------

export function dbReglagesToDomain(db: DbReglages): ReglagesGeneration {
  return {
    personnesDefaut: db.personnes_defaut,
    plafonds: {
      dejeunerSemaine: db.max_dejeuner_semaine,
      dinerSemaine: db.max_diner_semaine,
      dejeunerWeekend: db.max_dejeuner_weekend,
      dinerWeekend: db.max_diner_weekend,
    },
    vegetarienPrefere: {
      dejeunerSemaine: db.vege_dejeuner_semaine,
      dinerSemaine: db.vege_diner_semaine,
      dejeunerWeekend: db.vege_dejeuner_weekend,
      dinerWeekend: db.vege_diner_weekend,
    },
    mixAccompagnementJour: db.mix_accompagnement_jour,
  }
}

export function reglagesToDb(r: ReglagesGeneration): DbReglages {
  const v = r.vegetarienPrefere
  return {
    personnes_defaut: r.personnesDefaut,
    max_dejeuner_semaine: r.plafonds.dejeunerSemaine,
    max_diner_semaine: r.plafonds.dinerSemaine,
    max_dejeuner_weekend: r.plafonds.dejeunerWeekend,
    max_diner_weekend: r.plafonds.dinerWeekend,
    vege_dejeuner_semaine: v?.dejeunerSemaine ?? false,
    vege_diner_semaine: v?.dinerSemaine ?? false,
    vege_dejeuner_weekend: v?.dejeunerWeekend ?? false,
    vege_diner_weekend: v?.dinerWeekend ?? false,
    mix_accompagnement_jour: r.mixAccompagnementJour ?? false,
  }
}
