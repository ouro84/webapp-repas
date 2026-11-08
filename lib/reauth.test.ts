import { describe, it, expect } from "vitest"
import {
  authentificationRecente,
  aMotDePasse,
  compteDifferent,
  lireMemoReauth,
  messageMauvaisCompte,
  methodeReauth,
} from "./reauth"

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
  it("tableau mixte chaîne + objet : seul l’objet horodaté compte", () => {
    expect(authentificationRecente(["password", { method: "oauth", timestamp: t }], t)).toBe(true)
    expect(authentificationRecente(["password", { method: "oauth", timestamp: t - 301 }], t)).toBe(
      false
    )
  })
  it("timestamp futur (horloges décalées) : accepté", () => {
    // Choix documenté : le JWT est signé par Supabase, un léger décalage
    // d’horloge ne doit pas bloquer une suppression légitime.
    expect(authentificationRecente([{ method: "password", timestamp: t + 60 }], t)).toBe(true)
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

describe("mémo de ré-authentification Google (D10)", () => {
  it("lireMemoReauth : JSON { uid, email } lu, email absent ramené à \"\"", () => {
    expect(lireMemoReauth(JSON.stringify({ uid: "u1", email: "a@example.com" }))).toEqual({
      uid: "u1",
      email: "a@example.com",
    })
    expect(lireMemoReauth(JSON.stringify({ uid: "u1" }))).toEqual({ uid: "u1", email: "" })
    expect(lireMemoReauth(JSON.stringify({ uid: "u1", email: 42 }))).toEqual({ uid: "u1", email: "" })
  })
  it("lireMemoReauth : absent, illisible ou sans uid chaîne → null", () => {
    expect(lireMemoReauth(null)).toBeNull()
    expect(lireMemoReauth("pas du json")).toBeNull()
    expect(lireMemoReauth("null")).toBeNull()
    expect(lireMemoReauth("42")).toBeNull()
    expect(lireMemoReauth(JSON.stringify({ email: "a@example.com" }))).toBeNull()
    expect(lireMemoReauth(JSON.stringify({ uid: 7 }))).toBeNull()
  })
  it("compteDifferent : vrai seulement si l’uid diffère", () => {
    expect(compteDifferent({ uid: "u1", email: "" }, "u1")).toBe(false)
    expect(compteDifferent({ uid: "u1", email: "" }, "u2")).toBe(true)
  })
  it("messageMauvaisCompte : email d’origine, ou repli sans email", () => {
    expect(messageMauvaisCompte("a@example.com")).toBe(
      "Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec a@example.com pour supprimer ton compte."
    )
    expect(messageMauvaisCompte("")).toBe(
      "Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec ton compte Google d’origine pour supprimer ton compte."
    )
  })
})
