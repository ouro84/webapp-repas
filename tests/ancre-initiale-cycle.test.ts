// Tests de la résolution du cycle affiché au montage de la vue Cycle (#352) :
// lecture du jour de courses et résolution du lien profond (#320, RG-87) en
// PARALLÈLE, replis loggés (CLAUDE.md : toute erreur capturée est loggée).

import { afterEach, describe, expect, it, vi } from "vitest"
import { ancreInitialeCycle, jourCoursesOuLundi } from "@/lib/ancre-initiale-cycle"
import { ancreParDefaut } from "@/lib/cycles"
import type { ResolutionAncre } from "@/lib/ancre-cycle"

afterEach(() => {
  vi.restoreAllMocks()
})

// Promesse résolue à la main : permet d'observer l'ordre des appels.
function differee<T>() {
  let resoudre!: (v: T) => void
  let rejeter!: (e: unknown) => void
  const promesse = new Promise<T>((res, rej) => {
    resoudre = res
    rejeter = rej
  })
  return { promesse, resoudre, rejeter }
}

const MAINTENANT = new Date("2026-11-05T10:00:00") // jeudi

describe("jourCoursesOuLundi", () => {
  it("renvoie le jour lu", async () => {
    expect(await jourCoursesOuLundi(Promise.resolve(4))).toBe(4)
  })

  it("lecture en échec : lundi (1) et avertissement loggé", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const erreur = new Error("réseau")
    expect(await jourCoursesOuLundi(Promise.reject(erreur))).toBe(1)
    expect(warn).toHaveBeenCalledWith("Jour de courses illisible, lundi par défaut.", erreur)
  })
})

describe("ancreInitialeCycle", () => {
  it("sans lien : ancre par défaut du jour de courses", async () => {
    const res = await ancreInitialeCycle({
      chargerJour: () => Promise.resolve(4),
      resoudreLien: vi.fn(),
      maintenant: MAINTENANT,
    })
    expect(res).toEqual({ jourCourses: 4, ancre: ancreParDefaut(MAINTENANT, 4) })
  })

  it("lien : la résolution démarre sans attendre la lecture du jour de courses", async () => {
    const jour = differee<number>()
    const resoudreLien = vi.fn(
      (): Promise<ResolutionAncre> => Promise.resolve({ ok: true, ancre: "2026-11-12" })
    )
    const resultat = ancreInitialeCycle({
      chargerJour: () => jour.promesse,
      resoudreLien,
      lien: "2026-11-14",
      maintenant: MAINTENANT,
    })
    // Le jour de courses n'est pas encore lu : la résolution est déjà partie.
    expect(resoudreLien).toHaveBeenCalledWith("2026-11-14")
    jour.resoudre(4)
    expect(await resultat).toEqual({ jourCourses: 4, ancre: "2026-11-12" })
  })

  it("lien hors plage / invalide : repli silencieux sur l'ancre par défaut", async () => {
    for (const motif of ["hors_plage", "invalide"] as const) {
      const res = await ancreInitialeCycle({
        chargerJour: () => Promise.resolve(1),
        resoudreLien: () => Promise.resolve({ ok: false, motif }),
        lien: "2030-01-01",
        maintenant: MAINTENANT,
      })
      expect(res.ancre).toBe(ancreParDefaut(MAINTENANT, 1))
    }
  })

  it("résolution du lien en échec : erreur loggée, ancre par défaut", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const erreur = new Error("foyer illisible")
    const res = await ancreInitialeCycle({
      chargerJour: () => Promise.resolve(3),
      resoudreLien: () => Promise.reject(erreur),
      lien: "2026-11-14",
      maintenant: MAINTENANT,
    })
    expect(res).toEqual({ jourCourses: 3, ancre: ancreParDefaut(MAINTENANT, 3) })
    expect(error).toHaveBeenCalledWith(
      "Résolution du cycle du lien échouée (cycle par défaut).",
      erreur
    )
  })

  it("jour de courses illisible : lundi, avertissement loggé", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await ancreInitialeCycle({
      chargerJour: () => Promise.reject(new Error("réseau")),
      resoudreLien: vi.fn(),
      maintenant: MAINTENANT,
    })
    expect(res).toEqual({ jourCourses: 1, ancre: ancreParDefaut(MAINTENANT, 1) })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
