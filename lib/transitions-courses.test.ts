// Tests des noms de View Transition de la liste de courses
// (lib/transitions-courses.ts, RG-11 / RG-39).
//
// Enjeu : `view-transition-name` exige un identifiant CSS VALIDE et UNIQUE.
// Un nom invalide fait silencieusement échouer l'animation ; un nom dupliqué
// fait ABANDONNER toute la transition par le navigateur.

import { describe, expect, it } from "vitest"
import { nomTransition, nomTransitionCategorie } from "@/lib/transitions-courses"
import type { Ingredient } from "@/types"

// Un identifiant CSS valide au sens de ce module : lettre puis [a-z0-9-].
const IDENT_CSS = /^[a-z][a-z0-9-]*$/

function ing(nom: string, unite: Ingredient["unite"] = "g"): Ingredient {
  return { nom, quantite: 1, unite, categorie: "epicerie", fondDePlacard: false }
}

function manuel(id: string, nom = "Piles"): Ingredient {
  return {
    nom,
    quantite: 0,
    unite: "piece",
    categorie: "epicerie",
    fondDePlacard: false,
    source: "manuel",
    id,
    coche: false,
  }
}

describe("nomTransition", () => {
  it("produit un identifiant CSS valide malgré accents, espaces et apostrophes", () => {
    for (const nom of [
      "Crème fraîche",
      "Huile d'olive",
      "Œufs",
      "Pâtes complètes",
      "Bœuf haché 5 %",
      "Ça / Là — ïî",
    ]) {
      expect(nomTransition(ing(nom))).toMatch(IDENT_CSS)
    }
  })

  it("décompose les diacritiques plutôt que de les remplacer par un tiret", () => {
    expect(nomTransition(ing("Crème fraîche"))).toBe("article-creme-fraiche-g")
  })

  it("distingue deux articles de même nom mais d'unité différente (RG-05)", () => {
    expect(nomTransition(ing("Lait", "l"))).not.toBe(nomTransition(ing("Lait", "ml")))
  })

  it("distingue deux articles MANUELS de même libellé par leur id (RG-42)", () => {
    // Doublons de libellé autorisés : sans l'id, les deux <li> porteraient le
    // même view-transition-name et le navigateur abandonnerait la transition.
    expect(nomTransition(manuel("aaa"))).toBe("article-aaa")
    expect(nomTransition(manuel("aaa"))).not.toBe(nomTransition(manuel("bbb")))
  })

  it("retombe sur nom|unité pour un article manuel sans id", () => {
    const sansId: Ingredient = { ...manuel("x"), id: undefined }
    expect(nomTransition(sansId)).toBe("article-piles-piece")
  })
})

describe("nomTransitionCategorie", () => {
  it("préfixe la clé de catégorie, déjà sluggée", () => {
    expect(nomTransitionCategorie("legumes-fruits")).toBe("categorie-legumes-fruits")
    expect(nomTransitionCategorie("viandes-poissons")).toMatch(IDENT_CSS)
  })

  it("ne collisionne jamais avec un nom d'article", () => {
    expect(nomTransitionCategorie("epicerie")).not.toBe(nomTransition(ing("epicerie")))
  })
})
