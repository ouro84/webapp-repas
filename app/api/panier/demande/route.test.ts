// @vitest-environment node
//
// POST /api/panier/demande — adaptateur HTTP de la demande de panier (#308,
// RG-81) : crée la demande (RPC), envoie le webhook signé à l'exécuteur, ferme
// la demande en échec si l'envoi échoue.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Lecture `foyers.jour_courses` : `from("foyers").select(...).maybeSingle()`.
const serveur = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), lireFoyer: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: serveur.getUser },
    rpc: serveur.rpc,
    from: serveur.from,
  }),
}))

const rateLimit = vi.hoisted(() => ({ limitePanier: vi.fn() }))
vi.mock("@/lib/rate-limit", () => rateLimit)

const panier = vi.hoisted(() => ({ envoyerWebhook: vi.fn() }))
vi.mock("@/lib/panier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/panier")>()),
  envoyerWebhook: panier.envoyerWebhook,
}))

import { POST, maxDuration } from "@/app/api/panier/demande/route"
import { MESSAGE_INJOIGNABLE, MESSAGES_PANIER } from "@/lib/panier"

const ENVOI = {
  demande_id: "d1",
  url: "https://executeur.test/hook",
  entetes: { "webhook-id": "msg_x" },
  corps: '{"evenement":"demande_panier"}',
}

// Réponses RPC par nom, surchargées test par test.
function rpcs(reponses: Record<string, { data: unknown; error: unknown }>) {
  serveur.rpc.mockImplementation(async (nom: string) => reponses[nom] ?? { data: null, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  serveur.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
  serveur.from.mockImplementation(() => ({ select: () => ({ maybeSingle: serveur.lireFoyer }) }))
  serveur.lireFoyer.mockResolvedValue({ data: { jour_courses: 4 }, error: null })
  rateLimit.limitePanier.mockResolvedValue({ autorise: true })
  rpcs({
    creer_demande_panier: { data: ENVOI, error: null },
    echouer_envoi_demande_panier: { data: true, error: null },
  })
  panier.envoyerWebhook.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/panier/demande", () => {
  it("maxDuration couvre le délai du webhook (10 s) et les RPC", () => {
    expect(maxDuration).toBe(30)
  })

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

  // Horloge figée : seul `Date` est simulé, la route n'attend aucun minuteur.
  it("en semaine : demande sur l'ancre du cycle courant, webhook envoyé → 202", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-28T11:00:00Z")) // mercredi, 12 h à Paris

    const reponse = await POST()

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
    expect(serveur.from).toHaveBeenCalledWith("foyers")
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    // Jour de courses = jeudi : dernier jeudi ≤ mercredi 28 octobre.
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-10-22" })
    expect(panier.envoyerWebhook).toHaveBeenCalledWith(ENVOI)
  })

  it("le week-end : demande sur le cycle suivant, comme /courses (ancreParDefaut)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-31T11:00:00Z")) // samedi, 12 h à Paris

    const reponse = await POST()

    expect(reponse.status).toBe(202)
    // Ancre courante = jeudi 29 octobre ; le week-end, un cycle plus loin.
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-05" })
  })

  it("500 si la lecture du jour de courses échoue, sans créer de demande", async () => {
    serveur.lireFoyer.mockResolvedValue({ data: null, error: { code: "XX000", message: "boum" } })

    const reponse = await POST()

    expect(reponse.status).toBe(500)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("500 si le foyer est introuvable, sans retomber sur un jour par défaut", async () => {
    serveur.lireFoyer.mockResolvedValue({ data: null, error: null })

    const reponse = await POST()

    expect(reponse.status).toBe(500)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ01 si aucun exécuteur", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "OMQ01", message: "x" } } })

    const reponse = await POST()

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ01 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ02 si une demande est active", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "OMQ02", message: "x" } } })

    const reponse = await POST()

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ02 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("500 générique sur une erreur RPC inconnue", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "XX000", message: "boum" } } })

    const reponse = await POST()

    expect(reponse.status).toBe(500)
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("500 générique si la RPC ne renvoie rien", async () => {
    rpcs({ creer_demande_panier: { data: null, error: null } })

    const reponse = await POST()

    expect(reponse.status).toBe(500)
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("webhook en échec → echouer_envoi_demande_panier puis 502", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "réponse HTTP 500" })

    const reponse = await POST()

    expect(reponse.status).toBe(502)
    expect(await reponse.json()).toEqual({ error: MESSAGE_INJOIGNABLE })
    expect(serveur.rpc).toHaveBeenLastCalledWith("echouer_envoi_demande_panier", {
      p_demande: "d1",
      p_motif: "réponse HTTP 500",
    })
  })

  it("webhook en échec mais demande déjà prise par l'exécuteur → 202", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "délai de 10 s dépassé" })
    rpcs({
      creer_demande_panier: { data: ENVOI, error: null },
      echouer_envoi_demande_panier: { data: false, error: null },
    })

    const reponse = await POST()

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
  })

  it("502 même si la fermeture de la demande échoue (expiration paresseuse), échec loggé", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "erreur réseau" })
    const erreurFermeture = { code: "XX000", message: "boum" }
    rpcs({
      creer_demande_panier: { data: ENVOI, error: null },
      echouer_envoi_demande_panier: { data: null, error: erreurFermeture },
    })

    const reponse = await POST()

    expect(reponse.status).toBe(502)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("fermeture de la demande impossible"),
      erreurFermeture
    )
  })
})
