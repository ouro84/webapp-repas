import { describe, expect, it } from "vitest"
import { datesDeSemaine, localiserRepas, repasAuxDates, validerDate } from "@/lib/mcp/repas"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { RECETTES_FIXTURES } from "@/tests/fixtures/recettes"
import type { JourPlanning, Planning } from "@/types"

const [R0, R1, R2, R3] = RECETTES_FIXTURES

function planning(semaine: string, jours: JourPlanning[]): Planning {
  return { semaine, jours }
}

describe("repasAuxDates (RG-73)", () => {
  it("repasAuxDates : cycle de 14 j ancré un dimanche, 3 semaines ISO, chaque date lit sa semaine", () => {
    // Ancre dimanche 25/10/2026 (W43) → jusqu'au samedi 07/11 (W45).
    const plannings = [
      planning("2026-W43", [{ jour: "dimanche", diner: R0 }]),
      planning("2026-W44", [{ jour: "dimanche", diner: R1 }, { jour: "lundi", diner: R2 }]),
      planning("2026-W45", [{ jour: "samedi", diner: R3 }]),
    ]
    const dates = ["2026-10-25", "2026-10-26", "2026-11-01", "2026-11-07"]
    const repas = repasAuxDates(plannings, dates)
    expect(repas.map((r) => [r.date, r.creneau, r.jp.diner?.id])).toEqual([
      ["2026-10-25", "soir", R0.id],
      ["2026-10-26", "soir", R2.id],
      ["2026-11-01", "soir", R1.id],
      ["2026-11-07", "soir", R3.id],
    ])
    expect(repas[0].jour).toBe("dimanche")
  })

  it("omet les créneaux sans recette et les dates sans planning", () => {
    const plannings = [planning("2026-W44", [{ jour: "jeudi", diner: R0 }])]
    const repas = repasAuxDates(plannings, ["2026-10-29", "2026-10-30", "2026-11-05"])
    expect(repas.map((r) => [r.date, r.creneau])).toEqual([["2026-10-29", "soir"]])
  })

  it("ordonne midi avant soir", () => {
    const plannings = [planning("2026-W44", [{ jour: "samedi", diner: R1, dejeuner: R0 }])]
    const repas = repasAuxDates(plannings, ["2026-10-31"])
    expect(repas.map((r) => r.creneau)).toEqual(["midi", "soir"])
  })
})

describe("datesDeSemaine", () => {
  it("datesDeSemaine('2026-W44') → 2026-10-26 … 2026-11-01", () => {
    expect(datesDeSemaine("2026-W44")).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
      "2026-10-30", "2026-10-31", "2026-11-01",
    ])
  })
})

describe("validerDate", () => {
  it("accepte une date réelle", () => {
    expect(validerDate("2026-10-29")).toBeNull()
    expect(validerDate("2028-02-29")).toBeNull()
  })

  it("validerDate refuse 2026-02-30, 26-10-29, demain", () => {
    for (const date of ["2026-02-30", "26-10-29", "demain", "2026-13-01"]) {
      expect(validerDate(date)).toBe("Date invalide : utilise le format AAAA-MM-JJ (ex. 2026-10-29).")
    }
  })
})

describe("localiserRepas (RG-73)", () => {
  const JEUDI = new Date(2026, 9, 29, 12)

  it("une date de la plage → sa semaine ISO et son jour", () => {
    expect(localiserRepas("2026-10-29", JEUDI)).toEqual({ semaine: "2026-W44", jour: "jeudi" })
  })

  it("date hors plage (+8 semaines) ou invalide → ErreurOutil", () => {
    expect(() => localiserRepas("2026-12-24", JEUDI)).toThrow(ErreurOutil)
    expect(() => localiserRepas("2026-12-24", JEUDI)).toThrow("hors de la plage")
    expect(() => localiserRepas("2026-02-30", JEUDI)).toThrow("Date invalide")
  })
})
