// resoudreCycle (#320, #360, RG-85) : cycle visé (date quelconque, ou cycle
// courant sans date) → cycle complet, résultat typé (sans ErreurOutil, partagé
// MCP + route du panier + exécuteur + lien profond). Lecture stricte du jour de
// courses : jamais de repli sur lundi.

import { describe, expect, it } from "vitest"

import { resoudreCycle, type ResolutionCycle } from "@/lib/ancre-cycle"
import { creerSupabaseMock, filtre, type AppelTable, type ReponseMock } from "@/tests/fixtures/supabase-mock"

// Jeudi 29 octobre 2026, jour de courses = jeudi (4).
const JEUDI = new Date(2026, 9, 29, 12)

function mock(tables: Record<string, ReponseMock | ((appel: AppelTable) => ReponseMock)> = {}) {
  return creerSupabaseMock({
    tables: {
      foyers: { data: { jour_courses: 4 }, error: null },
      cycle_courses: { data: null, error: null },
      ...tables,
    },
  })
}

// Le cycle du 29/10 dure `longueur` jours ; les autres gardent la longueur par défaut (7).
function cycleDu29(longueur: number) {
  return (appel: AppelTable): ReponseMock => ({
    data: filtre(appel, "eq", "ancre") === "2026-10-29" ? { longueur } : null,
    error: null,
  })
}

function ancre(r: ResolutionCycle): string | ResolutionCycle {
  return r.ok ? r.cycle.ancre : r
}

describe("resoudreCycle", () => {
  it("sans date → cycle courant complet (ancre du jour de courses)", async () => {
    const { client } = mock()
    expect(await resoudreCycle(client, {}, JEUDI)).toEqual({
      ok: true,
      cycle: {
        ancre: "2026-10-29",
        longueur: 7,
        jours: ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
        semaines: ["2026-W44", "2026-W45"],
        du: "2026-10-29",
        au: "2026-11-04",
      },
    })
  })

  it("date d'ancre → cette ancre", async () => {
    const { client } = mock()
    expect(ancre(await resoudreCycle(client, { date: "2026-10-29" }, JEUDI))).toBe("2026-10-29")
  })

  it("date en milieu de cycle → ancre du cycle qui la contient", async () => {
    const { client } = mock()
    expect(ancre(await resoudreCycle(client, { date: "2026-11-02" }, JEUDI))).toBe("2026-10-29")
    expect(ancre(await resoudreCycle(client, { date: "2026-11-04" }, JEUDI))).toBe("2026-10-29")
  })

  it("date au-delà du dernier jour d'un cycle raccourci → cycle suivant, avec SA longueur", async () => {
    const { client } = mock({ cycle_courses: cycleDu29(5) })
    // Cycle du 29/10 : 29, 30, 31, 1er, 2 novembre.
    const dans = await resoudreCycle(client, { date: "2026-11-02" }, JEUDI)
    expect(dans.ok && dans.cycle).toMatchObject({ ancre: "2026-10-29", longueur: 5, au: "2026-11-02" })
    const trou = await resoudreCycle(client, { date: "2026-11-03" }, JEUDI)
    expect(trou.ok && trou.cycle).toMatchObject({ ancre: "2026-11-05", longueur: 7, du: "2026-11-05", au: "2026-11-11" })
  })

  it("longueur du cycle illisible → rejet, jamais le cycle courant à la place du suivant (#365)", async () => {
    // Cycle du 29/10 raccourci à 5 jours : le 03/11 tombe dans le trou et vise
    // le cycle du 05/11. Une erreur transitoire de cycle_courses lue comme
    // « 7 jours » ramenait le 03/11 au cycle du 29/10 (generer_cycle(remplacer)
    // aurait réécrit le cycle courant).
    const { client } = mock({ cycle_courses: { data: null, error: { message: "réseau coupé" } } })
    await expect(resoudreCycle(client, { date: "2026-11-03" }, JEUDI)).rejects.toThrow(
      "Lecture de la longueur du cycle impossible"
    )
    await expect(resoudreCycle(client, {}, JEUDI)).rejects.toThrow("Lecture de la longueur du cycle impossible")
  })

  it("longueur du cycle suivant illisible (date dans le trou) → rejet (#365)", async () => {
    const { client } = mock({
      cycle_courses: (appel) =>
        filtre(appel, "eq", "ancre") === "2026-10-29"
          ? { data: { longueur: 5 }, error: null }
          : { data: null, error: { message: "réseau coupé" } },
    })
    await expect(resoudreCycle(client, { date: "2026-11-03" }, JEUDI)).rejects.toThrow(
      "Lecture de la longueur du cycle impossible"
    )
  })

  it("cycle hors plage −12 / +6 semaines → hors_plage", async () => {
    const { client } = mock()
    expect(await resoudreCycle(client, { date: "2027-12-01" }, JEUDI)).toEqual({ ok: false, motif: "hors_plage" })
    expect(await resoudreCycle(client, { date: "2025-01-01" }, JEUDI)).toEqual({ ok: false, motif: "hors_plage" })
  })

  it("date mal formée ou impossible → invalide, sans aucune lecture", async () => {
    const { client, appels, rpcs } = mock()
    for (const date of ["29/10/2026", "2026-02-30", "demain", ""]) {
      expect(await resoudreCycle(client, { date }, JEUDI)).toEqual({ ok: false, motif: "invalide" })
    }
    expect(appels).toEqual([])
    expect(rpcs).toEqual([])
  })

  it("lecture du foyer en erreur ou foyer absent → rejet, avec ou sans date, jamais de repli sur lundi", async () => {
    for (const foyers of [
      { data: null, error: { message: "réseau coupé" } },
      { data: null, error: null },
    ]) {
      const { client } = mock({ foyers })
      await expect(resoudreCycle(client, { date: "2026-11-04" }, JEUDI)).rejects.toThrow()
      await expect(resoudreCycle(client, {}, JEUDI)).rejects.toThrow()
    }
  })
})
