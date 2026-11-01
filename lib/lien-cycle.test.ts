import { describe, expect, it } from "vitest"
import { estLienProfondCycle, lireLienCycle, PARAM_LIEN_CYCLE } from "./lien-cycle"

describe("lireLienCycle (#320, RG-87)", () => {
  it("le paramètre s'appelle cycle", () => {
    expect(PARAM_LIEN_CYCLE).toBe("cycle")
  })

  it("renvoie la date AAAA-MM-JJ valide", () => {
    expect(lireLienCycle("2026-11-09")).toBe("2026-11-09")
  })

  it.each([null, "", "2026-13-01", "2026-02-30", "9/11/2026", "2026-11-09T00:00"])(
    "ignore %j",
    (valeur) => {
      expect(lireLienCycle(valeur)).toBeNull()
    }
  )
})

describe("estLienProfondCycle (#320, RG-87)", () => {
  it("vrai sur /planning avec un paramètre cycle valide", () => {
    expect(estLienProfondCycle("/planning", new URLSearchParams("cycle=2026-11-09"))).toBe(true)
  })

  it("vrai même si la date est invalide (la page l'ignorera)", () => {
    expect(estLienProfondCycle("/planning", new URLSearchParams("cycle=abc"))).toBe(true)
  })

  it("faux sans paramètre cycle", () => {
    expect(estLienProfondCycle("/planning", new URLSearchParams(""))).toBe(false)
  })

  it("faux hors /planning", () => {
    expect(estLienProfondCycle("/courses", new URLSearchParams("cycle=2026-11-09"))).toBe(false)
    expect(estLienProfondCycle("/planningx", new URLSearchParams("cycle=2026-11-09"))).toBe(false)
  })
})
