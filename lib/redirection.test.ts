import { describe, expect, it } from "vitest"
import { cheminDeRetour } from "@/lib/redirection"

describe("cheminDeRetour (#305, anti open-redirect)", () => {
  it("accepte /oauth/consent?authorization_id=abc", () => {
    expect(cheminDeRetour("/oauth/consent?authorization_id=abc")).toBe("/oauth/consent?authorization_id=abc")
  })

  it("refuse //evil.com, https://evil.com, /\evil.com, javascript:alert(1), null, chaîne vide → /planning", () => {
    for (const brut of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", null, ""]) {
      expect(cheminDeRetour(brut)).toBe("/planning")
    }
  })
})
