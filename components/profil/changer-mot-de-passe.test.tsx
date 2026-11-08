// ChangerMotDePasse (US-22, US-57, D11) : un compte Google sans mot de passe
// n'a pas de « mot de passe actuel » à saisir. Client Supabase simulé.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ChangerMotDePasse } from "./changer-mot-de-passe"

function utilisateur(provider: "google" | "email") {
  auth.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "a@example.com", identities: [{ provider }] } },
    error: null,
  })
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => cleanup())

describe("ChangerMotDePasse (D11)", () => {
  it("compte Google seul : « Connecté avec Google », pas de formulaire", async () => {
    utilisateur("google")
    render(<ChangerMotDePasse />)
    expect(await screen.findByText("Connecté avec Google")).toBeTruthy()
    expect(screen.queryByLabelText("Mot de passe actuel")).toBeNull()
    expect(screen.queryByRole("button", { name: "Changer le mot de passe" })).toBeNull()
  })

  it("compte avec mot de passe : formulaire inchangé", async () => {
    utilisateur("email")
    render(<ChangerMotDePasse />)
    expect(await screen.findByLabelText("Mot de passe actuel")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Changer le mot de passe" })).toBeTruthy()
    expect(screen.queryByText("Connecté avec Google")).toBeNull()
  })

  it("identités mixtes email + Google : formulaire mot de passe", async () => {
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          email: "a@example.com",
          identities: [{ provider: "email" }, { provider: "google" }],
        },
      },
      error: null,
    })
    render(<ChangerMotDePasse />)
    await waitFor(() => expect(auth.getUser).toHaveBeenCalled())
    expect(await screen.findByLabelText("Mot de passe actuel")).toBeTruthy()
    expect(screen.queryByText("Connecté avec Google")).toBeNull()
  })

  it("échec de lecture de l’utilisateur : erreur loggée, formulaire conservé", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    auth.getUser.mockRejectedValue(new Error("réseau"))
    render(<ChangerMotDePasse />)
    await waitFor(() => expect(log).toHaveBeenCalled())
    expect(screen.getByLabelText("Mot de passe actuel")).toBeTruthy()
    log.mockRestore()
  })

  it("getUser renvoie une erreur : loggée, formulaire conservé", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("JWT expiré") })
    render(<ChangerMotDePasse />)
    await waitFor(() => expect(log).toHaveBeenCalled())
    expect(screen.getByLabelText("Mot de passe actuel")).toBeTruthy()
    log.mockRestore()
  })
})
