// « Assistants connectés » de /profil (#305, RG-72) : liste des autorisations
// OAuth accordées et révocation par client.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const oauth = vi.hoisted(() => ({ listGrants: vi.fn(), revokeGrant: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { oauth } }) }))
vi.mock("sonner", () => ({ toast }))

import { AssistantsConnectes } from "./assistants-connectes"

const GRANTS = [
  {
    client: { id: "c1", name: "Hermes", uri: "", logo_uri: "" },
    scopes: [],
    granted_at: "2026-10-29T15:00:00Z",
  },
  {
    client: { id: "c2", name: "Claude", uri: "", logo_uri: "" },
    scopes: [],
    granted_at: "2026-10-20T09:00:00Z",
  },
]

beforeAll(() => {
  // jsdom n'implémente pas <dialog>.showModal/close.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
    this.dispatchEvent(new Event("close"))
  }
})
beforeEach(() => {
  vi.resetAllMocks()
  oauth.listGrants.mockResolvedValue({ data: GRANTS, error: null })
})
afterEach(() => cleanup())

describe("AssistantsConnectes (RG-72)", () => {
  it("liste les grants (nom, date)", async () => {
    render(<AssistantsConnectes />)
    expect(await screen.findByText("Hermes")).toBeTruthy()
    expect(screen.getByText("Claude")).toBeTruthy()
    expect(screen.getByText("autorisé le 29 octobre 2026")).toBeTruthy()
  })

  it("état vide", async () => {
    oauth.listGrants.mockResolvedValue({ data: [], error: null })
    render(<AssistantsConnectes />)
    expect(await screen.findByText("Aucun assistant connecté.")).toBeTruthy()
  })

  it("état d'erreur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.listGrants.mockResolvedValue({ data: null, error: new Error("oauth désactivé") })
    render(<AssistantsConnectes />)
    expect(await screen.findByText("Impossible de charger les assistants connectés. Réessaie plus tard.")).toBeTruthy()
  })

  it("Déconnecter → confirmation → revokeGrant({ clientId }) et ligne retirée", async () => {
    oauth.revokeGrant.mockResolvedValue({ data: {}, error: null })
    render(<AssistantsConnectes />)
    const ligne = (await screen.findByText("Hermes")).closest("li")!
    fireEvent.click(within(ligne).getByRole("button", { name: "Déconnecter Hermes" }))
    expect(
      screen.getByText("Il ne pourra plus accéder à ton compte et devra redemander ton autorisation.")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Déconnecter" }))
    await waitFor(() => expect(screen.queryByText("Hermes")).toBeNull())
    expect(oauth.revokeGrant).toHaveBeenCalledWith({ clientId: "c1" })
    expect(toast.success).toHaveBeenCalledWith("Hermes est déconnecté.")
    expect(screen.getByText("Claude")).toBeTruthy()
  })

  it("échec de révocation → ligne conservée, toast d'erreur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.revokeGrant.mockResolvedValue({ data: null, error: new Error("boom") })
    render(<AssistantsConnectes />)
    const ligne = (await screen.findByText("Hermes")).closest("li")!
    fireEvent.click(within(ligne).getByRole("button", { name: "Déconnecter Hermes" }))
    fireEvent.click(screen.getByRole("button", { name: "Déconnecter" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de déconnecter Hermes. Réessaie."))
    expect(screen.getByText("Hermes")).toBeTruthy()
  })
})
