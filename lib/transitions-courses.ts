// Noms de View Transition de la liste de courses — logique pure (sans UI)
//
// Extrait de app/courses/page.tsx pour être importable par lib/coches.ts
// (cibleAtterrissage) et testable en isolation.
//
// Ces noms alimentent `view-transition-name`, qui anime le glissement d'un
// article coché en bas de sa catégorie (RG-11) et d'une catégorie terminée
// en bas de liste (RG-39). Le vocabulaire d'animation associé vit dans
// app/globals.css (classes `.vt-ligne-courses` / `.vt-bloc-categorie`).

import type { CategorieIngredient, Ingredient } from "@/types"

/**
 * `view-transition-name` exige un identifiant CSS valide et unique : on
 * dérive un slug ASCII de la clé d'agrégation (accents décomposés puis
 * caractères hors [a-z0-9] remplacés). Unicité garantie par l'agrégation
 * RG-05 : une seule ligne par nom|unité dans toute la liste.
 *
 * Un article MANUEL (#216) porte un id STABLE et UNIQUE (contrairement à la
 * clé nom|unité, qui peut se répéter entre deux articles manuels de même
 * libellé, doublons autorisés RG-42) — la base du slug doit l'utiliser pour
 * que view-transition-name reste unique par élément rendu.
 */
export function nomTransition(ingredient: Ingredient): string {
  const base =
    ingredient.source === "manuel" && ingredient.id
      ? ingredient.id
      : `${ingredient.nom}-${ingredient.unite}`
  const slug = base
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques décomposés par NFD
    .replace(/[^a-z0-9]+/g, "-")
  return `article-${slug}`
}

/**
 * Nom de transition d'une section de catégorie (#111) : permet d'animer le
 * glissement d'une catégorie terminée vers le bas via View Transitions, comme
 * les articles cochés (RG-11). La clé de catégorie est déjà un slug ASCII.
 */
export function nomTransitionCategorie(cle: CategorieIngredient | string): string {
  return `categorie-${cle}`
}

/**
 * Nom de transition de la section « Fond de placard ». Elle ne se réordonne
 * JAMAIS (toujours en dernier, hors progression RG-14) — on la nomme quand
 * même parce que ses `<li>` sont nommés, donc EXTRAITS du snapshot racine :
 * sans groupe propre, son chrome (fond, titre) sauterait d'un coup avec la
 * racine pendant que ses lignes glissent. Cf. « règle du groupe uniforme »
 * dans app/globals.css.
 */
export const NOM_TRANSITION_FOND_DE_PLACARD = "categorie-fond-de-placard"
