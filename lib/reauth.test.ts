import { describe, it, expect } from "vitest"
import { authentificationRecente, aMotDePasse, methodeReauth } from "./reauth"

const t = 1_800_000_000

describe("authentificationRecente (RG-93)", () => {
  it("accepte une authentification à exactement 300 s", () => {
    expect(authentificationRecente([{ method: "password", timestamp: t - 300 }], t)).toBe(true)
  })
  it("refuse au-delà de 300 s", () => {
    expect(authentificationRecente([{ method: "password", timestamp: t - 301 }], t)).toBe(false)
  })
  it("retient le timestamp le plus récent", () => {
    expect(
      authentificationRecente(
        [{ method: "oauth", timestamp: t - 900 }, { method: "password", timestamp: t - 10 }],
        t
      )
    ).toBe(true)
  })
  it("refuse tableau vide, non-tableau, timestamp non numérique", () => {
    expect(authentificationRecente([], t)).toBe(false)
    expect(authentificationRecente(undefined, t)).toBe(false)
    expect(authentificationRecente(null, t)).toBe(false)
    expect(authentificationRecente("password", t)).toBe(false)
    expect(authentificationRecente([{ method: "password", timestamp: "x" }], t)).toBe(false)
    expect(authentificationRecente([{ method: "password", timestamp: NaN }], t)).toBe(false)
  })
  it("refuse la forme string[] (sans horodatage)", () => {
    expect(authentificationRecente(["password"], t)).toBe(false)
  })
})

describe("aMotDePasse / methodeReauth", () => {
  it("détecte l’identité email", () => {
    expect(aMotDePasse([{ provider: "email" }])).toBe(true)
    expect(aMotDePasse([{ provider: "google" }])).toBe(false)
    expect(aMotDePasse(null)).toBe(false)
    expect(aMotDePasse(undefined)).toBe(false)
  })
  it("choisit la méthode de réauthentification", () => {
    expect(methodeReauth([{ provider: "google" }])).toBe("google")
    expect(methodeReauth([{ provider: "email" }, { provider: "google" }])).toBe("mot-de-passe")
    expect(methodeReauth(undefined)).toBe("google")
  })
})
