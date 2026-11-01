// Outils MCP prendre_demande_panier, rapporter_panier (#308, RG-81→84) et
// lancer_demande_panier (#320, RG-85). Client injecté ; client navigateur
// mocké pour lever (RG-71).

import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  limitePanier: vi.fn(),
  ancreDemandee: vi.fn(),
  envoyerWebhook: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({ limitePanier: m.limitePanier }))
vi.mock("@/lib/mcp/lecture", () => ({ ancreDemandee: m.ancreDemandee }))
vi.mock("@/lib/panier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/panier")>()),
  envoyerWebhook: m.envoyerWebhook,
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { ErreurOutil } from "@/lib/mcp/erreurs"
import { lancerDemandePanierMcp, prendreDemandePanier, rapporterPanier } from "@/lib/mcp/panier"
import { MESSAGES_PANIER, type RapportPanier } from "@/lib/panier"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

const DEMANDE = "11111111-1111-4111-8111-111111111111"

const RAPPORT: RapportPanier = {
  ajoutes: [{ article: "lait", produit: "Lait demi-écrémé 1 L", marque: "Lactel", quantite: 2 }],
  a_choisir: [{ article: "farine", raison: "plusieurs formats", candidats: ["T45 1 kg", "T55 1 kg"] }],
  introuvables: [{ article: "estragon" }],
}

describe("prendreDemandePanier (RG-81)", () => {
  it("prendre : null → { demande: null }", async () => {
    const { client, rpcs } = creerSupabaseMock({ rpc: { prendre_demande_panier: { data: null, error: null } } })
    expect(await prendreDemandePanier(client)).toEqual({ demande: null })
    expect(rpcs.map((r) => r.nom)).toEqual(["prendre_demande_panier"])
  })

  it("prendre : renvoie id et ancre", async () => {
    const { client } = creerSupabaseMock({
      rpc: { prendre_demande_panier: { data: { id: DEMANDE, ancre: "2026-10-29" }, error: null } },
    })
    expect(await prendreDemandePanier(client)).toEqual({ demande: { id: DEMANDE, ancre: "2026-10-29" } })
  })

  it("prendre : erreur PostgREST → exception (masquée par le serveur)", async () => {
    const { client } = creerSupabaseMock({
      rpc: { prendre_demande_panier: { data: null, error: { message: "boom" } } },
    })
    const promesse = prendreDemandePanier(client)
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})

describe("rapporterPanier (RG-83, RG-84)", () => {
  it("rapporter : transmet statut, rapport et motif à la RPC", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: { statut: "echec", rapport_tardif: false }, error: null } },
    })
    const resultat = await rapporterPanier(client, {
      demande_id: DEMANDE,
      statut: "echec",
      motif: "Session Chronodrive expirée",
      ...RAPPORT,
    })
    expect(rpcs).toEqual([
      {
        nom: "rapporter_panier",
        args: { p_demande: DEMANDE, p_statut: "echec", p_rapport: RAPPORT, p_motif: "Session Chronodrive expirée" },
      },
    ])
    expect(resultat).toEqual({ statut: "echec", rapport_tardif: false })
  })

  it("rapporter : terminee sans motif → p_motif null, rapport_tardif relayé", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: { statut: "terminee", rapport_tardif: true }, error: null } },
    })
    const resultat = await rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    expect(rpcs[0].args).toEqual({ p_demande: DEMANDE, p_statut: "terminee", p_rapport: RAPPORT, p_motif: null })
    expect(resultat).toEqual({ statut: "terminee", rapport_tardif: true })
  })

  it("rapporter : echec sans motif → ErreurOutil", async () => {
    for (const motif of [undefined, "  "]) {
      const { client, rpcs } = creerSupabaseMock()
      await expect(
        rapporterPanier(client, { demande_id: DEMANDE, statut: "echec", motif, ...RAPPORT })
      ).rejects.toBeInstanceOf(ErreurOutil)
      expect(rpcs).toEqual([])
    }
  })

  it("rapporter : OMQ03 → ErreurOutil avec MESSAGES_PANIER.OMQ03", async () => {
    const { client } = creerSupabaseMock({
      rpc: {
        rapporter_panier: {
          data: null,
          error: { message: "Demande de panier introuvable ou déjà close", code: "OMQ03" },
        },
      },
    })
    const promesse = rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ03)
  })

  it("rapporter : autre erreur PostgREST → exception non ErreurOutil", async () => {
    const { client } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: null, error: { message: "boom", code: "XX000" } } },
    })
    const promesse = rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})

describe("lancerDemandePanierMcp (#320, RG-85)", () => {
  // Jeudi 29 octobre 2026, jour de courses jeudi → cycle courant d'ancre 2026-10-29.
  const JEUDI = new Date(2026, 9, 29, 12)
  const ENVOI = { demande_id: DEMANDE, url: "https://nas.test/hook", entetes: {}, corps: "{}" }

  function mock(rpc: Record<string, { data: unknown; error: { message: string; code?: string } | null }> = {}) {
    return creerSupabaseMock({
      tables: { foyers: { data: { jour_courses: 4 }, error: null } },
      rpc: { creer_demande_panier: { data: ENVOI, error: null }, ...rpc },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    m.limitePanier.mockResolvedValue({ autorise: true })
    m.envoyerWebhook.mockResolvedValue({ ok: true })
    m.ancreDemandee.mockResolvedValue("2026-11-05")
  })

  it("lancer : ancre résolue par ancreDemandee puis creer_demande_panier et webhook", async () => {
    const { client, rpcs } = mock()
    const resultat = await lancerDemandePanierMcp(client, "user-1", { ancre: "2026-11-07" }, JEUDI)
    expect(m.limitePanier).toHaveBeenCalledWith("user-1")
    expect(m.ancreDemandee).toHaveBeenCalledWith(client, "2026-11-07", JEUDI)
    expect(rpcs).toEqual([{ nom: "creer_demande_panier", args: { p_ancre: "2026-11-05" } }])
    expect(m.envoyerWebhook).toHaveBeenCalledTimes(1)
    expect(m.envoyerWebhook.mock.calls[0][0]).toEqual(ENVOI)
    expect(resultat).toEqual({ demande_id: DEMANDE, ancre: "2026-11-05" })
  })

  it("lancer sans ancre : cycle courant, ancreDemandee non appelée", async () => {
    const { client, rpcs } = mock()
    const resultat = await lancerDemandePanierMcp(client, "user-1", {}, JEUDI)
    expect(m.ancreDemandee).not.toHaveBeenCalled()
    expect(rpcs).toEqual([{ nom: "creer_demande_panier", args: { p_ancre: "2026-10-29" } }])
    expect(resultat).toEqual({ demande_id: DEMANDE, ancre: "2026-10-29" })
  })

  it("lancer : OMQ02 → ErreurOutil (demande déjà en cours), aucun webhook", async () => {
    const { client } = mock({
      creer_demande_panier: { data: null, error: { message: "déjà active", code: "OMQ02" } },
    })
    const promesse = lancerDemandePanierMcp(client, "user-1", {}, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ02)
    expect(m.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("lancer : OMQ04 → ErreurOutil (cycle terminé)", async () => {
    const { client } = mock({
      creer_demande_panier: { data: null, error: { message: "cycle terminé", code: "OMQ04" } },
    })
    const promesse = lancerDemandePanierMcp(client, "user-1", { ancre: "2026-10-01" }, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ04)
  })

  it("lancer : quota épuisé → ErreurOutil sans RPC", async () => {
    m.limitePanier.mockResolvedValue({ autorise: false })
    const { client, rpcs } = mock()
    await expect(lancerDemandePanierMcp(client, "user-1", {}, JEUDI)).rejects.toBeInstanceOf(ErreurOutil)
    expect(rpcs).toEqual([])
    expect(m.ancreDemandee).not.toHaveBeenCalled()
  })

  it("lancer : ancre invalide (ErreurOutil d'ancreDemandee) → propagée, aucune RPC", async () => {
    m.ancreDemandee.mockRejectedValue(new ErreurOutil("Date invalide"))
    const { client, rpcs } = mock()
    await expect(lancerDemandePanierMcp(client, "user-1", { ancre: "x" }, JEUDI)).rejects.toThrow("Date invalide")
    expect(rpcs).toEqual([])
  })

  it("lancer : exécuteur injoignable (502) → ErreurOutil qui dit de réessayer plus tard, sans la cause brute", async () => {
    m.envoyerWebhook.mockResolvedValue({ ok: false, motif: "réponse HTTP 500" })
    const { client } = mock({ echouer_envoi_demande_panier: { data: true, error: null } })
    const erreur = await lancerDemandePanierMcp(client, "user-1", {}, JEUDI).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurOutil)
    expect((erreur as Error).message).toMatch(/pas répondu/)
    expect((erreur as Error).message).toMatch(/plus tard/)
    expect((erreur as Error).message).not.toMatch(/HTTP/)
  })

  it("lancer : erreur inattendue de la RPC → exception masquée par le serveur (pas ErreurOutil)", async () => {
    const { client } = mock({ creer_demande_panier: { data: null, error: { message: "boom", code: "XX000" } } })
    await expect(lancerDemandePanierMcp(client, "user-1", {}, JEUDI)).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})
