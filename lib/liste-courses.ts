// Composition PURE de la liste de courses d'un cycle (#304) — source unique
// partagée par /courses (stores temps réel) et le service serveur
// chargerListeCoursesCycle (serveur MCP, RG-78). Toute évolution de la
// composition passe ici (règle du jumeau).

import { genererListeCourses } from "@/lib/courses"
import { retirerCreneauxDesactives } from "@/lib/generateur"
import { fusionnerArticlesManuels } from "@/lib/articles-manuels"
import { estCoche, type Coches } from "@/lib/coches"
import type { ArticleManuel, ListeCourses, Planning, ReglagesGeneration } from "@/types"

/**
 * Liste de courses d'un planning projeté : filtre live des créneaux désactivés
 * (#217, RG-46), agrégation par ingrédient (RG-05), puis fusion des articles
 * manuels (#216) à leur catégorie. Un planning `null` (cycle non chargé) ne
 * produit que les articles manuels.
 */
export function assemblerListeCourses(
  planning: Planning | null,
  reglages: ReglagesGeneration,
  articlesManuels: ArticleManuel[]
): ListeCourses {
  const base: ListeCourses = planning
    ? genererListeCourses(retirerCreneauxDesactives(planning, reglages))
    : { normal: [], fondDePlacard: [] }
  return fusionnerArticlesManuels(base, articlesManuels)
}

/**
 * Ne garde que ce qu'il reste à acheter (RG-78, « non cochés par défaut ») :
 * retire tout article coché — ingrédient dérivé (coche valide RG-12) ou article
 * manuel (coche portée par la ligne) — et les catégories devenues vides.
 */
export function retirerArticlesCoches(liste: ListeCourses, coches: Coches): ListeCourses {
  return {
    normal: liste.normal
      .map((ligne) => ({
        ...ligne,
        ingredients: ligne.ingredients.filter((i) => !estCoche(coches, i)),
      }))
      .filter((ligne) => ligne.ingredients.length > 0),
    fondDePlacard: liste.fondDePlacard.filter((i) => !estCoche(coches, i)),
  }
}
