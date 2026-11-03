// @vitest-environment node
// Route /api/mcp/executeur (#330, RG-83, RG-85) : endpoint dédié au run de
// l'exécuteur de panier. Mêmes garde-fous que /api/mcp (auth OAuth, quota),
// mais seulement trois outils : prise signée, coche sur le cycle de la demande
// prise, rapport.

import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  verifierJetonMcp: vi.fn(),
  limiteMcp: vi.fn(),
  prendreDemandeExecuteur: vi.fn(),
  cocherArticleDemande: vi.fn(),
  rapporterPanier: vi.fn(),
  creerClientParJeton: vi.fn((jeton: string) => ({ jeton })),
}))

vi.mock("@/lib/mcp/auth", () => ({
  verifierJetonMcp: m.verifierJetonMcp,
  emetteurOAuth: () => "https://ref.supabase.co/auth/v1",
}))
vi.mock("@/lib/rate-limit", () => ({
  limiteMcp: m.limiteMcp,
  limiteGeneration: vi.fn(),
  limitePanier: vi.fn(),
}))
vi.mock("@/lib/mcp/executeur", () => ({
  prendreDemandeExecuteur: m.prendreDemandeExecuteur,
  cocherArticleDemande: m.cocherArticleDemande,
}))
vi.mock("@/lib/mcp/panier", () => ({
  lancerDemandePanierMcp: vi.fn(),
  rapporterPanier: m.rapporterPanier,
}))
vi.mock("@/lib/supabase/par-jeton", () => ({ creerClientParJeton: m.creerClientParJeton }))

import { POST } from "./route"

const AUTH_INFO = {
  token: "jwt-oauth",
  clientId: "client-1",
  scopes: [],
  expiresAt: 4_000_000_000,
  extra: { userId: "user-1" },
}

const DEMANDE = "11111111-1111-4111-8111-111111111111"

let id = 0
function requete(methode: string, params: unknown = {}, jeton: string | null = "jwt-oauth") {
  const entetes: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  if (jeton) entetes.Authorization = `Bearer ${jeton}`
  return new Request("https://omq.test/api/mcp/executeur", {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: methode, params }),
  })
}

async function lire(reponse: Response): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
  const texte = await reponse.text()
  const ligne = texte.split("\n").find((l) => l.startsWith("data:"))
  return JSON.parse(ligne ? ligne.slice(5) : texte)
}

async function appeler(methode: string, params: unknown = {}) {
  await POST(
    requete("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })
  )
  return POST(requete(methode, params))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.verifierJetonMcp.mockResolvedValue(AUTH_INFO)
  m.limiteMcp.mockResolvedValue({ autorise: true })
})

describe("POST /api/mcp/executeur — authentification et quota (RG-71)", () => {
  it("sans Bearer → 401, WWW-Authenticate pointe la metadata de l'endpoint exécuteur", async () => {
    m.verifierJetonMcp.mockResolvedValue(undefined)
    const reponse = await POST(requete("tools/list", {}, null))
    expect(reponse.status).toBe(401)
    expect(reponse.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://omq.test/.well-known/oauth-protected-resource/api/mcp/executeur"'
    )
  })

  it("quota dépassé → 429 JSON-RPC et Retry-After", async () => {
    m.limiteMcp.mockResolvedValue({ autorise: false })
    const reponse = await POST(requete("tools/list"))
    expect(reponse.status).toBe(429)
    expect(reponse.headers.get("Retry-After")).toBe("60")
    expect(m.limiteMcp).toHaveBeenCalledWith("user-1")
  })
})

describe("POST /api/mcp/executeur — outils (#330)", () => {
  it("tools/list expose exactement prendre_demande_panier, cocher_article_demande et rapporter_panier", async () => {
    const { result } = await lire(await appeler("tools/list"))
    const noms = (result?.tools as Array<{ name: string }>).map((t) => t.name)
    expect(noms).toEqual(["prendre_demande_panier", "cocher_article_demande", "rapporter_panier"])
  })

  it("prendre_demande_panier : client par jeton et date de Paris, résultat relayé", async () => {
    m.prendreDemandeExecuteur.mockResolvedValue({ demande: null, raison: "Aucune demande en attente." })
    const { result } = await lire(await appeler("tools/call", { name: "prendre_demande_panier", arguments: {} }))
    expect(m.prendreDemandeExecuteur).toHaveBeenCalledWith({ jeton: "jwt-oauth" }, expect.any(Date))
    expect(result?.structuredContent).toEqual({ demande: null, raison: "Aucune demande en attente." })
  })

  it("cocher_article_demande appelle cocherArticleDemande avec libellé, quantité et date de Paris", async () => {
    m.cocherArticleDemande.mockResolvedValue({ modifie: true, article: {} })
    const { result } = await lire(
      await appeler("tools/call", {
        name: "cocher_article_demande",
        arguments: { libelle: "lait", quantite: "2 L" },
      })
    )
    expect(result?.isError).toBeFalsy()
    expect(m.cocherArticleDemande).toHaveBeenCalledWith(
      { jeton: "jwt-oauth" },
      { libelle: "lait", quantite: "2 L" },
      expect.any(Date)
    )
  })

  it("cocher_article_demande n'a pas d'`ancre` dans son schéma", async () => {
    const { result } = await lire(await appeler("tools/list"))
    const outil = (
      result?.tools as Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>
    ).find((t) => t.name === "cocher_article_demande")!
    expect(Object.keys(outil.inputSchema.properties).sort()).toEqual(["libelle", "quantite"])
  })

  it("rapporter_panier : arguments transmis tels quels", async () => {
    m.rapporterPanier.mockResolvedValue({ statut: "terminee", rapport_tardif: false })
    const args = {
      demande_id: DEMANDE,
      statut: "terminee",
      ajoutes: [],
      a_choisir: [],
      introuvables: [{ article: "estragon" }],
    }
    const { result } = await lire(await appeler("tools/call", { name: "rapporter_panier", arguments: args }))
    expect(result?.isError).toBeFalsy()
    expect(m.rapporterPanier).toHaveBeenCalledWith({ jeton: "jwt-oauth" }, args)
  })

  it("les descriptions guident l'exécuteur : prise en premier, jeton à recopier, coche juste après l'ajout", async () => {
    const { result } = await lire(await appeler("tools/list"))
    const description = (nom: string) =>
      (result?.tools as Array<{ name: string; description: string }>).find((t) => t.name === nom)!.description
    expect(description("prendre_demande_panier")).toBe(
      "À appeler en premier, avant toute autre action. Renvoie la demande et la liste à mettre au panier. Chaque article porte un `jeton` à recopier tel quel dans `jetons` de ajouter_au_panier. `demande: null` → arrête-toi."
    )
    expect(description("cocher_article_demande")).toBe(
      "Coche l'article juste après son ajout confirmé au panier. Le cycle vient de la demande prise : il n'y a pas d'`ancre`."
    )
    expect(description("rapporter_panier")).toContain("cocher_article_demande")
    expect(description("rapporter_panier")).not.toMatch(/cocher_article(?!_demande)/)
  })
})
