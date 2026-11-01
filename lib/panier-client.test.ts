// Lecture de l'état du panier et lancement d'une demande côté navigateur
// (#308, RG-81/RG-83). Client Supabase injecté mocké ; fetch injecté.

import { afterEach, describe, expect, it, vi } from "vitest"

import { chargerEtatPanier, chargerJourCoursesPanier, lancerDemandePanier } from "@/lib/panier-client"
import type { EtatPanier } from "@/lib/panier-affichage"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

const ETAT: EtatPanier = { executeur: true, derniere: null, active: null }

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

  it("lève si la RPC ne renvoie rien (B4)", async () => {
    const { client } = creerSupabaseMock({ rpc: { etat_panier: { data: null, error: null } } })
    await expect(chargerEtatPanier(client)).rejects.toThrow(/aucune donnée/)
  })
})

describe("chargerJourCoursesPanier", () => {
  it("renvoie jour_courses du foyer", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: { foyers: { data: { jour_courses: 5 }, error: null } },
    })
    await expect(chargerJourCoursesPanier(client)).resolves.toBe(5)
    expect(appels[0]).toMatchObject({ table: "foyers" })
  })

  it("lève sur erreur, SANS repli sur lundi (B13)", async () => {
    const { client } = creerSupabaseMock({
      tables: { foyers: { data: null, error: { message: "boom" } } },
    })
    await expect(chargerJourCoursesPanier(client)).rejects.toThrow(/boom/)
  })

  it("lève si aucun foyer n'est lu", async () => {
    const { client } = creerSupabaseMock({ tables: { foyers: { data: null, error: null } } })
    await expect(chargerJourCoursesPanier(client)).rejects.toThrow(/foyer introuvable/)
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
      statut: 409,
      message: "Une demande est déjà en cours.",
    })
  })

  it("502 → statut transmis (la carte porte le message, C3)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Ton exécuteur est injoignable." }), { status: 502 })
    )
    await expect(lancerDemandePanier({ fetch: fetchMock })).resolves.toEqual({
      ok: false,
      statut: 502,
      message: "Ton exécuteur est injoignable.",
    })
  })

  it("réseau coupé → message français, ne lève pas", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(lancerDemandePanier({ fetch: fetchMock })).resolves.toEqual({
      ok: false,
      statut: null,
      message: "Connexion impossible : vérifie ton réseau, puis réessaie.",
    })
    expect(spy).toHaveBeenCalled()
  })
})
