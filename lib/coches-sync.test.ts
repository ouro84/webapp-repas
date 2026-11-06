import { describe, expect, it } from "vitest"
import { deriverOps } from "@/lib/coches-sync"

describe("deriverOps", () => {
  it("ne dérive rien quand l'état est inchangé", () => {
    const etat = { "tomates|piece": 3, "riz|g": 200 }
    expect(deriverOps(etat, etat)).toEqual([])
  })

  it("dérive un cocher pour une clé ajoutée", () => {
    expect(deriverOps({}, { "tomates|piece": 3 })).toEqual([
      { type: "cocher", cle: "tomates|piece", quantite: 3 },
    ])
  })

  it("dérive un cocher quand la quantité change (RG-12)", () => {
    expect(
      deriverOps({ "tomates|piece": 3 }, { "tomates|piece": 5 })
    ).toEqual([{ type: "cocher", cle: "tomates|piece", quantite: 5 }])
  })

  it("dérive un decocher pour une clé disparue", () => {
    expect(deriverOps({ "tomates|piece": 3 }, {})).toEqual([
      { type: "decocher", cle: "tomates|piece" },
    ])
  })

  it("gère ajouts et retraits simultanés", () => {
    const ops = deriverOps(
      { "a|g": 1, "b|g": 2 },
      { "b|g": 2, "c|g": 3 }
    )
    expect(ops).toContainEqual({ type: "cocher", cle: "c|g", quantite: 3 })
    expect(ops).toContainEqual({ type: "decocher", cle: "a|g" })
    expect(ops).toHaveLength(2)
  })
})
