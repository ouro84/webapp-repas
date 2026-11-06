// lib/lecture-cycle.ts
// Lecteur de cycle unique (chantier 05) : semaines ISO touchées → plannings par
// semaine → planning recombiné. Une seule recette de lecture, une seule
// sémantique d'échec, pour /courses, la vue Cycle et les synchros (#257).
//
// Client injecté (convention de lib/persistance.ts, #304) ; défaut = client
// navigateur, refusé hors navigateur par `clientParDefaut`.

import { planningDuCycle, semainesDuCycle } from "@/lib/cycles"
import { chargerPlanningDistant } from "@/lib/persistance"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Planning } from "@/types"

export type CycleLu = {
  /** Semaines ISO touchées par le cycle, en ordre chronologique. */
  semaines: string[]
  /** Plannings des seules semaines ayant une ligne en base. */
  parSemaine: Map<string, Planning>
  /** Planning synthétique limité aux jours du cycle (`semaine` = ancre). */
  planning: Planning
}

/**
 * Au moins une semaine du cycle n'a pas pu être lue. Jamais de projection
 * partielle : un `.catch(() => null)` par semaine faisait disparaître la
 * semaine minoritaire du cycle sans signal (cf. courses-cycle.md). L'appelant
 * garde sa politique de présentation (propager, journaliser, toast).
 */
export class ErreurLectureCycle extends Error {
  readonly semainesEnEchec: string[]
  readonly causes: unknown[]

  constructor(semainesEnEchec: string[], causes: unknown[]) {
    super(`Lecture du cycle échouée (semaines : ${semainesEnEchec.join(", ")}).`)
    this.name = "ErreurLectureCycle"
    this.semainesEnEchec = semainesEnEchec
    this.causes = causes
  }
}

/**
 * Lit toutes les semaines du cycle en parallèle. Semaine sans ligne : ignorée.
 * Lecture en échec : rejette `ErreurLectureCycle` (semaines en échec dans
 * l'ordre du cycle, causes d'origine alignées).
 */
export async function lireCycle(
  { ancre, longueur }: { ancre: string; longueur: number },
  supabase: ClientSupabase = clientParDefaut(),
): Promise<CycleLu> {
  const semaines = semainesDuCycle(ancre, longueur)
  const resultats = await Promise.allSettled(
    semaines.map((semaine) => chargerPlanningDistant(semaine, supabase)),
  )

  const semainesEnEchec: string[] = []
  const causes: unknown[] = []
  const parSemaine = new Map<string, Planning>()
  resultats.forEach((resultat, i) => {
    if (resultat.status === "rejected") {
      semainesEnEchec.push(semaines[i])
      causes.push(resultat.reason)
    } else if (resultat.value) {
      parSemaine.set(semaines[i], resultat.value.planning)
    }
  })
  if (semainesEnEchec.length > 0) throw new ErreurLectureCycle(semainesEnEchec, causes)

  return {
    semaines,
    parSemaine,
    planning: planningDuCycle([...parSemaine.values()], ancre, longueur),
  }
}
