// SupprimerCompte (US-31, US-57, RG-93, D10) : parcours mot de passe inchangé,
// ré-authentification Google pour un compte sans mot de passe. Client Supabase simulé.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}))
const chargerFoyer = vi.hoisted(() => vi.fn())
const reinitialiserCacheFoyer = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }))
vi.mock("@/lib/foyer", () => ({ chargerFoyer }))
vi.mock("@/lib/sync", () => ({ reinitialiserCacheFoyer }))

import { SupprimerCompte } from "./supprimer-compte"

const CLE = "reauth_suppression_uid"
const ASSIGN = vi.fn()

function stubUrl(search: string) {
  vi.stubGlobal("location", {
    ...window.location,
    origin: "http://localhost:3000",
    pathname: "/profil",
    search,
    assign: ASSIGN,
  })
}

function utilisateur(provider: "google" | "email", id = "u1", email = "a@example.com") {
  auth.getUser.mockResolvedValue({
    data: { user: { id, email, identities: [{ provider }] } },
    error: null,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  chargerFoyer.mockResolvedValue({ membres: 1 })
  auth.signInWithPassword.mockResolvedValue({ error: null })
  auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null })
  auth.signOut.mockResolvedValue({ error: null })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  stubUrl("")
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SupprimerCompte, compte avec mot de passe (inchangé)", () => {
  it("affiche le champ mot de passe, pas de bouton Google, et supprime après ré-auth", async () => {
    utilisateur("email")
    render(<SupprimerCompte />)
    const mdp = await screen.findByLabelText("Mot de passe")
    expect(screen.queryByRole("button", { name: "Confirmer avec Google" })).toBeNull()

    fireEvent.change(mdp, { target: { value: "secret-1234" } })
    fireEvent.change(screen.getByLabelText("Tape SUPPRIMER pour confirmer"), {
      target: { value: "SUPPRIMER" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte" }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/compte/supprimer", { method: "POST" })
    )
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "secret-1234",
    })
    await waitFor(() => expect(ASSIGN).toHaveBeenCalledWith("/compte-supprime"))
  })

  it("affiche le message du serveur quand la suppression est refusée (403 fraîcheur)", async () => {
    utilisateur("email")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ error: "Confirme d’abord ton identité." }) })
    )
    render(<SupprimerCompte />)
    fireEvent.change(await screen.findByLabelText("Mot de passe"), { target: { value: "x" } })
    fireEvent.change(screen.getByLabelText("Tape SUPPRIMER pour confirmer"), {
      target: { value: "SUPPRIMER" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte" }))
    expect(await screen.findByText("Confirme d’abord ton identité.")).toBeTruthy()
  })
})

describe("SupprimerCompte, compte Google sans mot de passe (D10)", () => {
  it("sans paramètre : bouton « Confirmer avec Google », ni champ mot de passe ni champ SUPPRIMER", async () => {
    utilisateur("google")
    render(<SupprimerCompte />)
    expect(await screen.findByRole("button", { name: "Confirmer avec Google" })).toBeTruthy()
    expect(screen.queryByLabelText("Mot de passe")).toBeNull()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
  })

  it("clic : mémorise uid + email puis relance OAuth avec select_account et login_hint", async () => {
    utilisateur("google", "u1", "a@example.com")
    render(<SupprimerCompte />)
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer avec Google" }))

    await waitFor(() =>
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo:
            "http://localhost:3000/auth/callback?suivant=%2Fprofil%3Fsuppression%3Dconfirmer",
          queryParams: { prompt: "select_account", login_hint: "a@example.com" },
        },
      })
    )
    const stocke = JSON.parse(sessionStorage.getItem(CLE) ?? "null")
    expect(stocke.uid).toBe("u1")
    expect(stocke.email).toBe("a@example.com")
  })

  it("échec du démarrage OAuth : erreur affichée et mémo effacé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    utilisateur("google")
    auth.signInWithOAuth.mockResolvedValue({ data: null, error: new Error("oauth KO") })
    render(<SupprimerCompte />)
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer avec Google" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(sessionStorage.getItem(CLE)).toBeNull()
  })

  it("retour même uid : champ SUPPRIMER sans mot de passe, paramètre retiré, suppression sans signInWithPassword", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    const remplacer = vi.spyOn(window.history, "replaceState")
    utilisateur("google", "u1")
    render(<SupprimerCompte />)

    const champ = await screen.findByLabelText("Tape SUPPRIMER pour confirmer")
    expect(screen.queryByLabelText("Mot de passe")).toBeNull()
    expect(screen.queryByRole("button", { name: "Confirmer avec Google" })).toBeNull()
    expect(remplacer).toHaveBeenCalled()
    expect(String(remplacer.mock.calls[0][2])).not.toContain("suppression=")
    expect(sessionStorage.getItem(CLE)).toBeNull()

    fireEvent.change(champ, { target: { value: "SUPPRIMER" } })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/compte/supprimer", { method: "POST" })
    )
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    await waitFor(() => expect(reinitialiserCacheFoyer).toHaveBeenCalled())
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" })
    await waitFor(() => expect(ASSIGN).toHaveBeenCalledWith("/compte-supprime"))
  })

  it("403 (confirmation périmée) : message du serveur et retour au bouton Google", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    utilisateur("google", "u1")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "Pour supprimer ton compte, confirme d’abord ton identité." }),
      })
    )
    render(<SupprimerCompte />)
    fireEvent.change(await screen.findByLabelText("Tape SUPPRIMER pour confirmer"), {
      target: { value: "SUPPRIMER" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte" }))
    expect(
      await screen.findByText("Pour supprimer ton compte, confirme d’abord ton identité.")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Confirmer avec Google" })).toBeTruthy()
  })

  it("retour avec un autre uid : message mauvais compte, signOut local, aucune suppression", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    utilisateur("google", "u2", "autre@example.com")
    render(<SupprimerCompte />)

    expect(
      await screen.findByText(
        "Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec a@example.com pour supprimer ton compte."
      )
    ).toBeTruthy()
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" }))
    expect(reinitialiserCacheFoyer).toHaveBeenCalled()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(CLE)).toBeNull()
  })

  it("retour sans mémo (onglet fermé) : repli sur le bouton Google, pas de champ SUPPRIMER", async () => {
    stubUrl("?suppression=confirmer")
    utilisateur("google", "u1")
    render(<SupprimerCompte />)
    expect(await screen.findByRole("button", { name: "Confirmer avec Google" })).toBeTruthy()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
