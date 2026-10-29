// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const { getClaims, creerClientParJeton } = vi.hoisted(() => {
  const getClaims = vi.fn()
  return { getClaims, creerClientParJeton: vi.fn(() => ({ auth: { getClaims } })) }
})
vi.mock("@/lib/supabase/par-jeton", () => ({ creerClientParJeton }))

import { emetteurOAuth, verifierJetonMcp } from "./auth"

const REQ = new Request("https://omq.test/api/mcp", { method: "POST" })

function claims(surcharge: Record<string, unknown> = {}) {
  return {
    data: {
      claims: {
        sub: "user-1",
        role: "authenticated",
        client_id: "client-1",
        exp: 2_000_000_000,
        scope: "openid email",
        ...surcharge,
      },
    },
    error: null,
  }
}

beforeEach(() => {
  getClaims.mockReset()
  creerClientParJeton.mockClear()
})

describe("emetteurOAuth", () => {
  it("dérive l'émetteur de NEXT_PUBLIC_SUPABASE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co")
    expect(emetteurOAuth()).toBe("https://ref.supabase.co/auth/v1")
    vi.unstubAllEnvs()
  })
})

describe("verifierJetonMcp (RG-71)", () => {
  it("accepte un jeton OAuth authenticated et expose userId, clientId, expiresAt", async () => {
    getClaims.mockResolvedValue(claims())
    const info = await verifierJetonMcp(REQ, "jwt-oauth")
    expect(creerClientParJeton).toHaveBeenCalledWith("jwt-oauth")
    expect(getClaims).toHaveBeenCalledWith("jwt-oauth")
    expect(info).toEqual({
      token: "jwt-oauth",
      clientId: "client-1",
      scopes: ["openid", "email"],
      expiresAt: 2_000_000_000,
      extra: { userId: "user-1" },
    })
  })

  it("refuse l'absence de jeton sans créer de client", async () => {
    expect(await verifierJetonMcp(REQ, undefined)).toBeUndefined()
    expect(creerClientParJeton).not.toHaveBeenCalled()
  })

  it("refuse un JWT de session web sans client_id (RG-71)", async () => {
    getClaims.mockResolvedValue(claims({ client_id: undefined }))
    expect(await verifierJetonMcp(REQ, "jwt-web")).toBeUndefined()
  })

  it("refuse un jeton anon (role anon)", async () => {
    getClaims.mockResolvedValue(claims({ role: "anon" }))
    expect(await verifierJetonMcp(REQ, "jwt-anon")).toBeUndefined()
  })

  it("refuse un jeton sans sub", async () => {
    getClaims.mockResolvedValue(claims({ sub: undefined }))
    expect(await verifierJetonMcp(REQ, "jwt")).toBeUndefined()
  })

  it("refuse un jeton dont getClaims renvoie une erreur (signature, expiration)", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") })
    expect(await verifierJetonMcp(REQ, "jwt-faux")).toBeUndefined()
  })

  it("ne lève jamais : une exception de getClaims donne undefined", async () => {
    const espion = vi.spyOn(console, "error").mockImplementation(() => {})
    getClaims.mockRejectedValue(new Error("JWKS injoignable"))
    expect(await verifierJetonMcp(REQ, "jwt")).toBeUndefined()
    expect(espion).toHaveBeenCalled()
    espion.mockRestore()
  })
})
