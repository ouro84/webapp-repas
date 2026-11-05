import { describe, it, expect } from "vitest"
import { lienPlanningSemaine, lireLienSemaine } from "@/lib/lien-semaine"

const MAINTENANT = new Date("2026-11-07T12:00:00") // samedi, semaine 2026-W45

describe("lien vers une semaine du planning (#336)", () => {
  it("construit le chemin", () => {
    expect(lienPlanningSemaine("2026-W45")).toBe("/planning?semaine=2026-W45")
  })

  it("accepte la semaine courante et la suivante", () => {
    expect(lireLienSemaine("2026-W45", MAINTENANT, 12, 6)).toBe("2026-W45")
    expect(lireLienSemaine("2026-W46", MAINTENANT, 12, 6)).toBe("2026-W46")
  })

  it("refuse un format invalide, une semaine inexistante ou hors plage", () => {
    expect(lireLienSemaine(null, MAINTENANT, 12, 6)).toBeNull()
    expect(lireLienSemaine("2026-45", MAINTENANT, 12, 6)).toBeNull()
    expect(lireLienSemaine("2026-W60", MAINTENANT, 12, 6)).toBeNull()
    expect(lireLienSemaine("2026-W52", MAINTENANT, 12, 6)).toBeNull() // +7
    expect(lireLienSemaine("2026-W32", MAINTENANT, 12, 6)).toBeNull() // −13
    expect(lireLienSemaine("2026-W33", MAINTENANT, 12, 6)).toBe("2026-W33") // −12
  })
})
