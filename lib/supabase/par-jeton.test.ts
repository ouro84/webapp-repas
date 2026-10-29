// Fabrique de client Supabase « par jeton » (#304, socle du serveur MCP #302).
// Garde RG-71 : l'assistant agit en tant que l'utilisateur (clé anon + JWT
// Bearer), jamais avec la clé service_role.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const supabaseJs = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ factice: true })),
}))
vi.mock("@supabase/supabase-js", () => supabaseJs)

import { creerClientParJeton } from "@/lib/supabase/par-jeton"

const URL_SUPABASE = "https://exemple.supabase.co"
const CLE_ANON = "cle-anon-publique"

beforeEach(() => {
  supabaseJs.createClient.mockClear()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_SUPABASE)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", CLE_ANON)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("creerClientParJeton", () => {
  it("crée un client clé anon avec l'en-tête Authorization du jeton (RG-71)", () => {
    creerClientParJeton("jwt-abc")

    expect(supabaseJs.createClient).toHaveBeenCalledTimes(1)
    const [url, cle, options] = supabaseJs.createClient.mock.calls[0] as unknown as [
      string,
      string,
      {
        global: { headers: Record<string, string> }
        auth: Record<string, boolean>
      },
    ]
    expect(url).toBe(URL_SUPABASE)
    expect(cle).toBe(CLE_ANON)
    expect(options.global.headers.Authorization).toBe("Bearer jwt-abc")
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    })
  })

  it("n'utilise jamais la clé service_role", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret-sr")

    creerClientParJeton("jwt-abc")

    expect(JSON.stringify(supabaseJs.createClient.mock.calls)).not.toContain("secret-sr")
  })

  it("refuse un jeton vide", () => {
    expect(() => creerClientParJeton("")).toThrow("Jeton d'accès manquant.")
    expect(() => creerClientParJeton("   ")).toThrow("Jeton d'accès manquant.")
    expect(supabaseJs.createClient).not.toHaveBeenCalled()
  })

  it("refuse une configuration incomplète", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

    expect(() => creerClientParJeton("jwt-abc")).toThrow(
      "Configuration Supabase incomplète (URL ou clé anon manquante)."
    )
  })
})
