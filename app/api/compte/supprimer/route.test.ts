// @vitest-environment node
//
// POST /api/compte/supprimer : garde de fraîcheur de session (RG-93) et ordre
// strict RPC puis deleteUser (US-31, RG-70).

import { beforeEach, describe, expect, it, vi } from "vitest"

const serveur = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: serveur.getUser, getClaims: serveur.getClaims },
    rpc: serveur.rpc,
  }),
}))

const admin = vi.hoisted(() => ({ deleteUser: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { deleteUser: admin.deleteUser } } }),
}))

import { POST } from "@/app/api/compte/supprimer/route"

const MAINTENANT_S = 1_800_000_000

function claimsAvecAmr(amr: unknown) {
  return { data: { claims: { amr } }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(Date, "now").mockReturnValue(MAINTENANT_S * 1000)
  serveur.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
  serveur.rpc.mockResolvedValue({ error: null })
  admin.deleteUser.mockResolvedValue({ error: null })
})

describe("POST /api/compte/supprimer", () => {
  it("403 si l’authentification est ancienne, sans RPC ni deleteUser", async () => {
    serveur.getClaims.mockResolvedValue(
      claimsAvecAmr([{ method: "password", timestamp: MAINTENANT_S - 301 }])
    )
    const r = await POST()
    expect(r.status).toBe(403)
    expect((await r.json()).error).toContain("confirme d’abord ton identité")
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("403 si amr est absent", async () => {
    serveur.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })
    const r = await POST()
    expect(r.status).toBe(403)
    expect(serveur.rpc).not.toHaveBeenCalled()
  })

  it("500 si getClaims renvoie une erreur, sans RPC ni deleteUser", async () => {
    const erreur = new Error("JWKS injoignable")
    serveur.getClaims.mockResolvedValue({ data: null, error: erreur })
    const r = await POST()
    expect(r.status).toBe(500)
    expect((await r.json()).error).toContain("Vérification de ta session impossible")
    expect(console.error).toHaveBeenCalledWith(
      "[POST /api/compte/supprimer]",
      erreur
    )
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("500 si getClaims lève une exception, sans RPC ni deleteUser", async () => {
    const exception = new DOMException("verify", "OperationError")
    serveur.getClaims.mockRejectedValue(exception)
    const r = await POST()
    expect(r.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith(
      "[POST /api/compte/supprimer]",
      exception
    )
    expect(serveur.rpc).not.toHaveBeenCalled()
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("403 si la RPC renvoie OMQ06, sans deleteUser", async () => {
    serveur.getClaims.mockResolvedValue(
      claimsAvecAmr([{ method: "password", timestamp: MAINTENANT_S - 10 }])
    )
    serveur.rpc.mockResolvedValue({
      error: { code: "OMQ06", message: "Authentification trop ancienne" },
    })
    const r = await POST()
    expect(r.status).toBe(403)
    expect((await r.json()).error).toContain("confirme d’abord ton identité")
    expect(serveur.rpc).toHaveBeenCalledWith("supprimer_mon_compte")
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("500 si la RPC échoue pour une autre raison, sans deleteUser", async () => {
    serveur.getClaims.mockResolvedValue(
      claimsAvecAmr([{ method: "password", timestamp: MAINTENANT_S - 10 }])
    )
    serveur.rpc.mockResolvedValue({ error: { code: "23503", message: "fk" } })
    const r = await POST()
    expect(r.status).toBe(500)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it("session fraîche : RPC puis deleteUser, dans cet ordre", async () => {
    serveur.getClaims.mockResolvedValue(
      claimsAvecAmr([{ method: "password", timestamp: MAINTENANT_S - 10 }])
    )
    const r = await POST()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(serveur.rpc).toHaveBeenCalledWith("supprimer_mon_compte")
    expect(admin.deleteUser).toHaveBeenCalledWith("u1")
    expect(serveur.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      admin.deleteUser.mock.invocationCallOrder[0]
    )
  })
})
