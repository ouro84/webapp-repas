// resoudreAncreCycle (#320, RG-85) : date quelconque → ancre du cycle qui la
// contient, résultat typé (sans ErreurOutil, partagé MCP + route du panier).

import { describe, expect, it } from "vitest"

import { resoudreAncreCycle } from "@/lib/ancre-cycle"
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

describe("resoudreAncreCycle", () => {
  it("date d'ancre → cette ancre", async () => {
    const { client } = mock()
    expect(await resoudreAncreCycle(client, "2026-10-29", JEUDI)).toEqual({ ok: true, ancre: "2026-10-29" })
  })

  it("date en milieu de cycle → ancre du cycle qui la contient", async () => {
    const { client } = mock()
    expect(await resoudreAncreCycle(client, "2026-11-02", JEUDI)).toEqual({ ok: true, ancre: "2026-10-29" })
    expect(await resoudreAncreCycle(client, "2026-11-04", JEUDI)).toEqual({ ok: true, ancre: "2026-10-29" })
  })

  it("date au-delà du dernier jour d'un cycle raccourci → cycle suivant", async () => {
    const { client } = mock({ cycle_courses: cycleDu29(5) })
    // Cycle du 29/10 : 29, 30, 31, 1er, 2 novembre.
    expect(await resoudreAncreCycle(client, "2026-11-02", JEUDI)).toEqual({ ok: true, ancre: "2026-10-29" })
    expect(await resoudreAncreCycle(client, "2026-11-03", JEUDI)).toEqual({ ok: true, ancre: "2026-11-05" })
  })

  it("cycle hors plage −12 / +6 semaines → hors_plage", async () => {
    const { client } = mock()
    expect(await resoudreAncreCycle(client, "2027-12-01", JEUDI)).toEqual({ ok: false, motif: "hors_plage" })
    expect(await resoudreAncreCycle(client, "2025-01-01", JEUDI)).toEqual({ ok: false, motif: "hors_plage" })
  })

  it("date mal formée ou impossible → invalide, sans aucune lecture", async () => {
    const { client, appels, rpcs } = mock()
    for (const date of ["29/10/2026", "2026-02-30", "demain", ""]) {
      expect(await resoudreAncreCycle(client, date, JEUDI)).toEqual({ ok: false, motif: "invalide" })
    }
    expect(appels).toEqual([])
    expect(rpcs).toEqual([])
  })

  it("lecture du foyer en erreur ou foyer absent → rejet, jamais de repli sur lundi", async () => {
    for (const foyers of [
      { data: null, error: { message: "réseau coupé" } },
      { data: null, error: null },
    ]) {
      const { client } = mock({ foyers })
      await expect(resoudreAncreCycle(client, "2026-11-04", JEUDI)).rejects.toThrow()
    }
  })
})
