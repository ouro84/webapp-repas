// @vitest-environment node
// Proxy Next 16 (#305) : routes servies sans session à cookies, protection de
// /oauth avec retour après connexion (RG-72), coût réseau par requête.
//
// Chaque requête (document ET préchargement de lien) passe par le proxy ; avec
// des fonctions loin de Supabase, chaque appel réseau s'y paie ~85 ms. Il
// authentifie donc par `getClaims` (JWT vérifié localement) et ne lit
// `profiles.onboarding_complete` qu'une fois par appareil : le cookie
// `omq_onboarde`, lié au `sub`, mémorise un onboarding déjà terminé.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const etat = vi.hoisted(() => ({
  user: null as { id: string } | null,
  onboarde: true,
  // Erreurs simulées : session illisible (Supabase indisponible), lecture du profil.
  claimsEnErreur: false,
  profilEnErreur: false,
  getUser: vi.fn(),
  tables: [] as string[],
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => {
        if (etat.claimsEnErreur) throw new Error("réseau")
        return { data: etat.user ? { claims: { sub: etat.user.id } } : null, error: null }
      },
      getUser: etat.getUser,
    },
    from: (table: string) => {
      etat.tables.push(table)
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              if (etat.profilEnErreur) throw new Error("boom")
              return { data: { onboarding_complete: etat.onboarde } }
            },
          }),
        }),
      }
    },
  }),
}))

import { COOKIE_ONBOARDE, proxy, sansSession } from "./proxy"

beforeEach(() => {
  etat.user = null
  etat.onboarde = true
  etat.claimsEnErreur = false
  etat.profilEnErreur = false
  etat.getUser.mockReset()
  etat.tables.length = 0
  vi.spyOn(console, "error").mockImplementation(() => {})
})

function requete(chemin: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  return new NextRequest(`https://omq.test${chemin}`, { headers: cookie ? { cookie } : {} })
}

describe("sansSession (#305)", () => {
  it("sansSession : /api/mcp et /.well-known/* vrais ; /api/planning/generer, /oauth/consent faux", () => {
    expect(sansSession("/api/mcp")).toBe(true)
    expect(sansSession("/api/mcp/executeur")).toBe(true) // #330
    expect(sansSession("/.well-known/oauth-protected-resource/api/mcp/executeur")).toBe(true)
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

describe("proxy — authentification sans appel réseau", () => {
  it("authentifie par getClaims, jamais par getUser (appel réseau à Supabase Auth)", async () => {
    etat.user = { id: "u1" }
    await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(etat.getUser).not.toHaveBeenCalled()
  })

  it("Supabase indisponible : dégradé en « non connecté », sans crash (#169)", async () => {
    etat.claimsEnErreur = true
    const reponse = await proxy(requete("/planning"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/login")
  })
})

describe("proxy — garde d'onboarding et cookie omq_onboarde", () => {
  it("cookie du même utilisateur : aucune lecture de profiles", async () => {
    etat.user = { id: "u1" }
    const reponse = await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(etat.tables).toEqual([])
    expect(reponse.headers.get("location")).toBeNull()
  })

  it("sans cookie, onboarding terminé en base : une lecture, puis le cookie est posé", async () => {
    etat.user = { id: "u1" }
    const reponse = await proxy(requete("/planning"))
    expect(etat.tables).toEqual(["profiles"])
    const cookie = reponse.cookies.get(COOKIE_ONBOARDE)
    expect(cookie?.value).toBe("u1")
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
  })

  it("cookie posé pour un AUTRE utilisateur (même navigateur) : relu en base", async () => {
    etat.user = { id: "u2" }
    etat.onboarde = false
    const reponse = await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(etat.tables).toEqual(["profiles"])
    expect(reponse.headers.get("location")).toBe("https://omq.test/bienvenue")
  })

  it("onboarding non terminé : redirection vers /bienvenue, sans cookie", async () => {
    etat.user = { id: "u1" }
    etat.onboarde = false
    const reponse = await proxy(requete("/ce-soir"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/bienvenue")
    expect(reponse.cookies.get(COOKIE_ONBOARDE)).toBeUndefined()
  })

  it("lecture en échec : fail-open (onboardé), mais aucun cookie posé", async () => {
    etat.user = { id: "u1" }
    etat.profilEnErreur = true
    const reponse = await proxy(requete("/planning"))
    expect(reponse.headers.get("location")).toBeNull()
    expect(reponse.cookies.get(COOKIE_ONBOARDE)).toBeUndefined()
  })

  it("« / » d'un connecté onboardé : redirection vers /ce-soir, cookie posé sur la redirection", async () => {
    etat.user = { id: "u1" }
    const reponse = await proxy(requete("/"))
    expect(reponse.headers.get("location")).toBe("https://omq.test/ce-soir")
    expect(reponse.cookies.get(COOKIE_ONBOARDE)?.value).toBe("u1")
  })

  it("/bienvenue avec cookie : un onboardé ne revient pas dans le tunnel", async () => {
    etat.user = { id: "u1" }
    const reponse = await proxy(requete("/bienvenue", { [COOKIE_ONBOARDE]: "u1" }))
    expect(reponse.headers.get("location")).toBe("https://omq.test/planning")
  })
})
