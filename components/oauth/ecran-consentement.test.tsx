// Écran de consentement OAuth (#305, US-50, RG-72) : session requise (proxy),
// nom du client et droits affichés, approuver ou refuser, redirection vers le
// client OAuth avec l'URL renvoyée par Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const oauth = vi.hoisted(() => ({
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { oauth } }) }))

import { EcranConsentement } from "./ecran-consentement"

const assign = vi.fn()
const DETAILS = {
  authorization_id: "auth-1",
  redirect_uri: "http://127.0.0.1:27890/callback",
  client: { id: "c1", name: "Hermes", uri: "https://hermes.example.com/agent", logo_uri: "" },
  user: { id: "u1", email: "arnaud@example.com" },
  scope: "",
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("location", { ...window.location, assign })
  oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranConsentement (US-50, RG-72)", () => {
  it("affiche le nom du client, les droits et l'email", async () => {
    render(<EcranConsentement authorizationId="auth-1" />)
    expect(await screen.findByRole("heading", { name: /^Autoriser Hermes\s\?$/ })).toBeTruthy()
    expect(screen.getByText(/consulter ton planning, ta liste de courses et tes recettes/)).toBeTruthy()
    expect(screen.getByText(/générer ou modifier ton planning et ta liste de courses, et ajouter des recettes/)).toBeTruthy()
    expect(screen.getByText(/arnaud@example\.com/)).toBeTruthy()
    expect(screen.getByText(/^Hermes pourra, en ton nom et seulement pour ton foyer/)).toBeTruthy()
    // Hôte affiché = celui du redirect_uri enregistré (où part le code), jamais
    // client.uri, que le client choisit librement en DCR.
    expect(screen.getByText("127.0.0.1:27890")).toBeTruthy()
    expect(screen.queryByText(/hermes\.example\.com/)).toBeNull()
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith("auth-1")
  })

  it("Autoriser → approveAuthorization(id, { skipBrowserRedirect: true }) puis redirection vers redirect_url", async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: "http://127.0.0.1:27890/callback?code=x" }, error: null })
    render(<EcranConsentement authorizationId="auth-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Autoriser" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://127.0.0.1:27890/callback?code=x"))
    expect(oauth.approveAuthorization).toHaveBeenCalledWith("auth-1", { skipBrowserRedirect: true })
  })

  it("Refuser → denyAuthorization puis redirection", async () => {
    oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: "http://127.0.0.1:27890/callback?error=access_denied" }, error: null })
    render(<EcranConsentement authorizationId="auth-1" />)
    fireEvent.click(await screen.findByRole("button", { name: "Refuser" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://127.0.0.1:27890/callback?error=access_denied"))
    expect(oauth.denyAuthorization).toHaveBeenCalledWith("auth-1", { skipBrowserRedirect: true })
  })

  it("déjà autorisé → redirection immédiate", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: "http://127.0.0.1:27890/callback?code=y" }, error: null })
    render(<EcranConsentement authorizationId="auth-1" />)
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://127.0.0.1:27890/callback?code=y"))
    expect(screen.queryByRole("button", { name: "Autoriser" })).toBeNull()
  })

  it("authorization_id absent ou erreur → message d'erreur actionnable", async () => {
    const message = "Cette demande d’autorisation est invalide ou a expiré. Relance la connexion depuis ton assistant."
    render(<EcranConsentement authorizationId={null} />)
    expect(await screen.findByText(message)).toBeTruthy()
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
    cleanup()

    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: new Error("expired") })
    render(<EcranConsentement authorizationId="auth-1" />)
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it("échec d'approbation → erreur affichée, boutons réactivés", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.approveAuthorization.mockResolvedValue({ data: null, error: new Error("boom") })
    render(<EcranConsentement authorizationId="auth-1" />)
    const bouton = await screen.findByRole("button", { name: "Autoriser" })
    fireEvent.click(bouton)
    expect(await screen.findByText("L’autorisation n’a pas pu être enregistrée. Réessaie.")).toBeTruthy()
    expect((bouton as HTMLButtonElement).disabled).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })
})
