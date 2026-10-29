// Proxy Next 16 (#305) : routes servies sans session à cookies.
import { describe, expect, it } from "vitest"
import { sansSession } from "./proxy"

describe("sansSession (#305)", () => {
  it("sansSession : /api/mcp et /.well-known/* vrais ; /api/planning/generer, /oauth/consent faux", () => {
    expect(sansSession("/api/mcp")).toBe(true)
    expect(sansSession("/.well-known/oauth-protected-resource/api/mcp")).toBe(true)
    expect(sansSession("/api/planning/generer")).toBe(false)
    expect(sansSession("/oauth/consent")).toBe(false)
    expect(sansSession("/api/mcpx")).toBe(false)
  })
})
