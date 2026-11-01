// @vitest-environment node
// Proxy Next 16 (#305) : routes servies sans session à cookies, protection de
// /oauth avec retour après connexion (RG-72).
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const etat = vi.hoisted(() => ({
  user: null as { id: string } | null,
  onboarde: true,
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: etat.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { onboarding_complete: etat.onboarde } }) }),
      }),
    }),
  }),
}))

import { proxy, sansSession } from "./proxy"

beforeEach(() => {
  etat.user = null
  etat.onboarde = true
})

describe("sansSession (#305)", () => {
  it("sansSession : /api/mcp et /.well-known/* vrais ; /api/planning/generer, /oauth/consent faux", () => {
    expect(sansSession("/api/mcp")).toBe(true)
    expect(sansSession("/.well-known/oauth-protected-resource/api/mcp")).toBe(true)
    expect(sansSession("/api/planning/generer")).toBe(false)
    expect(sansSession("/oauth/consent")).toBe(false)
    expect(sansSession("/api/mcpx")).toBe(false)
    expect(sansSession("/.well-known/oauth-protected-resource")).toBe(true)
    expect(sansSession("/.well-known/security.txt")).toBe(false)
  })
})

describe("proxy — consentement OAuth (RG-72)", () => {
  it("chemin /oauth non connecté → /login?suivant=…", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/oauth/consent?authorization_id=abc"))
    const cible = new URL(reponse.headers.get("location")!)
    expect(cible.pathname).toBe("/login")
    expect(cible.searchParams.get("suivant")).toBe("/oauth/consent?authorization_id=abc")
  })

  it("connecté et onboardé sur /login?suivant=… → retour au consentement", async () => {
    etat.user = { id: "u1" }
    const suivant = encodeURIComponent("/oauth/consent?authorization_id=abc")
    const reponse = await proxy(new NextRequest(`https://omq.test/login?suivant=${suivant}`))
    expect(reponse.headers.get("location")).toBe("https://omq.test/oauth/consent?authorization_id=abc")
  })

  it("connecté sur /login avec un suivant externe → /planning", async () => {
    etat.user = { id: "u1" }
    const reponse = await proxy(new NextRequest("https://omq.test/login?suivant=%2F%2Fevil.com"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/planning")
  })

  it("onboarding non terminé : /oauth/consent → /bienvenue", async () => {
    etat.user = { id: "u1" }
    etat.onboarde = false
    const reponse = await proxy(new NextRequest("https://omq.test/oauth/consent?authorization_id=abc"))
    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/bienvenue")
  })

  it("/oauthxyz n'est pas le consentement : pas de suivant", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/oauthxyz"))
    const location = reponse.headers.get("location")
    expect(location === null || !location.includes("suivant")).toBe(true)
  })

  it("une route protégée hors /oauth garde la redirection /login sans suivant", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/planning"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/login")
  })
})

describe("proxy — lien profond du cycle (#320, RG-87)", () => {
  it("/planning?cycle=… non connecté → /login?suivant=/planning?cycle=…", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/planning?cycle=2026-11-09"))
    const cible = new URL(reponse.headers.get("location")!)
    expect(cible.pathname).toBe("/login")
    expect(cible.searchParams.get("suivant")).toBe("/planning?cycle=2026-11-09")
  })

  it("/planningx?cycle=… non connecté → /login sans suivant", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/planningx?cycle=2026-11-09"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/login")
  })

  it("connecté et onboardé sur /login?suivant=/planning?cycle=… → retour au lien profond", async () => {
    etat.user = { id: "u1" }
    const suivant = encodeURIComponent("/planning?cycle=2026-11-09")
    const reponse = await proxy(new NextRequest(`https://omq.test/login?suivant=${suivant}`))
    expect(reponse.headers.get("location")).toBe("https://omq.test/planning?cycle=2026-11-09")
  })

  it("/courses non connecté → /login sans suivant", async () => {
    const reponse = await proxy(new NextRequest("https://omq.test/courses"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/login")
  })
})
