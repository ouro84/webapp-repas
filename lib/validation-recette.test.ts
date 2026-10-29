// Validation d'une saisie de recette (#306, RG-76) : la même règle sert le
// formulaire de l'UI et l'outil MCP ajouter_recette.

import { describe, expect, it } from "vitest"
import { validerSaisieRecette } from "@/lib/validation-recette"
import type { SaisieRecette } from "@/lib/recettes"

function saisie(modif: Partial<SaisieRecette> = {}): SaisieRecette {
  return {
    nom: "Soupe",
    tempsPreparation: "rapide",
    vegetarien: true,
    accompagnement: null,
    saisons: [],
    etapes: [],
    ingredients: [{ nom: "sel", quantite: 1, unite: "cac", categorie: "epicerie", fondDePlacard: true }],
    ...modif,
  }
}

describe("validerSaisieRecette", () => {
  it("saisie valide : null", () => {
    expect(validerSaisieRecette(saisie())).toBeNull()
  })

  it("nom vide", () => {
    expect(validerSaisieRecette(saisie({ nom: "  " }))).toBe("Donne un nom à la recette.")
  })

  it("aucun ingrédient", () => {
    expect(validerSaisieRecette(saisie({ ingredients: [] }))).toBe("Ajoute au moins un ingrédient.")
  })

  it("nom d'ingrédient vide", () => {
    const ingredients = [{ ...saisie().ingredients[0], nom: " " }]
    expect(validerSaisieRecette(saisie({ ingredients }))).toBe("Chaque ingrédient doit avoir un nom.")
  })

  it("quantité nulle ou non finie", () => {
    for (const quantite of [0, Number.NaN, -1]) {
      const ingredients = [{ ...saisie().ingredients[0], quantite }]
      expect(validerSaisieRecette(saisie({ ingredients }))).toBe("Quantité invalide pour « sel ».")
    }
  })

  it("nom d'ingrédient de plus de 100 caractères (contrainte ingredient_nom_longueur)", () => {
    const nom = "a".repeat(101)
    const ingredients = [{ ...saisie().ingredients[0], nom }]
    expect(validerSaisieRecette(saisie({ ingredients }))).toBe(
      `Nom d’ingrédient trop long : « ${nom} » (100 caractères maximum).`
    )
  })
})
