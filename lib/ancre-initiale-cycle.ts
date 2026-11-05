// lib/ancre-initiale-cycle.ts
// Cycle affiché au montage de la vue Cycle de /planning (#352), et repli du jour
// de courses partagé avec /courses. Dépendances injectées : testable sans réseau.
//
// Lien profond `/planning?cycle=` (#320, RG-87) : la résolution du lien et la
// lecture du jour de courses partent EN PARALLÈLE (deux allers-retours réseau
// indépendants) ; hors plage / invalide / résolution en échec → ancre par défaut.

import { ancreParDefaut } from "@/lib/cycles"
import type { ResolutionAncre } from "@/lib/ancre-cycle"

/**
 * Jour de courses lu, ou lundi (1) si la lecture échoue — repli loggé
 * (CLAUDE.md : toute erreur capturée est loggée). Partagé par la vue Cycle et
 * /courses (règle du jumeau).
 */
export function jourCoursesOuLundi(lecture: Promise<number>): Promise<number> {
  return lecture.catch((erreur: unknown) => {
    console.warn("Jour de courses illisible, lundi par défaut.", erreur)
    return 1
  })
}

/**
 * Jour de courses du foyer et ancre du cycle à afficher au montage. Avec un lien
 * (`lien`), l'ancre résolue par `resoudreLien` (même résolution que le MCP et la
 * route panier) ; sinon, ou si le lien est hors plage / invalide / illisible,
 * l'ancre par défaut (`ancreParDefaut`, décalage week-end inclus, comme /courses).
 */
export async function ancreInitialeCycle({
  chargerJour,
  resoudreLien,
  lien,
  maintenant,
}: {
  chargerJour: () => Promise<number>
  resoudreLien: (date: string) => Promise<ResolutionAncre>
  lien?: string
  maintenant: Date
}): Promise<{ jourCourses: number; ancre: string }> {
  const lectureLien: Promise<string | null> =
    lien === undefined
      ? Promise.resolve(null)
      : resoudreLien(lien).then(
          // hors_plage / invalide : repli silencieux sur le cycle par défaut.
          (res) => (res.ok ? res.ancre : null),
          (erreur: unknown) => {
            console.error("Résolution du cycle du lien échouée (cycle par défaut).", erreur)
            return null
          }
        )
  const [jourCourses, ancreLien] = await Promise.all([
    jourCoursesOuLundi(chargerJour()),
    lectureLien,
  ])
  return { jourCourses, ancre: ancreLien ?? ancreParDefaut(maintenant, jourCourses) }
}
