import { describe, expect, it } from "vitest"
import { signaturePlanning } from "@/lib/planning-diff"
import type { Planning, Recette } from "@/types"

function recette(id: string): Recette {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] }
}

function planning(): Planning {
  return {
    semaine: "2026-W24",
    jours: [
      {
        jour: "lundi",
        dejeuner: recette("r1"),
        diner: recette("r2"),
        personnes: { dejeuner: 2, diner: 4 },
      },
      { jour: "mardi", diner: recette("r3") },
    ],
  }
}

describe("signaturePlanning", () => {
  it("null → chaîne vide", () => {
    expect(signaturePlanning(null)).toBe("")
  })

  it("est stable quel que soit l'ordre des jours", () => {
    const p = planning()
    const inverse: Planning = { ...p, jours: [...p.jours].reverse() }
    expect(signaturePlanning(inverse)).toBe(signaturePlanning(p))
  })

  it("change si une recette de slot change", () => {
    const p = planning()
    const modifie: Planning = {
      ...p,
      jours: [{ ...p.jours[0]!, diner: recette("AUTRE") }, p.jours[1]!],
    }
    expect(signaturePlanning(modifie)).not.toBe(signaturePlanning(p))
  })

  it("change si le nombre de personnes change", () => {
    const p = planning()
    const modifie: Planning = {
      ...p,
      jours: [
        { ...p.jours[0]!, personnes: { dejeuner: 2, diner: 6 } },
        p.jours[1]!,
      ],
    }
    expect(signaturePlanning(modifie)).not.toBe(signaturePlanning(p))
  })

  it("change si un flag restes change", () => {
    const p = planning()
    const modifie: Planning = {
      ...p,
      jours: [{ ...p.jours[0]!, restes: { diner: true } }, p.jours[1]!],
    }
    expect(signaturePlanning(modifie)).not.toBe(signaturePlanning(p))
  })

  it("identique pour deux plannings au même contenu", () => {
    expect(signaturePlanning(planning())).toBe(signaturePlanning(planning()))
  })
})
