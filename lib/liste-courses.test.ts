// Assembleur pur de la liste de courses (#304) — partagé par /courses et le
// service serveur chargerListeCoursesCycle (règle du jumeau).

import { describe, expect, it } from "vitest"
import { assemblerListeCourses, retirerArticlesCoches } from "@/lib/liste-courses"
import { genererListeCourses } from "@/lib/courses"
import { retirerCreneauxDesactives } from "@/lib/generateur"
import { fusionnerArticlesManuels } from "@/lib/articles-manuels"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import type { ArticleManuel, Ingredient, Planning, Recette } from "@/types"

function ingredient(nom: string, categorie: Ingredient["categorie"], fondDePlacard = false): Ingredient {
  return { nom, quantite: 1, unite: "piece", categorie, fondDePlacard }
}
function recette(id: string, ingredients: Ingredient[]): Recette {
  return { id, nom: id, tempsPreparation: "rapide", ingredients }
}
function article(id: string, libelle: string, coche = false): ArticleManuel {
  return {
    id,
    libelle,
    quantite: null,
    unite: null,
    categorie: "epicerie",
    fondDePlacard: false,
    coche,
  }
}

const PAIN = recette("pain-tomate", [
  ingredient("baguette", "boulangerie"),
  ingredient("tomate", "legumes-fruits"),
  ingredient("sel", "epicerie", true),
])
const SOUPE = recette("soupe", [ingredient("poireau", "legumes-fruits")])
const PATES = recette("pates", [ingredient("spaghetti", "epicerie")])

const PLANNING: Planning = {
  semaine: "2026-10-29",
  jours: [
    { jour: "lundi", dejeuner: PAIN, diner: SOUPE },
    { jour: "mardi", diner: PATES },
  ],
}

function noms(liste: ReturnType<typeof assemblerListeCourses>): string[] {
  return [
    ...liste.normal.flatMap((l) => l.ingredients.map((i) => i.nom)),
    ...liste.fondDePlacard.map((i) => i.nom),
  ]
}

describe("assemblerListeCourses", () => {
  it("planning null et aucun article : liste vide", () => {
    expect(assemblerListeCourses(null, REGLAGES_DEFAUT, [])).toEqual({
      normal: [],
      fondDePlacard: [],
    })
  })

  it("créneau désactivé exclu (RG-46)", () => {
    const reglages = {
      ...REGLAGES_DEFAUT,
      plafonds: { ...REGLAGES_DEFAUT.plafonds, dinerSemaine: "aucun" as const },
    }

    const liste = assemblerListeCourses(PLANNING, reglages, [])

    expect(noms(liste)).not.toContain("poireau")
    expect(noms(liste)).not.toContain("spaghetti")
    expect(noms(liste)).toContain("baguette")
  })

  it("articles manuels fusionnés à leur catégorie", () => {
    const liste = assemblerListeCourses(null, REGLAGES_DEFAUT, [article("a1", "Piles")])

    const epicerie = liste.normal.find((l) => l.categorie === "epicerie")
    expect(epicerie?.ingredients.map((i) => [i.nom, i.source])).toEqual([["Piles", "manuel"]])
  })

  it("identique à la composition historique de /courses", () => {
    const articles = [article("a1", "Piles")]

    expect(assemblerListeCourses(PLANNING, REGLAGES_DEFAUT, articles)).toEqual(
      fusionnerArticlesManuels(
        genererListeCourses(retirerCreneauxDesactives(PLANNING, REGLAGES_DEFAUT)),
        articles
      )
    )
  })
})

describe("retirerArticlesCoches (RG-78)", () => {
  it("retire les cochés et les catégories vides", () => {
    const liste = assemblerListeCourses(PLANNING, REGLAGES_DEFAUT, [
      article("a1", "Piles", true),
      article("a2", "Éponges", false),
    ])
    const coches = { "baguette|piece": 1, "sel|piece": 1, "tomate|piece": 1 }

    const restante = retirerArticlesCoches(liste, coches)

    expect(restante.normal.map((l) => l.categorie)).not.toContain("boulangerie")
    expect(noms(restante)).not.toContain("tomate")
    expect(noms(restante)).not.toContain("Piles")
    expect(noms(restante)).toContain("Éponges")
    expect(noms(restante)).toContain("poireau")
    expect(restante.fondDePlacard).toEqual([])
  })
})
