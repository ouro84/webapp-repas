// Coches de la liste de courses — logique métier pure (sans UI)
//
// Implémente les règles RG-10 à RG-14 de SPECS_FONCTIONNELLES.md (US-05).
// Aucune dépendance à React ou au navigateur : testable en isolation.
//
// Une coche est accrochée à la clé d'agrégation `nom|unité` (RG-05) et
// mémorise la QUANTITÉ de l'article au moment du cochage. Si la quantité
// actuelle diffère (remplacement de slot qui change l'agrégat, US-04),
// la coche est silencieusement invalidée (RG-12) : l'utilisateur doit
// revérifier cet article, le reste de son chariot est préservé.

import { cleAgregation } from "@/lib/courses"
import type { Ingredient, LignesCourses, ListeCourses } from "@/types"

// Clé d'agrégation → quantité au moment du cochage (RG-12).
export type Coches = Record<string, number>

/**
 * Désérialise le contenu brut de localStorage["courses_cochees"].
 * Donnée absente, corrompue ou de forme inattendue → aucune coche.
 */
export function parserCoches(brut: string | null): Coches {
  if (brut === null) return {}
  try {
    const valeur: unknown = JSON.parse(brut)
    if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) {
      return {}
    }
    // Ne garde que les entrées bien formées (quantité numérique).
    const coches: Coches = {}
    for (const [cle, quantite] of Object.entries(valeur)) {
      if (typeof quantite === "number" && Number.isFinite(quantite)) {
        coches[cle] = quantite
      }
    }
    return coches
  } catch {
    // Donnée illisible : on repart sans coche, la prochaine écriture
    // remplacera la valeur corrompue. Pas de log : cas attendu et bénin.
    return {}
  }
}

/**
 * Une coche n'est valide que si la quantité n'a pas changé (RG-12).
 *
 * Un article MANUEL (#216, discriminant `source: "manuel"`) porte son état
 * coché directement sur la ligne (table `article_manuel` dédiée) plutôt que
 * dans le blob `coches` par clé nom|unité — il est exempt de l'invalidation
 * RG-12 (pas de notion de quantité recalculée) et de toute collision de clé
 * avec un ingrédient dérivé de recette portant le même nom/unité.
 */
export function estCoche(coches: Coches, ingredient: Ingredient): boolean {
  if (ingredient.source === "manuel") return ingredient.coche === true
  return coches[cleAgregation(ingredient)] === ingredient.quantite
}

/**
 * Bascule l'état coché d'un article (RG-10). Retourne un nouvel objet,
 * sans muter l'entrée. Cocher mémorise la quantité courante ; décocher
 * retire l'entrée (y compris une coche invalidée par changement de
 * quantité : re-cocher écrase simplement l'ancienne valeur).
 */
export function basculerCoche(coches: Coches, ingredient: Ingredient): Coches {
  const cle = cleAgregation(ingredient)
  const suivantes = { ...coches }
  if (estCoche(coches, ingredient)) {
    delete suivantes[cle]
  } else {
    suivantes[cle] = ingredient.quantite
  }
  return suivantes
}

/**
 * Trie les articles d'une catégorie pour l'affichage (RG-11) :
 * non cochés d'abord, cochés en fin — chaque groupe en ordre alphabétique
 * (l'entrée est déjà triée par genererListeCourses, le tri est stable).
 */
export function trierAvecCoches(
  ingredients: Ingredient[],
  coches: Coches
): Ingredient[] {
  const nonCoches = ingredients.filter((i) => !estCoche(coches, i))
  const cochesEnFin = ingredients.filter((i) => estCoche(coches, i))
  return [...nonCoches, ...cochesEnFin]
}

/**
 * Une catégorie est « terminée » (RG-39, #111) quand elle contient au moins
 * un article ET que tous ses articles sont cochés (coches valides, RG-12).
 * Une catégorie vide n'est jamais terminée.
 */
export function categorieTerminee(
  ligne: LignesCourses,
  coches: Coches
): boolean {
  return (
    ligne.ingredients.length > 0 &&
    ligne.ingredients.every((i) => estCoche(coches, i))
  )
}

/**
 * Trie les catégories pour l'affichage (RG-39, #111) : catégories non
 * terminées d'abord (ordre canonique RG-05 préservé), puis catégories
 * terminées (même ordre canonique entre elles). Tri stable : on partitionne
 * sans réordonner à l'intérieur de chaque groupe, ce qui glisse en bas de
 * liste une catégorie dont tous les articles viennent d'être cochés.
 */
export function trierCategoriesAvecCoches(
  lignes: LignesCourses[],
  coches: Coches
): LignesCourses[] {
  const enCours = lignes.filter((l) => !categorieTerminee(l, coches))
  const terminees = lignes.filter((l) => categorieTerminee(l, coches))
  return [...enCours, ...terminees]
}

/**
 * Progression « n/N » du header (RG-14) : uniquement les articles à
 * acheter — le fond de placard est cochable mais hors compteur.
 */
export function compterProgression(
  liste: ListeCourses,
  coches: Coches
): { coches: number; total: number } {
  let total = 0
  let nbCoches = 0
  for (const ligne of liste.normal) {
    for (const ingredient of ligne.ingredients) {
      total += 1
      if (estCoche(coches, ingredient)) nbCoches += 1
    }
  }
  return { coches: nbCoches, total }
}

/** Au moins une coche valide, fond de placard compris (bouton « Tout décocher »). */
export function aDesCoches(liste: ListeCourses, coches: Coches): boolean {
  return (
    liste.normal.some((l) => l.ingredients.some((i) => estCoche(coches, i))) ||
    liste.fondDePlacard.some((i) => estCoche(coches, i))
  )
}
