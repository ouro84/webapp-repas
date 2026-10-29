// FormulaireAuth (#305, RG-72) : après connexion, retour sur la demande OAuth
// indiquée par `?suivant=`, filtrée par cheminDeRetour (anti open-redirect).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FormulaireAuth } from "./formulaire-auth"

const assign = vi.fn()

beforeEach(() => {
  assign.mockReset()
  vi.stubGlobal("location", { ...window.location, assign, search: "" })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function soumettre(search: string) {
  vi.stubGlobal("location", { ...window.location, assign, search })
  render(
    <FormulaireAuth
      titre="Connexion"
      autocompletePassword="current-password"
      labelSoumettre="Se connecter"
      labelChargement="Connexion…"
      onSoumettre={async () => null}
      pied={null}
    />
  )
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } })
  fireEvent.change(screen.getByLabelText("Mot de passe", { exact: true }), { target: { value: "motdepasse" } })
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))
}

describe("FormulaireAuth — retour après connexion (#305)", () => {
  it("revient sur le consentement OAuth indiqué par ?suivant=", async () => {
    soumettre("?suivant=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc")
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/oauth/consent?authorization_id=abc"))
  })

  it("sans suivant ou avec un suivant externe : /planning", async () => {
    soumettre("?suivant=https%3A%2F%2Fevil.com")
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/planning"))
  })
})
