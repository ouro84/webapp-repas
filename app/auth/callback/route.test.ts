// @vitest-environment node
//
// GET /auth/callback (US-57) : échange du code, horodatage des CGU (RG-92) et
// redirections d'erreur qui conservent le contexte (`suivant`).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const serveur = vi.hoisted(() => ({
  getUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: serveur.getUser, exchangeCodeForSession: serveur.exchangeCodeForSession },
  }),
}))
const horodaterCguSiAbsentes = vi.hoisted(() => vi.fn())
vi.mock("@/lib/cgu-oauth", () => ({ horodaterCguSiAbsentes }))

import { GET } from "@/app/auth/callback/route"

const ORIGINE = "http://localhost:3000"

async function appeler(requete: string): Promise<URL> {
  const reponse = await GET(new NextRequest(`${ORIGINE}/auth/callback${requete}`))
  expect(reponse.status).toBeGreaterThanOrEqual(300)
  expect(reponse.status).toBeLessThan(400)
  return new URL(reponse.headers.get("location") ?? "")
}

function sansSession() {
  serveur.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } })
}
function avecSession() {
  serveur.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  horodaterCguSiAbsentes.mockResolvedValue(undefined)
  sansSession()
})

describe("GET /auth/callback, succès", () => {
  it("échange le code, horodate les CGU et redirige vers suivant sans recopier le code", async () => {
    serveur.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
    const url = await appeler("?code=abc&suivant=%2Foauth%2Fconsent%3Fauthorization_id%3Dx")
    expect(serveur.exchangeCodeForSession).toHaveBeenCalledWith("abc")
    expect(horodaterCguSiAbsentes).toHaveBeenCalledWith(expect.anything(), "u1")
    expect(url.pathname).toBe("/oauth/consent")
    expect(url.searchParams.get("authorization_id")).toBe("x")
    expect(url.searchParams.has("code")).toBe(false)
  })
})

describe("GET /auth/callback, erreurs sans session", () => {
  it("refus chez Google : /login?erreur_oauth=annule, suivant conservé s'il est valide", async () => {
    const url = await appeler("?error=access_denied&suivant=%2Foauth%2Fconsent%3Fauthorization_id%3Dx")
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.get("erreur_oauth")).toBe("annule")
    expect(url.searchParams.get("suivant")).toBe("/oauth/consent?authorization_id=x")
    expect(serveur.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("suivant malveillant : jamais propagé", async () => {
    const url = await appeler("?error=access_denied&suivant=%2F%2Fevil.com")
    expect(url.origin).toBe(ORIGINE)
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.has("suivant")).toBe(false)
  })

  it("sans suivant : /login?erreur_oauth=… seul", async () => {
    const url = await appeler("?error=access_denied")
    expect(url.search).toBe("?erreur_oauth=annule")
  })

  it("code absent : échec, sans appel d'échange", async () => {
    const url = await appeler("")
    expect(url.searchParams.get("erreur_oauth")).toBe("echec")
    expect(serveur.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("échec d'échange : /login?erreur_oauth=echec avec suivant", async () => {
    serveur.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "bad" } })
    const url = await appeler("?code=bidon&suivant=%2Fplanning%3Fcycle%3D2026-11-09")
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.get("erreur_oauth")).toBe("echec")
    expect(url.searchParams.get("suivant")).toBe("/planning?cycle=2026-11-09")
  })

  it("exception pendant l'échange : redirection d'échec, pas de 500 nu", async () => {
    serveur.exchangeCodeForSession.mockRejectedValue(new Error("réseau"))
    const url = await appeler("?code=abc")
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.get("erreur_oauth")).toBe("echec")
    expect(console.error).toHaveBeenCalled()
  })

  it("getUser qui lève : traité comme sans session", async () => {
    serveur.getUser.mockRejectedValue(new Error("cookies"))
    const url = await appeler("?error=access_denied&suivant=%2Fprofil%3Fsuppression%3Dconfirmer")
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.get("suivant")).toBe("/profil?suppression=confirmer")
  })
})

describe("GET /auth/callback, erreurs avec session existante (ré-authentification)", () => {
  it("annulation : retour sur suivant avec erreur_oauth, jamais /login", async () => {
    avecSession()
    const url = await appeler("?error=access_denied&suivant=%2Fprofil%3Fsuppression%3Dconfirmer")
    expect(url.pathname).toBe("/profil")
    expect(url.searchParams.get("suppression")).toBe("confirmer")
    expect(url.searchParams.get("erreur_oauth")).toBe("annule")
  })

  it("échec d'échange : retour sur suivant avec erreur_oauth=echec", async () => {
    avecSession()
    serveur.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "bad" } })
    const url = await appeler("?code=bidon&suivant=%2Fprofil%3Fsuppression%3Dconfirmer")
    expect(url.pathname).toBe("/profil")
    expect(url.searchParams.get("erreur_oauth")).toBe("echec")
  })

  it("session mais suivant invalide ou absent : /login?erreur_oauth=…", async () => {
    avecSession()
    const url = await appeler("?error=access_denied&suivant=%2F%2Fevil.com")
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.has("suivant")).toBe(false)
  })
})
