// Proxy (Next 16) : coût réseau par requête et garde d'onboarding.
//
// Chaque requête (document ET préchargement de lien) passe par le proxy. Avec
// des fonctions loin de Supabase, chaque appel réseau s'y paie ~85 ms. Le proxy
// authentifie donc par `getClaims` (JWT vérifié localement) et ne lit
// `profiles.onboarding_complete` qu'une fois par appareil : le cookie
// `omq_onboarde`, lié au `sub`, mémorise un onboarding déjà terminé.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const supabase = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  lectureProfil: vi.fn(),
  tables: [] as string[],
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: supabase.getClaims, getUser: supabase.getUser },
    from: (table: string) => {
      supabase.tables.push(table)
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: () => supabase.lectureProfil(),
      }
      return builder
    },
  }),
}))

import { proxy, COOKIE_ONBOARDE } from "@/proxy"

function requete(chemin: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  return new NextRequest(`http://localhost${chemin}`, { headers: cookie ? { cookie } : {} })
}

function connecte(sub = "u1") {
  supabase.getClaims.mockResolvedValue({ data: { claims: { sub } }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  supabase.tables.length = 0
  vi.spyOn(console, "error").mockImplementation(() => {})
  supabase.lectureProfil.mockResolvedValue({ data: { onboarding_complete: true }, error: null })
})

describe("proxy : authentification", () => {
  it("authentifie par getClaims, jamais par getUser (appel réseau à Supabase Auth)", async () => {
    connecte()
    await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(supabase.getClaims).toHaveBeenCalledTimes(1)
    expect(supabase.getUser).not.toHaveBeenCalled()
  })

  it("route protégée sans session : redirection vers /login", async () => {
    supabase.getClaims.mockResolvedValue({ data: null, error: null })
    const reponse = await proxy(requete("/planning"))
    expect(reponse.headers.get("location")).toBe("http://localhost/login")
  })

  it("Supabase indisponible : dégradé en « non connecté », sans crash (#169)", async () => {
    supabase.getClaims.mockRejectedValue(new Error("réseau"))
    const reponse = await proxy(requete("/planning"))
    expect(reponse.headers.get("location")).toBe("http://localhost/login")
  })
})

describe("proxy : garde d'onboarding", () => {
  it("cookie omq_onboarde du même utilisateur : aucune lecture de profiles", async () => {
    connecte("u1")
    const reponse = await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(supabase.tables).toEqual([])
    expect(reponse.headers.get("location")).toBeNull()
  })

  it("sans cookie, onboarding terminé en base : une lecture, puis le cookie est posé", async () => {
    connecte("u1")
    const reponse = await proxy(requete("/planning"))
    expect(supabase.tables).toEqual(["profiles"])
    const cookie = reponse.cookies.get(COOKIE_ONBOARDE)
    expect(cookie?.value).toBe("u1")
    expect(cookie?.httpOnly).toBe(true)
  })

  it("cookie posé pour un AUTRE utilisateur (même navigateur) : relu en base", async () => {
    connecte("u2")
    supabase.lectureProfil.mockResolvedValue({ data: { onboarding_complete: false }, error: null })
    const reponse = await proxy(requete("/planning", { [COOKIE_ONBOARDE]: "u1" }))
    expect(supabase.tables).toEqual(["profiles"])
    expect(reponse.headers.get("location")).toBe("http://localhost/bienvenue")
  })

  it("onboarding non terminé : redirection vers /bienvenue, sans cookie", async () => {
    connecte("u1")
    supabase.lectureProfil.mockResolvedValue({ data: { onboarding_complete: false }, error: null })
    const reponse = await proxy(requete("/ce-soir"))
    expect(reponse.headers.get("location")).toBe("http://localhost/bienvenue")
    expect(reponse.cookies.get(COOKIE_ONBOARDE)).toBeUndefined()
  })

  it("lecture en échec : fail-open (onboardé), mais aucun cookie posé", async () => {
    connecte("u1")
    supabase.lectureProfil.mockRejectedValue(new Error("boom"))
    const reponse = await proxy(requete("/planning"))
    expect(reponse.headers.get("location")).toBeNull()
    expect(reponse.cookies.get(COOKIE_ONBOARDE)).toBeUndefined()
  })

  it("« / » d'un connecté onboardé : redirection vers /ce-soir, cookie posé sur la redirection", async () => {
    connecte("u1")
    const reponse = await proxy(requete("/"))
    expect(reponse.headers.get("location")).toBe("http://localhost/ce-soir")
    expect(reponse.cookies.get(COOKIE_ONBOARDE)?.value).toBe("u1")
  })

  it("/bienvenue avec cookie : un onboardé ne revient pas dans le tunnel", async () => {
    connecte("u1")
    const reponse = await proxy(requete("/bienvenue", { [COOKIE_ONBOARDE]: "u1" }))
    expect(reponse.headers.get("location")).toBe("http://localhost/planning")
  })
})
