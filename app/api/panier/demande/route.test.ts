// @vitest-environment node
//
// POST /api/panier/demande — adaptateur HTTP de la demande de panier (#308,
// #320, RG-81) : authentification, rate-limit, ancre (corps optionnel, sinon
// cycle courant), puis `creerEtEnvoyerDemande` (cas détaillés dans
// `lib/panier-demande.test.ts`) ; la route ne fait que traduire le résultat.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Lectures : `from("foyers").select(...).maybeSingle()` (jour_courses) et
// `from("cycle_courses").select(...).eq(...).maybeSingle()` (longueur du cycle).
const serveur = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  lireFoyer: vi.fn(),
  lireCycle: vi.fn(),
  from: vi.fn(),
}))
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

// Requête avec ou sans corps JSON (le corps est optionnel).
function requete(corps?: unknown, brut?: string) {
  return new Request("http://localhost/api/panier/demande", {
    method: "POST",
    ...(brut !== undefined
      ? { body: brut }
      : corps !== undefined
        ? { body: JSON.stringify(corps), headers: { "content-type": "application/json" } }
        : {}),
  })
}

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
  serveur.from.mockImplementation((table: string) =>
    table === "cycle_courses"
      ? { select: () => ({ eq: () => ({ maybeSingle: serveur.lireCycle }) }) }
      : { select: () => ({ maybeSingle: serveur.lireFoyer }) }
  )
  serveur.lireFoyer.mockResolvedValue({ data: { jour_courses: 4 }, error: null })
  serveur.lireCycle.mockResolvedValue({ data: null, error: null })
  // Horloge figée (seul `Date`) : mercredi 28 octobre 2026, 12 h à Paris.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-28T11:00:00Z"))
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

    const reponse = await POST(requete())

    expect(reponse.status).toBe(401)
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(rateLimit.limitePanier).not.toHaveBeenCalled()
  })

  it("429 quand limitePanier refuse", async () => {
    rateLimit.limitePanier.mockResolvedValue({ autorise: false })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(429)
    expect(rateLimit.limitePanier).toHaveBeenCalledWith("u1")
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("en semaine : demande sur l'ancre du cycle courant, webhook envoyé → 202", async () => {
    const reponse = await POST(requete())

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
    expect(serveur.from).toHaveBeenCalledWith("foyers")
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    // Jour de courses = jeudi : dernier jeudi ≤ mercredi 28 octobre.
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-10-22" })
    // Aucun `fetch` injecté : l'option n'est même pas passée (égalité stricte).
    expect(panier.envoyerWebhook.mock.calls[0][1]).toStrictEqual({})
  })

  it("le week-end : demande sur le cycle suivant, comme /courses (ancreParDefaut)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-31T11:00:00Z")) // samedi, 12 h à Paris

    const reponse = await POST(requete())

    expect(reponse.status).toBe(202)
    // Ancre courante = jeudi 29 octobre ; le week-end, un cycle plus loin.
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-05" })
  })

  it("500 si la lecture du jour de courses échoue, sans créer de demande", async () => {
    serveur.lireFoyer.mockResolvedValue({ data: null, error: { code: "XX000", message: "boum" } })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(500)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("500 si le foyer est introuvable, sans retomber sur un jour par défaut", async () => {
    serveur.lireFoyer.mockResolvedValue({ data: null, error: null })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(500)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("corps { ancre } = ancre de cycle : creer_demande_panier reçoit cette ancre", async () => {
    const reponse = await POST(requete({ ancre: "2026-11-12" }))

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-12" })
  })

  it("corps { ancre } en milieu de cycle : la RPC reçoit l'ancre RÉSOLUE, pas la date", async () => {
    // Jour de courses = jeudi : le 15 novembre (dimanche) est dans le cycle du 12.
    const reponse = await POST(requete({ ancre: "2026-11-15" }))

    expect(reponse.status).toBe(202)
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-12" })
  })

  it("corps { ancre } après le dernier jour d'un cycle raccourci : ancre du cycle suivant", async () => {
    // Cycle du 22/10 de 3 jours (22, 23, 24) : le 26 tombe dans le trou, cycle du 29.
    serveur.lireCycle.mockResolvedValue({ data: { longueur: 3 }, error: null })

    const reponse = await POST(requete({ ancre: "2026-10-26" }))

    expect(reponse.status).toBe(202)
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-10-29" })
  })

  it("corps { ancre } d'un cycle hors plage → 400 « Cycle invalide. », aucune RPC", async () => {
    const reponse = await POST(requete({ ancre: "2027-12-01" }))

    expect(reponse.status).toBe(400)
    expect(await reponse.json()).toEqual({ error: "Cycle invalide." })
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("corps { ancre } : lecture du jour de courses en échec → 500, aucune RPC", async () => {
    serveur.lireFoyer.mockResolvedValue({ data: null, error: { code: "XX000", message: "boum" } })

    const reponse = await POST(requete({ ancre: "2026-11-12" }))

    expect(reponse.status).toBe(500)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("corps { ancre, x } : la clé en trop est ignorée", async () => {
    const reponse = await POST(requete({ ancre: "2026-11-12", x: "autre", demande_id: "d9" }))

    expect(reponse.status).toBe(202)
    expect(serveur.rpc).toHaveBeenCalledTimes(1)
    expect(serveur.rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-12" })
  })

  it("corps vide ou objet sans ancre : ancre du cycle courant", async () => {
    expect((await POST(requete({}))).status).toBe(202)
    expect(serveur.rpc).toHaveBeenLastCalledWith("creer_demande_panier", { p_ancre: "2026-10-22" })
    expect((await POST(requete(undefined, "  "))).status).toBe(202)
    expect(serveur.rpc).toHaveBeenLastCalledWith("creer_demande_panier", { p_ancre: "2026-10-22" })
  })

  it.each([
    ["format invalide", { ancre: "demain" }],
    ["date inexistante", { ancre: "2026-02-30" }],
    ["ancre non textuelle", { ancre: 20261105 }],
    ["ancre nulle", { ancre: null }],
  ])("ancre mal formée (%s) → 400 « Cycle invalide. », aucune RPC", async (_cas, corps) => {
    const reponse = await POST(requete(corps))

    expect(reponse.status).toBe(400)
    expect(await reponse.json()).toEqual({ error: "Cycle invalide." })
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(serveur.from).not.toHaveBeenCalled()
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("corps qui n'est pas du JSON objet → 400, aucune RPC", async () => {
    for (const brut of ["{pas du json", "[]", '"2026-11-05"']) {
      const reponse = await POST(requete(undefined, brut))
      expect(reponse.status).toBe(400)
    }
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ04 pour un cycle terminé, sans webhook", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "OMQ04", message: "x" } } })

    const reponse = await POST(requete({ ancre: "2026-09-03" }))

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ04 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ01 si aucun exécuteur n'est enregistré, sans webhook", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "OMQ01", message: "x" } } })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ01 })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("409 avec le message OMQ02 si une demande est active", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "OMQ02", message: "x" } } })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toEqual({ error: MESSAGES_PANIER.OMQ02 })
  })

  it("500 générique sur une erreur RPC inconnue", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "XX000", message: "boum" } } })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(500)
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("webhook en échec → fermeture de la demande puis 502", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "réponse HTTP 500" })

    const reponse = await POST(requete())

    expect(reponse.status).toBe(502)
    expect(await reponse.json()).toEqual({ error: MESSAGE_INJOIGNABLE })
    expect(serveur.rpc).toHaveBeenLastCalledWith("echouer_envoi_demande_panier", {
      p_demande: "d1",
      p_motif: "réponse HTTP 500",
    })
  })

  it("webhook en échec ET fermeture en échec → 502 quand même", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "réponse HTTP 500" })
    rpcs({
      creer_demande_panier: { data: ENVOI, error: null },
      echouer_envoi_demande_panier: { data: null, error: { code: "XX000", message: "boum" } },
    })

    const reponse = await POST(requete())

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

    const reponse = await POST(requete())

    expect(reponse.status).toBe(202)
    expect(await reponse.json()).toEqual({ demande_id: "d1" })
  })
})
