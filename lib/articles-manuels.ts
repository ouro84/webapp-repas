// Articles manuels de la liste de courses — logique métier pure (sans UI).
//
// Implémente les règles RG-40 à RG-43 de SPECS_FONCTIONNELLES.md (US-47).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en
// isolation (cf. lib/courses.ts, lib/coches.ts pour l'esprit du module).
//
// Architecture (décidée au brainstorming du 2026-07-15, cf. commentaire de
// suivi sur l'issue #216) : un article manuel est mappé vers la MÊME forme
// d'affichage qu'un ingrédient dérivé de recette (type Ingredient), avec un
// discriminant `source: "manuel"` qui porte son id et son état coché propre
// (cf. lib/coches.ts, estCoche()). Une fois mappé, il est fusionné dans la
// ListeCourses AVANT application du tri existant (trierCategoriesAvecCoches,
// trierAvecCoches) — pas de duplication de la logique RG-05/RG-11/RG-39.

import { ORDRE_CATEGORIES } from "@/lib/courses"
import type { ArticleManuel, Ingredient, ListeCourses, LignesCourses } from "@/types"

// Tri alphabétique français (accents et casse neutralisés) — même convention
// que lib/courses.ts (comparerNoms, non exportée : duplication volontaire
// d'une ligne plutôt qu'un couplage inter-module pour un détail de tri).
function comparerNoms(a: Ingredient, b: Ingredient): number {
  return a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" })
}

/**
 * Mappe un article manuel vers la forme d'affichage Ingredient (RG-43).
 * Quantité/unité absentes (non renseignées à la saisie) sont neutralisées
 * pour l'affichage (0 / "piece") — cf. aQuantiteRenseignee pour masquer le
 * chip de quantité côté UI plutôt que d'afficher "0".
 */
export function articleManuelVersIngredient(article: ArticleManuel): Ingredient {
  return {
    nom: article.libelle,
    quantite: article.quantite ?? 0,
    unite: article.unite ?? "piece",
    categorie: article.categorie,
    fondDePlacard: article.fondDePlacard,
    id: article.id,
    source: "manuel",
    coche: article.coche,
  }
}

/** Vrai si une quantité a réellement été saisie pour cet article (RG-43) —
 *  distingue "0 non renseigné" d'une vraie valeur affichable. */
export function aQuantiteRenseignee(ingredient: Ingredient): boolean {
  return ingredient.source === "manuel" ? ingredient.quantite > 0 : true
}

/**
 * Fusionne des articles manuels dans une ListeCourses déjà agrégée depuis le
 * planning (RG-05), sans dupliquer la logique de tri : chaque article rejoint
 * la section de sa catégorie (créée si absente, au bon rang de
 * ORDRE_CATEGORIES) ou la section fond de placard. Ne mute pas `liste`.
 */
export function fusionnerArticlesManuels(
  liste: ListeCourses,
  articles: ArticleManuel[]
): ListeCourses {
  if (articles.length === 0) return liste

  const ingredients = articles.map(articleManuelVersIngredient)
  const normaux = ingredients.filter((i) => !i.fondDePlacard)
  const placard = ingredients.filter((i) => i.fondDePlacard)

  const parCategorie = new Map(
    liste.normal.map((ligne) => [ligne.categorie, [...ligne.ingredients]])
  )
  for (const ingredient of normaux) {
    const existants = parCategorie.get(ingredient.categorie) ?? []
    existants.push(ingredient)
    parCategorie.set(ingredient.categorie, existants)
  }
  for (const existants of parCategorie.values()) {
    existants.sort(comparerNoms)
  }

  const normal: LignesCourses[] = ORDRE_CATEGORIES.filter(
    (categorie) => (parCategorie.get(categorie)?.length ?? 0) > 0
  ).map((categorie) => ({ categorie, ingredients: parCategorie.get(categorie)! }))

  return {
    normal,
    fondDePlacard: [...liste.fondDePlacard, ...placard].sort(comparerNoms),
  }
}
