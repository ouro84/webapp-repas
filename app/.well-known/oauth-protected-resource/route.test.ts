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

  it("OPTIONS renvoie les en-têtes CORS", () => {
    const reponse = OPTIONS()
    expect(reponse.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})
