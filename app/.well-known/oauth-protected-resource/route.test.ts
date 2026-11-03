// @vitest-environment node
// Metadata RFC 9728 du serveur MCP (#305, ADR-11) : `resource` = l'URL de
// /api/mcp et `authorization_servers` = l'émetteur Supabase Auth.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mcp/auth", () => ({ emetteurOAuth: () => "https://ref.supabase.co/auth/v1" }))

import { GET, OPTIONS } from "./[[...ressource]]/route"

describe("/.well-known/oauth-protected-resource (RFC 9728)", () => {
  it("les deux chemins renvoient resource = <origine>/api/mcp et authorization_servers = [<SUPABASE_URL>/auth/v1]", async () => {
    for (const chemin of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const reponse = await GET(new Request(`https://omq.test${chemin}`))
      expect(reponse.status).toBe(200)
      const corps = await reponse.json()
      expect(corps.resource).toBe("https://omq.test/api/mcp")
      expect(corps.authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"])
    }
  })

  it("le chemin suffixé de l’endpoint exécuteur renvoie resource = <origine>/api/mcp/executeur (#330)", async () => {
    const reponse = await GET(new Request("https://omq.test/.well-known/oauth-protected-resource/api/mcp/executeur"))
    expect(reponse.status).toBe(200)
    const corps = await reponse.json()
    expect(corps.resource).toBe("https://omq.test/api/mcp/executeur")
    expect(corps.resource.endsWith("/api/mcp/executeur")).toBe(true)
    expect(corps.authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"])
  })

  it("tout autre suffixe garde resource = <origine>/api/mcp (#330)", async () => {
    for (const chemin of ["/.well-known/oauth-protected-resource/api/mcp/autre", "/.well-known/oauth-protected-resource/n-importe-quoi", "/.well-known/oauth-protected-resource/constructor", "/.well-known/oauth-protected-resource/__proto__", "/.well-known/oauth-protected-resource/toString"]) {
      const corps = await (await GET(new Request(`https://omq.test${chemin}`))).json()
      expect(corps.resource).toBe("https://omq.test/api/mcp")
    }
  })

  it("avec le contexte Next (params catch-all), le suffixe vient de params, pas de l’URL (#330)", async () => {
    const req = new Request("https://omq.test/.well-known/oauth-protected-resource")
    const exec = await GET(req, { params: Promise.resolve({ ressource: ["api", "mcp", "executeur"] }) })
    expect((await exec.json()).resource).toBe("https://omq.test/api/mcp/executeur")
    const herite = await GET(req, { params: Promise.resolve({ ressource: ["constructor"] }) })
    expect((await herite.json()).resource).toBe("https://omq.test/api/mcp")
    const sans = await GET(req, { params: Promise.resolve({}) })
    expect((await sans.json()).resource).toBe("https://omq.test/api/mcp")
  })

  it("OPTIONS renvoie les en-têtes CORS", () => {
    const reponse = OPTIONS()
    expect(reponse.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})
