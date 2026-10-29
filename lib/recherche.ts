// Recherche de recettes — logique pure (sans UI)
//
// Filtre la liste du sélecteur de recettes (US-06) : avec un vivier qui
// grandira (CRUD #2), l'utilisateur ne doit pas scroller indéfiniment.
// Aucune dépendance à React ou au navigateur : testable en isolation.

import type { Recette } from "@/types"

// Forme canonique pour la comparaison : minuscules, accents retirés
// (décomposition NFD puis suppression des diacritiques), espaces réduits.
// « Pâtes » ↔ « pates », « creme » ↔ « Crème ».
export function normaliser(texte: string): string {
  return texte
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques décomposés par NFD
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Filtre les recettes dont le nom contient la requête, sans tenir compte
 * de la casse ni des accents. Requête vide (ou espaces) → liste complète.
 * L'ordre d'entrée est préservé.
 */
export function filtrerRecettes(
  recettes: Recette[],
  requete: string
): Recette[] {
  const aiguille = normaliser(requete)
  if (aiguille === "") return recettes
  return recettes.filter((r) => normaliser(r.nom).includes(aiguille))
}

/**
 * Désignation d'une recette par son nom (outils MCP, #306, RG-75) : si un nom
 * est ÉGAL à la requête (casse, accents et espaces ignorés), seule la première
 * recette de ce nom est renvoyée — sinon « Blanquette de veau » resterait
 * ambiguë face à « Blanquette de veau à l'ancienne ». À défaut, toutes les
 * correspondances partielles (filtrerRecettes).
 */
export function rechercherRecettes(recettes: Recette[], requete: string): Recette[] {
  const aiguille = normaliser(requete)
  const exacte = recettes.find((r) => normaliser(r.nom) === aiguille)
  return exacte ? [exacte] : filtrerRecettes(recettes, requete)
}
