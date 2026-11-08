// Tests de l'horodatage des CGU après connexion Google (US-57, RG-92).
// Client Supabase simulé : on vérifie la lecture de profiles.cgu_version puis
// l'éventuel update filtré sur user_id.

import { describe, test, expect, vi, afterEach } from "vitest"
import type { ClientSupabase } from "@/lib/supabase/types"
import { horodaterCguSiAbsentes } from "@/lib/cgu-oauth"

function clientSimule(lecture: { data: { cgu_version: number | null } | null; error: unknown }) {
  const eqUpdate = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: eqUpdate })
  const maybeSingle = vi.fn().mockResolvedValue(lecture)
  const eqSelect = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq: eqSelect })
  const from = vi.fn().mockReturnValue({ select, update })
  return { client: { from } as unknown as ClientSupabase, from, select, eqSelect, update, eqUpdate }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("horodaterCguSiAbsentes", () => {
  test("cgu_version nulle : update de la version courante filtré sur user_id", async () => {
    const { client, from, eqSelect, update, eqUpdate } = clientSimule({
      data: { cgu_version: null },
      error: null,
    })
    await horodaterCguSiAbsentes(client, "user-1")
    expect(from).toHaveBeenCalledWith("profiles")
    expect(eqSelect).toHaveBeenCalledWith("user_id", "user-1")
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      cgu_version: 1,
      cgu_acceptees_le: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    expect(eqUpdate).toHaveBeenCalledWith("user_id", "user-1")
  })

  test("cgu_version déjà renseignée : aucun update", async () => {
    const { client, update } = clientSimule({ data: { cgu_version: 1 }, error: null })
    await horodaterCguSiAbsentes(client, "user-1")
    expect(update).not.toHaveBeenCalled()
  })

  test("erreur de lecture : aucune exception, erreur loggée, aucun update", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, update } = clientSimule({ data: null, error: { message: "boom" } })
    await expect(horodaterCguSiAbsentes(client, "user-1")).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  test("erreur d'écriture : aucune exception, erreur loggée", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, eqUpdate } = clientSimule({ data: { cgu_version: null }, error: null })
    eqUpdate.mockResolvedValue({ error: { message: "rls" } })
    await expect(horodaterCguSiAbsentes(client, "user-1")).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })
})
