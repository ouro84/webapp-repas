import { describe, it, expect } from "vitest"
import { estRestes, marquerRestes } from "@/lib/restes"
import { genererListeCourses } from "@/lib/courses"
import { recetteFixture } from "./fixtures/recettes"
import type { Planning } from "@/types"

// US-12 / RG-22 : un repas marqué « restes » ne produit aucun article de courses.
// Couvre le cœur pur (l'e2e restes de planning.spec dépend, lui, de la projection
// du cycle #257 et ne peut pas persister un planning fixture).

const omelette = recetteFixture("omelette-aux-champignons")

function planningLundiDiner(restes = false): Planning {
  return {
    semaine: "2026-W28",
    jours: [
      restes
        ? { jour: "lundi", diner: omelette, restes: { diner: true } }
        : { jour: "lundi", diner: omelette },
    ],
  }
}

describe("genererListeCourses — exclusion des restes (RG-22)", () => {
  it("inclut les ingrédients d'un repas normal", () => {
    const liste = genererListeCourses(planningLundiDiner(false))
    const tous = [...liste.normal.flatMap((c) => c.ingredients), ...liste.fondDePlacard]
    expect(tous.some((i) => /oeufs?/i.test(i.nom))).toBe(true)
  })

  it("exclut TOUS les ingrédients d'un repas marqué en restes", () => {
    const liste = genererListeCourses(planningLundiDiner(true))
    expect(liste.normal).toHaveLength(0)
    expect(liste.fondDePlacard).toHaveLength(0)
  })
})

describe("marquerRestes / estRestes (setter immuable)", () => {
  it("marque puis démarque un slot sans muter l'original", () => {
    const base = planningLundiDiner(false)
    const marque = marquerRestes(base, "lundi", "diner", true)
    expect(marque).not.toBeNull()
    expect(estRestes(marque!.jours[0]!, "diner")).toBe(true)
    expect(estRestes(base.jours[0]!, "diner")).toBe(false) // original intact
    const demarque = marquerRestes(marque!, "lundi", "diner", false)
    expect(estRestes(demarque!.jours[0]!, "diner")).toBe(false)
  })
})
