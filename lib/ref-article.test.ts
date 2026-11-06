// Référence stable d'un article de la liste de courses (#372).

import { describe, expect, it } from "vitest"
import { cleAgregation } from "@/lib/courses"
import { lireRef, refArticle } from "@/lib/ref-article"
import type { Ingredient } from "@/types"

const ing = (modif: Partial<Ingredient> = {}): Ingredient => ({
  nom: "Lait",
  quantite: 1,
  unite: "l",
  categorie: "produits-frais",
  fondDePlacard: false,
  ...modif,
})

describe("refArticle (#372)", () => {
  it("ingrédient : ing: + cleAgregation", () => {
    const lait = ing()
    expect(refArticle(lait)).toBe("ing:lait|l")
    expect(refArticle(lait)).toBe(`ing:${cleAgregation(lait)}`)
  })

  it("même nom, unités différentes : deux ref distinctes", () => {
    expect(refArticle(ing({ unite: "l" }))).not.toBe(refArticle(ing({ unite: "g" })))
  })

  it("article manuel : man: + id, jamais la clé d'agrégation", () => {
    expect(refArticle(ing({ source: "manuel", id: "a1", unite: "piece" }))).toBe("man:a1")
  })
})

describe("lireRef (#372)", () => {
  it("aller-retour ingrédient et article manuel", () => {
    expect(lireRef(refArticle(ing()))).toEqual({ sorte: "ing", cle: "lait|l" })
    expect(lireRef(refArticle(ing({ source: "manuel", id: "a1" })))).toEqual({ sorte: "man", id: "a1" })
  })

  it("chaîne qui n'est pas une ref : null", () => {
    for (const ref of ["x", "", "ing:", "man:", "lait|l", "autre:a1"]) {
      expect(lireRef(ref), ref).toBeNull()
    }
  })
})
