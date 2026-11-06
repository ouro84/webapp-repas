// Référence stable d'un article de la liste de courses (#372).
//
// Chaîne opaque exposée à l'assistant (`lire_liste_courses`) et à l'exécuteur
// de panier (`prendre_demande_panier`), qu'ils recopient telle quelle dans
// `cocher_article` / `cocher_article_demande`. Elle désigne un article sans
// ambiguïté là où le libellé ne suffit pas : même nom en deux unités, article
// manuel homonyme d'un ingrédient.
//
// - ingrédient : `ing:<cleAgregation>` (nom en minuscules + unité, la clé des coches) ;
// - article manuel : `man:<id>` (RG-42 : jamais fusionné, l'id le distingue).

import { cleAgregation } from "@/lib/courses"
import type { Ingredient } from "@/types"

const PREFIXE_INGREDIENT = "ing:"
const PREFIXE_MANUEL = "man:"

export type RefLue = { sorte: "ing"; cle: string } | { sorte: "man"; id: string }

export function refArticle(i: Ingredient): string {
  return i.source === "manuel" && i.id !== undefined
    ? `${PREFIXE_MANUEL}${i.id}`
    : `${PREFIXE_INGREDIENT}${cleAgregation(i)}`
}

/** Relit une `ref` ; `null` si la chaîne n'en est pas une (préfixe inconnu ou corps vide). */
export function lireRef(ref: string): RefLue | null {
  if (ref.startsWith(PREFIXE_INGREDIENT) && ref.length > PREFIXE_INGREDIENT.length) {
    return { sorte: "ing", cle: ref.slice(PREFIXE_INGREDIENT.length) }
  }
  if (ref.startsWith(PREFIXE_MANUEL) && ref.length > PREFIXE_MANUEL.length) {
    return { sorte: "man", id: ref.slice(PREFIXE_MANUEL.length) }
  }
  return null
}
