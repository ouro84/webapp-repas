// Lecture de l'état du panier et lancement d'une demande côté navigateur
// (#308, RG-81/RG-83). Client Supabase injecté mocké ; fetch injecté.

import { afterEach, describe, expect, it, vi } from "vitest"

import { chargerEtatPanier, lancerDemandePanier } from "@/lib/panier-client"
import type { EtatPanier } from "@/lib/panier-affichage"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

const ETAT: EtatPanier = { executeur: true, derniere: null }

describe("chargerEtatPanier", () => {
  it("renvoie data de etat_panier", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { etat_panier: { data: ETAT, error: null } },
    })
    await expect(chargerEtatPanier(client)).resolves.toEqual(ETAT)
    expect(rpcs).toEqual([{ nom: "etat_panier", args: undefined }])
  })

  it("lève si la RPC échoue", async () => {
    const { client } = creerSupabaseMock({
      rpc: { etat_panier: { data: null, error: { message: "boom" } } },
    })
    await expect(chargerEtatPanier(client)).rejects.toThrow(/boom/)
  })
})

describe("lancerDemandePanier", () => {
  afterEach(() => vi.restoreAllMocks())

  it("202 → ok, POST sans corps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ demande_id: "d1" }), { status: 202 })
    )
    await expect(lancerDemandePanier({ fetch: fetchMock })).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/panier/demande")
    expect(init).toMatchObject({ method: "POST" })
    expect(init.body).toBeUndefined()
  })

  it("409 → message de la route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Une demande est déjà en cours." }), { status: 409 })
    )
    await expect(lancerDemandePanier({ fetch: fetchMock })).resolves.toEqual({
      ok: false,
      message: "Une demande est déjà en cours.",
    })
  })

  it("réseau coupé → message français, ne lève pas", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(lancerDemandePanier({ fetch: fetchMock })).resolves.toEqual({
      ok: false,
      message: "Connexion impossible : vérifie ton réseau, puis réessaie.",
    })
    expect(spy).toHaveBeenCalled()
  })
})
