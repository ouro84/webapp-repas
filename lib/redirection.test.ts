import { describe, expect, it } from "vitest"
import { cheminDeRetour, estCheminOAuth } from "@/lib/redirection"

describe("cheminDeRetour (#305, anti open-redirect)", () => {
  it("accepte /oauth/consent?authorization_id=abc", () => {
    expect(cheminDeRetour("/oauth/consent?authorization_id=abc")).toBe("/oauth/consent?authorization_id=abc")
  })

  it("refuse //evil.com, https://evil.com, /\\evil.com, javascript:alert(1), null, chaîne vide → /planning", () => {
    for (const brut of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", null, ""]) {
      expect(cheminDeRetour(brut)).toBe("/planning")
    }
  })

  it("refuse les caractères de contrôle que l'analyseur d'URL supprime (/\\t/evil.com → //evil.com)", () => {
    for (const brut of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\t\t/evil.com"]) {
      expect(cheminDeRetour(brut)).toBe("/planning")
    }
  })

  it("garde chemin, requête et ancre d'un chemin relatif", () => {
    expect(cheminDeRetour("/oauth/consent?authorization_id=abc#x")).toBe("/oauth/consent?authorization_id=abc#x")
  })
})

describe("estCheminOAuth", () => {
  it("vrai pour /oauth et /oauth/…, faux pour /oauthxyz", () => {
    expect(estCheminOAuth("/oauth")).toBe(true)
    expect(estCheminOAuth("/oauth/consent")).toBe(true)
    expect(estCheminOAuth("/oauthxyz")).toBe(false)
    expect(estCheminOAuth("/planning")).toBe(false)
  })
})
