import { describe, expect, it } from "vitest"
import {
  CHEMIN_CALLBACK,
  erreurOAuthDepuisCallback,
  estPwaIos,
  messageErreurOAuth,
  prenomDepuisMetadonnees,
  urlRetourOAuth,
} from "@/lib/auth-google"

describe("urlRetourOAuth (US-57, RG-93)", () => {
  it("expose le chemin du callback", () => {
    expect(CHEMIN_CALLBACK).toBe("/auth/callback")
  })

  it("sans suivant : URL nue", () => {
    expect(urlRetourOAuth("https://omq.test", null)).toBe("https://omq.test/auth/callback")
  })

  it("transmet un chemin relatif valide, encodé", () => {
    const url = urlRetourOAuth("https://omq.test", "/oauth/consent?authorization_id=a%20b")
    expect(url).toBe(
      "https://omq.test/auth/callback?suivant=%2Foauth%2Fconsent%3Fauthorization_id%3Da%2520b"
    )
    expect(new URL(url).searchParams.get("suivant")).toBe("/oauth/consent?authorization_id=a%20b")
  })

  it("aller-retour d'un chemin simple avec paramètres", () => {
    const url = urlRetourOAuth("https://omq.test", "/planning?cycle=2026-11-14")
    expect(new URL(url).searchParams.get("suivant")).toBe("/planning?cycle=2026-11-14")
  })

  it("ne transmet pas un chemin rejeté (anti open-redirect)", () => {
    expect(urlRetourOAuth("https://omq.test", "//evil.com")).toBe("https://omq.test/auth/callback")
    expect(urlRetourOAuth("https://omq.test", "/\t/evil.com")).toBe("https://omq.test/auth/callback")
    expect(urlRetourOAuth("https://omq.test", "https://evil.com")).toBe("https://omq.test/auth/callback")
  })

  it("ne transmet pas un chemin que cheminDeRetour réécrirait", () => {
    // L'espace brut est normalisé en %20 : le chemin n'est pas stable, donc écarté.
    expect(urlRetourOAuth("https://omq.test", "/oauth/consent?authorization_id=a b")).toBe(
      "https://omq.test/auth/callback"
    )
  })
})

describe("erreurOAuthDepuisCallback", () => {
  it("access_denied : annulation", () => {
    expect(erreurOAuthDepuisCallback(new URLSearchParams("error=access_denied"))).toBe("annule")
  })

  it("autre erreur : échec, même avec un code", () => {
    expect(erreurOAuthDepuisCallback(new URLSearchParams("error=server_error&code=x"))).toBe("echec")
  })

  it("ni erreur ni code : échec", () => {
    expect(erreurOAuthDepuisCallback(new URLSearchParams(""))).toBe("echec")
  })

  it("code seul : pas d'erreur", () => {
    expect(erreurOAuthDepuisCallback(new URLSearchParams("code=abc"))).toBeNull()
  })
})

describe("messageErreurOAuth", () => {
  it("messages français actionnables", () => {
    expect(messageErreurOAuth("annule")).toBe(
      "Connexion avec Google annulée. Tu peux réessayer ou utiliser ton email."
    )
    expect(messageErreurOAuth("echec")).toBe(
      "La connexion avec Google a échoué. Réessaie dans un instant ou utilise ton email."
    )
  })

  it("clé inconnue ou absente : null", () => {
    expect(messageErreurOAuth("inconnu")).toBeNull()
    expect(messageErreurOAuth(null)).toBeNull()
  })
})

describe("prenomDepuisMetadonnees (RG-92)", () => {
  it("given_name prioritaire", () => {
    expect(prenomDepuisMetadonnees({ given_name: "Arnaud", full_name: "Jean Dupont" })).toBe("Arnaud")
  })

  it("given_name vide : premier mot de full_name", () => {
    expect(prenomDepuisMetadonnees({ given_name: "  ", full_name: " Marie Curie " })).toBe("Marie")
  })

  it("repli sur name", () => {
    expect(prenomDepuisMetadonnees({ name: "Léa" })).toBe("Léa")
  })

  it("trim du given_name", () => {
    expect(prenomDepuisMetadonnees({ given_name: "  Zoé " })).toBe("Zoé")
  })

  it("valeurs non textuelles ou absentes : chaîne vide", () => {
    expect(prenomDepuisMetadonnees({ given_name: 42 })).toBe("")
    expect(prenomDepuisMetadonnees(undefined)).toBe("")
    expect(prenomDepuisMetadonnees(null)).toBe("")
    expect(prenomDepuisMetadonnees({})).toBe("")
  })
})

describe("estPwaIos", () => {
  it("vrai seulement si standalone === true", () => {
    expect(estPwaIos({ standalone: true })).toBe(true)
    expect(estPwaIos({ standalone: "true" })).toBe(false)
    expect(estPwaIos({})).toBe(false)
  })
})
