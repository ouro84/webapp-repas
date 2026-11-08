// ConnexionGoogle (US-57) : bouton « Continuer avec Google », erreur de retour
// OAuth, indice PWA iOS, mention CGU. Client Supabase simulé.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const signInWithOAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth } }) }))
// next/font/google est substitué par l'alias de vitest.config.ts.

import { ConnexionGoogle } from "./connexion-google"

function stubUrl(search: string) {
  vi.stubGlobal("location", { ...window.location, origin: "http://localhost:3000", search })
}

beforeEach(() => {
  vi.resetAllMocks()
  signInWithOAuth.mockResolvedValue({ data: {}, error: null })
  stubUrl("")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ConnexionGoogle (US-57)", () => {
  it("clic : signInWithOAuth avec le redirectTo du callback", async () => {
    render(<ConnexionGoogle />)
    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))
    await waitFor(() =>
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: "http://localhost:3000/auth/callback" },
      })
    )
  })

  it("propage ?suivant= dans le redirectTo", async () => {
    stubUrl("?suivant=/oauth/consent")
    render(<ConnexionGoogle />)
    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1))
    const { options } = signInWithOAuth.mock.calls[0][0]
    expect(options.redirectTo).toBe(
      "http://localhost:3000/auth/callback?suivant=%2Foauth%2Fconsent"
    )
  })

  it("pendant l’appel : bouton désactivé et aria-busy", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}))
    render(<ConnexionGoogle />)
    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))
    const bouton = await screen.findByRole("button", { name: /Google/ })
    expect((bouton as HTMLButtonElement).disabled).toBe(true)
    expect(bouton.getAttribute("aria-busy")).toBe("true")
  })

  it("erreur renvoyée par Supabase : message d’échec affiché et loggé", async () => {
    signInWithOAuth.mockResolvedValue({ data: null, error: new Error("boom") })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<ConnexionGoogle />)
    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))
    const alerte = await screen.findByRole("alert")
    expect(alerte.textContent).toContain("La connexion avec Google a échoué")
    expect(log).toHaveBeenCalled()
    // Le bouton redevient utilisable pour réessayer.
    const bouton = screen.getByRole("button", { name: "Continuer avec Google" })
    expect((bouton as HTMLButtonElement).disabled).toBe(false)
  })

  it("échec du démarrage : le focus revient sur le bouton", async () => {
    let terminer: (valeur: unknown) => void = () => {}
    signInWithOAuth.mockReturnValue(new Promise((resolve) => (terminer = resolve)))
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<ConnexionGoogle />)
    const bouton = screen.getByRole("button", { name: "Continuer avec Google" })
    bouton.focus()
    fireEvent.click(bouton)
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(true))
    // Un navigateur retire le focus d'un bouton désactivé (jsdom ne le fait pas).
    bouton.blur()
    terminer({ data: null, error: new Error("boom") })
    await screen.findByRole("alert")
    await waitFor(() => expect(document.activeElement).toBe(bouton))
  })

  it("clic : retire erreur_oauth de l’URL, l’ancien message disparaît", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}))
    stubUrl("?erreur_oauth=annule&suivant=%2Foauth%2Fconsent")
    const remplacer = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((_etat, _titre, url) => {
        stubUrl(new URL(String(url), "http://localhost:3000").search)
      })
    render(<ConnexionGoogle />)
    expect(screen.getByRole("alert").textContent).toContain("Connexion avec Google annulée")

    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    const urlNettoyee = String(remplacer.mock.calls[0][2])
    expect(urlNettoyee).not.toContain("erreur_oauth")
    expect(urlNettoyee).toContain("suivant=")
    // suivant est conservé pour le redirectTo.
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1))
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      "http://localhost:3000/auth/callback?suivant=%2Foauth%2Fconsent"
    )
  })

  it("retour arrière depuis Google (bfcache, pageshow persisted) : le bouton se réarme", async () => {
    render(<ConnexionGoogle />)
    const bouton = screen.getByRole("button", { name: "Continuer avec Google" })
    fireEvent.click(bouton)
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    expect((bouton as HTMLButtonElement).disabled).toBe(true)

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }))
    expect((bouton as HTMLButtonElement).disabled).toBe(true)

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))
  })

  it("?erreur_oauth=annule : message d’annulation affiché", () => {
    stubUrl("?erreur_oauth=annule")
    render(<ConnexionGoogle />)
    expect(screen.getByRole("alert").textContent).toContain("Connexion avec Google annulée")
  })

  it("clé d’erreur inconnue : aucune alerte", () => {
    stubUrl("?erreur_oauth=n-importe-quoi")
    render(<ConnexionGoogle />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("PWA iOS (navigator.standalone) : pas de bouton, indice Safari", () => {
    vi.stubGlobal("navigator", { ...window.navigator, standalone: true })
    render(<ConnexionGoogle />)
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull()
    expect(screen.getByText("Pour te connecter avec Google, ouvre OMQ dans Safari")).toBeTruthy()
  })

  it("mention CGU avec les deux liens légaux", () => {
    render(<ConnexionGoogle />)
    expect(screen.getByText(/En continuant, tu acceptes les/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "CGU" }).getAttribute("href")).toBe("/legal/cgu")
    expect(
      screen.getByRole("link", { name: "politique de confidentialité" }).getAttribute("href")
    ).toBe("/legal/confidentialite")
  })
})
