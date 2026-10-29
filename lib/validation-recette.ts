// Validation d'une saisie de recette — logique pure (#306, RG-76).
//
// Source unique des règles du formulaire de recette (#2) : le formulaire de
// l'UI et l'outil MCP ajouter_recette valident la même saisie, avec les mêmes
// messages. S'ajoute la longueur maximale d'un nom d'ingrédient, que la base
// impose déjà (contrainte ingredient_nom_longueur, #193).

import type { SaisieRecette } from "@/lib/recettes"
import { normaliser } from "@/lib/recherche"

export const NOM_INGREDIENT_MAX = 100

/** `null` si la saisie est valide, sinon le message à afficher. */
export function validerSaisieRecette(saisie: SaisieRecette): string | null {
  if (saisie.nom.trim() === "") return "Donne un nom à la recette."
  if (saisie.ingredients.length === 0) return "Ajoute au moins un ingrédient."
  // Deux lignes du même ingrédient (même rayon, même fond de placard) visent la
  // même ligne recette_ingredient : la base refuserait le doublon (#306).
  const vus = new Set<string>()
  for (const ingredient of saisie.ingredients) {
    const nom = ingredient.nom.trim()
    if (nom === "") return "Chaque ingrédient doit avoir un nom."
    const cle = `${normaliser(nom)}|${ingredient.categorie}|${ingredient.fondDePlacard}`
    if (vus.has(cle)) return `Ingrédient en double : « ${nom} ». Additionne les quantités sur une seule ligne.`
    vus.add(cle)
    if (nom.length > NOM_INGREDIENT_MAX) {
      return `Nom d’ingrédient trop long : « ${nom} » (${NOM_INGREDIENT_MAX} caractères maximum).`
    }
    if (!Number.isFinite(ingredient.quantite) || ingredient.quantite <= 0) {
      return `Quantité invalide pour « ${nom} ».`
    }
  }
  return null
}
