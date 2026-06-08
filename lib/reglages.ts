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

  return {
    personnesDefaut: personnes,
    plafonds: { dejeunerSemaine, dinerSemaine, dejeunerWeekend, dinerWeekend },
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
  }
}

export function reglagesToDb(r: ReglagesGeneration): DbReglages {
  return {
    personnes_defaut: r.personnesDefaut,
    max_dejeuner_semaine: r.plafonds.dejeunerSemaine,
    max_diner_semaine: r.plafonds.dinerSemaine,
    max_dejeuner_weekend: r.plafonds.dejeunerWeekend,
    max_diner_weekend: r.plafonds.dinerWeekend,
  }
}
