// @vitest-environment node
//
// POST /api/panier/demande — adaptateur HTTP de la demande de panier (#308,
// RG-81) : crée la demande (RPC), envoie le webhook signé à l'exécuteur, ferme
// la demande en échec si l'envoi échoue.

import { beforeEach, describe, expect, it, vi } from "vitest"

const serveur = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: serveur.getUser },
    rpc: serveur.rpc,
  }),
}))

const rateLimit = vi.hoisted(() => ({ limitePanier: vi.fn() }))
vi.mock("@/lib/rate-limit", () => rateLimit)

const foyer = vi.hoisted(() => ({ chargerJourCoursesFoyer: vi.fn() }))
vi.mock("@/lib/foyer", () => foyer)

const panier = vi.hoisted(() => ({ envoyerWebhook: vi.fn() }))
vi.mock("@/lib/panier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/panier")>()),
  envoyerWebhook: panier.envoyerWebhook,
}))

import { POST } from "@/app/api/panier/demande/route"
import { MESSAGES_PANIER } from "@/lib/panier"
import { ancreParDefaut } from "@/lib/cycles"
import { aujourdhuiParis } from "@/lib/semaines"

const ENVOI = {
  demande_id: "d1",
  url: "https://executeur.test/hook",
  entetes: { "webhook-id": "msg_x" },
  corps: '{"evenement":"demande_panier"}',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  serveur.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
  rateLimit.limitePanier.mockResolvedValue({ autorise: true })
  foyer.chargerJourCoursesFoyer.mockResolvedValue(4)
  serveur.rpc.mockImplementation(async (nom: string) =>
    nom === "creer_demande_panier"
      ? { data: ENVOI, error: null }
      : { data: null, error: null }
  )
  panier.envoyerWebhook.mockResolvedValue({ ok: true })
})

describe("POST /api/panier/demande", () => {
  it("401 sans session", async () => {
    serveur.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const reponse = await POST()

    expect(reponse.status).toBe(401)
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(rateLimit.limitePanier).not.toHaveBeenCalled()
  })

  it("429 quand limitePanier refuse", async () => {
    rateLimit.limitePanier.mockResolvedValue({ autorise: false })

    const reponse = await POST()

    expect(reponse.status).toBe(429)
    expect(rateLimit.limitePanier).toHaveBeenCalledWith("u1")
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("crée la demande sur l'ancre du cycle courant et envoie le webhook → 202", async () => {
    const reponse = await POST()

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", {
      p_ancre: ancreParDefaut(aujourdhuiParis(), 4),
    })
    expect(panier.envoyerWebhook).toHaveBeenCalledWith(ENVOI)
  })

  it("409 avec le message OMQ01 si aucun exécuteur", async () => {
    serveur.rpc.mockResolvedValue({ data: null, error: { code: "OMQ01", message: "x" } })

    const reponse = await POST()

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ01 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ02 si une demande est active", async () => {
    serveur.rpc.mockResolvedValue({ data: null, error: { code: "OMQ02", message: "x" } })

    const reponse = await POST()

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ02 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("500 générique sur une erreur RPC inconnue", async () => {
    serveur.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boum" } })

    const reponse = await POST()

    expect(reponse.status).toBe(500)
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("webhook en échec → echouer_envoi_demande_panier puis 502", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "HTTP 500" })

    const reponse = await POST()

    expect(reponse.status).toBe(502)
    expect(await reponse.json()).toEqual({
      error: "Ton exécuteur est injoignable : vérifie qu'il est allumé, puis réessaie.",
    })
    expect(serveur.rpc).toHaveBeenLastCalledWith("echouer_envoi_demande_panier", {
      p_demande: "d1",
      p_motif: "HTTP 500",
    })
  })

  it("502 même si la fermeture de la demande échoue (expiration paresseuse)", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "délai" })
    serveur.rpc.mockImplementation(async (nom: string) =>
      nom === "creer_demande_panier"
        ? { data: ENVOI, error: null }
        : { data: null, error: { code: "XX000", message: "boum" } }
    )

    const reponse = await POST()

    expect(reponse.status).toBe(502)
  })
})
