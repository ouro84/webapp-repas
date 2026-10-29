// @vitest-environment node
// Route /api/mcp (#305, RG-71, RG-78) : authentification OAuth, rate-limit
// dédié et exposition des trois outils de lecture via mcp-handler v2.

import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  verifierJetonMcp: vi.fn(),
  limiteMcp: vi.fn(),
  lireRecette: vi.fn(),
  lirePlanning: vi.fn(),
  lireListeCourses: vi.fn(),
  limiteGeneration: vi.fn(),
  genererCycle: vi.fn(),
  remplacerRepas: vi.fn(),
  changerPersonnes: vi.fn(),
  ajouterRecette: vi.fn(),
  ajouterArticleCourses: vi.fn(),
  cocherArticle: vi.fn(),
  creerClientParJeton: vi.fn((jeton: string) => ({ jeton })),
}))

vi.mock("@/lib/mcp/auth", () => ({
  verifierJetonMcp: m.verifierJetonMcp,
  emetteurOAuth: () => "https://ref.supabase.co/auth/v1",
}))
vi.mock("@/lib/rate-limit", () => ({ limiteMcp: m.limiteMcp, limiteGeneration: m.limiteGeneration }))
vi.mock("@/lib/mcp/ecriture-planning", () => ({
  genererCycle: m.genererCycle,
  remplacerRepas: m.remplacerRepas,
  changerPersonnes: m.changerPersonnes,
}))
vi.mock("@/lib/mcp/ecriture-recettes", () => ({ ajouterRecette: m.ajouterRecette }))
vi.mock("@/lib/mcp/ecriture-courses", () => ({
  ajouterArticleCourses: m.ajouterArticleCourses,
  cocherArticle: m.cocherArticle,
}))
vi.mock("@/lib/mcp/lecture", () => ({
  lireRecette: m.lireRecette,
  lirePlanning: m.lirePlanning,
  lireListeCourses: m.lireListeCourses,
}))
vi.mock("@/lib/supabase/par-jeton", () => ({ creerClientParJeton: m.creerClientParJeton }))

import { POST } from "./route"
import { ErreurOutil } from "@/lib/mcp/erreurs"

const AUTH_INFO = {
  token: "jwt-oauth",
  clientId: "client-1",
  scopes: [],
  expiresAt: 4_000_000_000,
  extra: { userId: "user-1" },
}

let id = 0
function requete(methode: string, params: unknown = {}, jeton: string | null = "jwt-oauth") {
  const entetes: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  if (jeton) entetes.Authorization = `Bearer ${jeton}`
  return new Request("https://omq.test/api/mcp", {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: methode, params }),
  })
}

// Réponse JSON-RPC, en JSON ou en SSE (ligne `data:`).
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
  m.limiteGeneration.mockResolvedValue({ autorise: true })
})

describe("POST /api/mcp — authentification (RG-71)", () => {
  it("POST sans Bearer → 401, WWW-Authenticate contient resource_metadata=…/.well-known/oauth-protected-resource/api/mcp", async () => {
    m.verifierJetonMcp.mockResolvedValue(undefined)
    const reponse = await POST(requete("tools/list", {}, null))
    expect(reponse.status).toBe(401)
    expect(reponse.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://omq.test/.well-known/oauth-protected-resource/api/mcp"'
    )
  })

  it("jeton refusé par verifierJetonMcp → 401", async () => {
    m.verifierJetonMcp.mockResolvedValue(undefined)
    const reponse = await POST(requete("tools/list", {}, "jwt-web"))
    expect(reponse.status).toBe(401)
    expect(m.lirePlanning).not.toHaveBeenCalled()
  })
})

describe("POST /api/mcp — outils (US-51, RG-78)", () => {
  it("jeton valide : tools/list expose exactement les 3 lectures et les 6 écritures (#306)", async () => {
    const reponse = await appeler("tools/list")
    expect(reponse.status).toBe(200)
    const { result } = await lire(reponse)
    const noms = (result?.tools as Array<{ name: string }>).map((t) => t.name).sort()
    expect(noms).toEqual([
      "ajouter_article_courses",
      "ajouter_recette",
      "changer_personnes",
      "cocher_article",
      "generer_cycle",
      "lire_liste_courses",
      "lire_planning",
      "lire_recette",
      "remplacer_repas",
    ])
  })

  it("tools/call lire_recette : ErreurOutil → isError true et message français", async () => {
    m.lireRecette.mockRejectedValue(new ErreurOutil("Aucun repas prévu le jeudi 29 octobre au soir."))
    const reponse = await appeler("tools/call", {
      name: "lire_recette",
      arguments: { date: "2026-10-29", creneau: "soir" },
    })
    const { result } = await lire(reponse)
    expect(result?.isError).toBe(true)
    expect(result?.content).toEqual([{ type: "text", text: "Aucun repas prévu le jeudi 29 octobre au soir." }])
  })

  it("tools/call : exception inattendue → message générique et log", async () => {
    const espion = vi.spyOn(console, "error").mockImplementation(() => {})
    m.lirePlanning.mockRejectedValue(new Error("PostgREST 500"))
    const { result } = await lire(await appeler("tools/call", { name: "lire_planning", arguments: {} }))
    expect(result?.isError).toBe(true)
    expect(result?.content).toEqual([{ type: "text", text: "Erreur interne d'OMQ. Réessaie dans un instant." }])
    expect(espion).toHaveBeenCalled()
    espion.mockRestore()
  })

  it("le client des outils est créé avec le jeton de la requête", async () => {
    m.lireListeCourses.mockResolvedValue({ categories: [], a_verifier_au_placard: [], nombre_articles: 0 })
    const { result } = await lire(
      await appeler("tools/call", { name: "lire_liste_courses", arguments: { inclure_coches: true } })
    )
    expect(m.creerClientParJeton).toHaveBeenCalledWith("jwt-oauth")
    expect(m.lireListeCourses).toHaveBeenCalledWith({ jeton: "jwt-oauth" }, { inclure_coches: true }, expect.any(Date))
    expect(result?.structuredContent).toEqual({ categories: [], a_verifier_au_placard: [], nombre_articles: 0 })
  })
})

describe("POST /api/mcp — date du jour (fuseau du foyer)", () => {
  it("les outils reçoivent la date de Paris, pas celle d'UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T23:30:00Z")) // samedi 00h30 à Paris (UTC+1)
    try {
      m.lirePlanning.mockResolvedValue({ periode: {}, repas: [] })
      await lire(await appeler("tools/call", { name: "lire_planning", arguments: {} }))
      const aujourdhui = m.lirePlanning.mock.calls[0][2] as Date
      expect([aujourdhui.getMonth(), aujourdhui.getDate()]).toEqual([9, 31])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("POST /api/mcp — descriptions des outils", () => {
  it("lire_planning et lire_recette expliquent restes: true (rien à cuisiner)", async () => {
    const { result } = await lire(await appeler("tools/list"))
    const outils = result?.tools as Array<{ name: string; description: string }>
    for (const nom of ["lire_planning", "lire_recette"]) {
      expect(outils.find((o) => o.name === nom)!.description).toContain("`restes: true`")
    }
  })
})

describe("POST /api/mcp — rate-limit (RG-78)", () => {
  it("quota dépassé → 429 JSON-RPC et Retry-After", async () => {
    m.limiteMcp.mockResolvedValue({ autorise: false })
    const reponse = await POST(requete("tools/list"))
    expect(reponse.status).toBe(429)
    expect(reponse.headers.get("Retry-After")).toBe("60")
    expect(m.limiteMcp).toHaveBeenCalledWith("user-1")
    const corps = await reponse.json()
    expect(corps.error.message).toBe("Trop de requêtes en peu de temps. Patiente une minute puis réessaie.")
  })
})

describe("POST /api/mcp — outils d'écriture (#306, US-52)", () => {
  it("generer_cycle : le contrôle de quota passé à l'outil refuse au-delà du quota de génération", async () => {
    m.limiteGeneration.mockResolvedValue({ autorise: false })
    // L'outil appelle le contrôle juste avant de générer (un refus « cycle existant » ne consomme rien).
    m.genererCycle.mockImplementation(async (_s: unknown, _a: unknown, _d: unknown, quota: () => Promise<void>) => {
      await quota()
      return { periode: {}, repas: [], avertissements: {} }
    })
    const { result } = await lire(await appeler("tools/call", { name: "generer_cycle", arguments: {} }))
    expect(m.limiteGeneration).toHaveBeenCalledWith("user-1")
    expect(result?.isError).toBe(true)
    expect(result?.content).toEqual([
      { type: "text", text: "Trop de générations en peu de temps. Patiente une minute puis réessaie." },
    ])
  })

  it("generer_cycle : client par jeton, arguments, date de Paris et contrôle de quota transmis", async () => {
    m.genererCycle.mockResolvedValue({ periode: {}, repas: [], avertissements: {} })
    await appeler("tools/call", { name: "generer_cycle", arguments: { remplacer: true } })
    expect(m.genererCycle).toHaveBeenCalledWith(
      { jeton: "jwt-oauth" },
      { remplacer: true },
      expect.any(Date),
      expect.any(Function)
    )
    expect(m.limiteGeneration).not.toHaveBeenCalled()
  })

  it("les descriptions guident l'assistant : restes, singulier des ingrédients, total des candidats", async () => {
    const { result } = await lire(await appeler("tools/list"))
    const description = (nom: string) =>
      (result?.tools as Array<{ name: string; description: string }>).find((t) => t.name === nom)!.description
    expect(description("remplacer_repas")).toContain("restes")
    expect(description("remplacer_repas")).toContain("`total`")
    expect(description("changer_personnes")).toContain("restes")
    expect(description("ajouter_recette")).toContain("singulier")
  })

  it("ajouter_recette reçoit l'utilisateur du jeton comme auteur", async () => {
    m.ajouterRecette.mockResolvedValue({ recette: {} })
    const recette = {
      nom: "Gratin",
      temps_preparation: "normal",
      ingredients: [{ nom: "pommes de terre", quantite: 500, unite: "g", categorie: "legumes-fruits" }],
    }
    const { result } = await lire(await appeler("tools/call", { name: "ajouter_recette", arguments: recette }))
    expect(result?.isError).toBeFalsy()
    expect(m.ajouterRecette).toHaveBeenCalledWith({ jeton: "jwt-oauth" }, "user-1", recette)
  })

  it("changer_personnes transmet date, créneau et nombre", async () => {
    m.changerPersonnes.mockResolvedValue({ repas: {} })
    await appeler("tools/call", {
      name: "changer_personnes",
      arguments: { date: "2026-10-31", creneau: "soir", personnes: 6 },
    })
    expect(m.changerPersonnes).toHaveBeenCalledWith(
      { jeton: "jwt-oauth" },
      { date: "2026-10-31", creneau: "soir", personnes: 6 },
      expect.any(Date)
    )
  })
})
