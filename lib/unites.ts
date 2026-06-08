// Affichage des unités et quantités d'ingrédients — partagé entre la liste de
// courses (US-03) et la fiche de recette (US-10), pour un rendu cohérent.
//
// Logique pure (sans UI) : se teste sans navigateur.

import { accorderLibelleUnite } from "@/lib/pluriels"
import type { Ingredient, Unite } from "@/types"

// Libellé d'unité affiché à droite de la quantité. Chaîne vide = on n'affiche
// que le nombre : "piece" (ex: "3"), "autre" (unité précisée dans le nom de
// l'ingrédient, SPECS 5.3).
export const LIBELLES_UNITES: Record<Unite, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  cl: "cl",
  l: "l",
  piece: "",
  briquette: "briquette",
  bouteille: "bouteille",
  boite: "boîte",
  sachet: "sachet",
  cas: "c.à.s",
  cac: "c.à.c",
  autre: "",
}

// "400 g", "20 cl", "2 c.à.s" — et juste "3" pour les pièces.
export function formaterQuantite(ingredient: Ingredient): string {
  const libelle = LIBELLES_UNITES[ingredient.unite]
  if (libelle === "") return String(ingredient.quantite)
  // Accord du libellé d'unité conteneur : « 2 sachets » (#33).
  const accorde = accorderLibelleUnite(libelle, ingredient.unite, ingredient.quantite)
  return `${ingredient.quantite} ${accorde}`
}
