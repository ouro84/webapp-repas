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

describe("SupprimerCompte, identités mixtes email + Google", () => {
  function identitesMixtes() {
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
  }

  it("voie mot de passe, pas de bouton Google", async () => {
    identitesMixtes()
    render(<SupprimerCompte />)
    expect(await screen.findByLabelText("Mot de passe")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Confirmer avec Google" })).toBeNull()
  })

  it("un retour Google avec mémo valide ne dispense pas du mot de passe", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    identitesMixtes()
    render(<SupprimerCompte />)
    await screen.findByLabelText("Mot de passe")
    fireEvent.change(screen.getByLabelText("Tape SUPPRIMER pour confirmer"), {
      target: { value: "SUPPRIMER" },
    })
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "secret-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer mon compte" }))
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalled())
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

  it("retour arrière depuis Google (bfcache, pageshow persisted) : le bouton se réarme", async () => {
    utilisateur("google")
    render(<SupprimerCompte />)
    const bouton = await screen.findByRole("button", { name: "Confirmer avec Google" })
    fireEvent.click(bouton)
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalled())
    expect((bouton as HTMLButtonElement).disabled).toBe(true)

    // Un pageshow non restauré du bfcache ne réarme pas.
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }))
    expect((bouton as HTMLButtonElement).disabled).toBe(true)

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))
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

  it("retour annulé chez Google (erreur_oauth=annule) : message, mémo consommé, paramètres retirés, pas de champ SUPPRIMER", async () => {
    stubUrl("?suppression=confirmer&erreur_oauth=annule")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    const remplacer = vi.spyOn(window.history, "replaceState")
    utilisateur("google", "u1")
    render(<SupprimerCompte />)

    expect(
      await screen.findByText("Confirmation avec Google annulée. Tu peux réessayer.")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Confirmer avec Google" })).toBeTruthy()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
    expect(sessionStorage.getItem(CLE)).toBeNull()
    expect(remplacer).toHaveBeenCalled()
    const urlNettoyee = String(remplacer.mock.calls[0][2])
    expect(urlNettoyee).not.toContain("suppression=")
    expect(urlNettoyee).not.toContain("erreur_oauth=")
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it("retour en échec (erreur_oauth=echec, sans suppression=confirmer) : message d’échec, pas de champ SUPPRIMER", async () => {
    stubUrl("?erreur_oauth=echec")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    utilisateur("google", "u1")
    render(<SupprimerCompte />)

    expect(await screen.findByText(/La connexion avec Google a échoué/)).toBeTruthy()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
    expect(sessionStorage.getItem(CLE)).toBeNull()
  })

  it("autre compte : lien « Se reconnecter » vers /login", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    utilisateur("google", "u2", "autre@example.com")
    render(<SupprimerCompte />)
    const lien = await screen.findByRole("link", { name: "Se reconnecter" })
    expect(lien.getAttribute("href")).toBe("/login")
  })

  it("autre compte, email d’origine vide : message de repli", async () => {
    stubUrl("?suppression=confirmer")
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "" }))
    utilisateur("google", "u2", "autre@example.com")
    render(<SupprimerCompte />)
    expect(
      await screen.findByText(
        "Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec ton compte Google d’origine pour supprimer ton compte."
      )
    ).toBeTruthy()
  })

  it("sans paramètre de retour : le mémo n’est pas consommé", async () => {
    sessionStorage.setItem(CLE, JSON.stringify({ uid: "u1", email: "a@example.com" }))
    utilisateur("google", "u1")
    render(<SupprimerCompte />)
    await screen.findByRole("button", { name: "Confirmer avec Google" })
    expect(sessionStorage.getItem(CLE)).not.toBeNull()
    expect(screen.queryByLabelText("Tape SUPPRIMER pour confirmer")).toBeNull()
  })

  it("getUser renvoie une erreur : loggée, suppression=confirmer retiré quand même, repli mot de passe", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    stubUrl("?suppression=confirmer")
    const remplacer = vi.spyOn(window.history, "replaceState")
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("JWT expiré") })
    render(<SupprimerCompte />)
    await waitFor(() => expect(log).toHaveBeenCalled())
    expect(remplacer).toHaveBeenCalled()
    expect(String(remplacer.mock.calls[0][2])).not.toContain("suppression=")
    expect(screen.getByLabelText("Mot de passe")).toBeTruthy()
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
