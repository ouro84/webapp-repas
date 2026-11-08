// Tests de l'horodatage des CGU après connexion Google (US-57, RG-92).
// Client Supabase simulé : on vérifie l'update atomique filtré sur user_id et
// sur cgu_version nulle, sans lecture préalable.

import { describe, test, expect, vi, afterEach } from "vitest"
import type { ClientSupabase } from "@/lib/supabase/types"
import { CGU_VERSION_ACTUELLE } from "@/lib/legal"
import { horodaterCguSiAbsentes } from "@/lib/cgu-oauth"

function clientSimule(resultat: { error: unknown } = { error: null }) {
  const is = vi.fn().mockResolvedValue(resultat)
  const eq = vi.fn().mockReturnValue({ is })
  const update = vi.fn().mockReturnValue({ eq })
  const select = vi.fn()
  const from = vi.fn().mockReturnValue({ update, select })
  return { client: { from } as unknown as ClientSupabase, from, update, eq, is, select }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("horodaterCguSiAbsentes", () => {
  test("update atomique de la version courante, filtré sur user_id et cgu_version nulle", async () => {
    const { client, from, update, eq, is, select } = clientSimule()
    await horodaterCguSiAbsentes(client, "user-1")
    expect(from).toHaveBeenCalledWith("profiles")
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      cgu_version: CGU_VERSION_ACTUELLE,
      cgu_acceptees_le: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    expect(eq).toHaveBeenCalledWith("user_id", "user-1")
    expect(is).toHaveBeenCalledWith("cgu_version", null)
    // Aucune lecture préalable : la garde « déjà horodaté » est dans le filtre.
    expect(select).not.toHaveBeenCalled()
  })

  test("aucune ligne touchée (déjà horodaté) : rien n'est loggé", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clientSimule({ error: null })
    await horodaterCguSiAbsentes(client, "user-1")
    expect(consoleError).not.toHaveBeenCalled()
  })

  test("erreur d'écriture : aucune exception, erreur loggée", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = clientSimule({ error: { message: "rls" } })
    await expect(horodaterCguSiAbsentes(client, "user-1")).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })

  test("exception du client : aucune exception, erreur loggée", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, is } = clientSimule()
    is.mockRejectedValue(new Error("réseau"))
    await expect(horodaterCguSiAbsentes(client, "user-1")).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })
})
