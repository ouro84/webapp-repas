// lib/lecture-cycle.test.ts
// Lecteur de cycle unique (chantier 05) : semaines ISO touchées → plannings par
// semaine → planning recombiné, avec une seule sémantique d'échec.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Planning } from "@/types"

vi.mock("@/lib/persistance", () => ({
  chargerPlanningDistant: vi.fn(),
}))

import { chargerPlanningDistant } from "@/lib/persistance"
import { ErreurLectureCycle, lireCycle } from "@/lib/lecture-cycle"

const mockCharger = vi.mocked(chargerPlanningDistant)
const client = {} as ClientSupabase

// Cycle de 7 j ancré le vendredi 2026-11-06 : ven/sam/dim en W45, lun→jeu en W46.
const ANCRE = "2026-11-06"
const planningW45: Planning = {
  semaine: "2026-W45",
  jours: [{ jour: "vendredi" }, { jour: "samedi" }, { jour: "dimanche" }],
}
const planningW46: Planning = {
  semaine: "2026-W46",
  jours: [{ jour: "lundi" }, { jour: "mardi" }, { jour: "jeudi" }],
}

function reponse(planning: Planning) {
  return { planning, updatedAt: "2026-11-06T10:00:00Z" }
}

function lectureParSemaine(parSemaine: Record<string, Planning | null | Error>) {
  mockCharger.mockImplementation(async (semaine?: string) => {
    const valeur = parSemaine[semaine ?? ""]
    if (valeur instanceof Error) throw valeur
    return valeur ? reponse(valeur) : null
  })
}

describe("lireCycle", () => {
  beforeEach(() => {
    mockCharger.mockReset()
  })

  it("lit chaque semaine touchée avec le client passé et recombine le planning du cycle", async () => {
    lectureParSemaine({ "2026-W45": planningW45, "2026-W46": planningW46 })

    const cycle = await lireCycle({ ancre: ANCRE, longueur: 7 }, client)

    expect(cycle.semaines).toEqual(["2026-W45", "2026-W46"])
    expect(mockCharger).toHaveBeenCalledTimes(2)
    expect(mockCharger).toHaveBeenCalledWith("2026-W45", client)
    expect(mockCharger).toHaveBeenCalledWith("2026-W46", client)
    expect([...cycle.parSemaine.keys()]).toEqual(["2026-W45", "2026-W46"])
    expect(cycle.parSemaine.get("2026-W46")).toBe(planningW46)
    expect(cycle.planning.semaine).toBe(ANCRE)
    expect(cycle.planning.jours.map((j) => j.jour)).toEqual([
      "vendredi", "samedi", "dimanche", "lundi", "mardi", "jeudi",
    ])
  })

  it("ignore une semaine sans ligne (null) sans erreur", async () => {
    lectureParSemaine({ "2026-W45": planningW45, "2026-W46": null })

    const cycle = await lireCycle({ ancre: ANCRE, longueur: 7 }, client)

    expect(cycle.semaines).toEqual(["2026-W45", "2026-W46"])
    expect([...cycle.parSemaine.keys()]).toEqual(["2026-W45"])
    expect(cycle.planning.jours.map((j) => j.jour)).toEqual(["vendredi", "samedi", "dimanche"])
  })

  it("rejette une ErreurLectureCycle quand une semaine échoue, sans projection partielle", async () => {
    const cause = new Error("réseau coupé")
    lectureParSemaine({ "2026-W45": planningW45, "2026-W46": cause })

    const erreur = await lireCycle({ ancre: ANCRE, longueur: 7 }, client).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(ErreurLectureCycle)
    const e = erreur as ErreurLectureCycle
    expect(e.name).toBe("ErreurLectureCycle")
    expect(e.semainesEnEchec).toEqual(["2026-W46"])
    expect(e.causes[0]).toBe(cause)
    expect(e.causes).toHaveLength(1)
    expect(e.message).toBe("Lecture du cycle échouée (semaines : 2026-W46).")
  })

  it("liste toutes les semaines en échec dans l'ordre du cycle", async () => {
    const c45 = new Error("45")
    const c46 = new Error("46")
    lectureParSemaine({ "2026-W45": c45, "2026-W46": c46 })

    const erreur = (await lireCycle({ ancre: ANCRE, longueur: 7 }, client).catch(
      (e: unknown) => e,
    )) as ErreurLectureCycle

    expect(erreur).toBeInstanceOf(ErreurLectureCycle)
    expect(erreur.semainesEnEchec).toEqual(["2026-W45", "2026-W46"])
    expect(erreur.causes).toEqual([c45, c46])
  })
})
