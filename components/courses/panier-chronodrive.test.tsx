// Carte « Panier Chronodrive » de /courses (#308, US-53, RG-81 à RG-84) :
// visible seulement avec un exécuteur et sur le cycle courant, lancement d'une
// demande, interrogation pendant une demande active, compte-rendu du cycle.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DemandePanier, EtatPanier } from "@/lib/panier-affichage"
import type { RapportPanier } from "@/lib/panier"
import { ancreParDefaut, cycleDecale } from "@/lib/cycles"

const client = vi.hoisted(() => ({
  chargerEtatPanier: vi.fn(),
  lancerDemandePanier: vi.fn(),
}))
const foyer = vi.hoisted(() => ({ chargerJourCoursesFoyer: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/panier-client", () => client)
vi.mock("@/lib/foyer", () => foyer)
vi.mock("sonner", () => ({ toast }))

import { PanierChronodrive } from "./panier-chronodrive"

// Mercredi 28 octobre 2026, midi : jour de semaine, donc ancreParDefaut =
// ancreCourante (lundi 26 avec un jour de courses au lundi).
const MAINTENANT = new Date(2026, 9, 28, 12, 0, 0)
const JOUR_COURSES = 1
const ANCRE = ancreParDefaut(MAINTENANT, JOUR_COURSES)
const LIBELLE_BOUTON = "Constituer mon panier Chronodrive"

const RAPPORT: RapportPanier = {
  ajoutes: [
    { article: "tomates", produit: "Tomates grappe", marque: "Chronodrive", quantite: 2 },
    { article: "riz", produit: "Riz basmati", marque: "Taureau Ailé", quantite: 1 },
  ],
  a_choisir: [
    {
      article: "crème fraîche",
      raison: "Plusieurs formats proches",
      candidats: ["Crème fraîche épaisse 20 cl", "Crème fraîche légère 50 cl"],
    },
  ],
  introuvables: [{ article: "sumac" }],
}

function demande(partiel: Partial<DemandePanier> = {}): DemandePanier {
  return {
    id: "d1",
    ancre: ANCRE,
    statut: "en_attente",
    cause_echec: null,
    motif_echec: null,
    rapport: null,
    rapport_tardif: false,
    // 17 h 05 UTC = 18 h 05 à Paris (heure d'hiver depuis le 25 octobre).
    cree_le: "2026-10-28T17:05:00Z",
    pris_le: null,
    termine_le: null,
    ...partiel,
  }
}

const SANS_DEMANDE: EtatPanier = { executeur: true, derniere: null }
const ACTIVE: EtatPanier = { executeur: true, derniere: demande({ statut: "en_cours" }) }
const TERMINEE: EtatPanier = {
  executeur: true,
  derniere: demande({ statut: "terminee", rapport: RAPPORT, termine_le: "2026-10-28T17:09:00Z" }),
}

/** Laisse se résoudre les promesses en attente (chargements, clic). */
async function vider() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function rendre(ancreAffichee = ANCRE) {
  const rendu = render(<PanierChronodrive ancreAffichee={ancreAffichee} />)
  await vider()
  return rendu
}

async function avancer(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function bouton(nom: string | RegExp = LIBELLE_BOUTON) {
  return screen.getByRole("button", { name: nom }) as HTMLButtonElement
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(MAINTENANT)
  foyer.chargerJourCoursesFoyer.mockResolvedValue(JOUR_COURSES)
  client.chargerEtatPanier.mockResolvedValue(SANS_DEMANDE)
  client.lancerDemandePanier.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("PanierChronodrive (#308, US-53)", () => {
  it("aucun exécuteur → rien n’est rendu", async () => {
    client.chargerEtatPanier.mockResolvedValue({ executeur: false, derniere: null })
    const { container } = await rendre()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe("")
  })

  it("cycle non courant → rien", async () => {
    // Même un rapport de ce cycle-là ne doit pas faire apparaître la carte.
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: cycleDecale(ANCRE, 1), statut: "terminee", rapport: RAPPORT }),
    })
    const { container } = await rendre(cycleDecale(ANCRE, 1))
    expect(container.innerHTML).toBe("")
  })

  it("disponible → bouton « Constituer mon panier Chronodrive »", async () => {
    await rendre()
    const carte = screen.getByRole("region", { name: "Panier Chronodrive" })
    expect(carte).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Panier Chronodrive" })).toBeTruthy()
    expect(bouton().disabled).toBe(false)
  })

  it("clic → lancerDemandePanier, toast succès, relecture", async () => {
    await rendre()
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    fireEvent.click(bouton())
    await vider()
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith("C’est parti : ton panier se remplit.")
    expect(toast.error).not.toHaveBeenCalled()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(bouton("Panier en cours…").disabled).toBe(true)
  })

  it("double clic → une seule requête", async () => {
    await rendre()
    let terminer: (r: { ok: true }) => void = () => {}
    client.lancerDemandePanier.mockReturnValue(
      new Promise((resolve) => {
        terminer = resolve
      })
    )
    fireEvent.click(bouton())
    // Désactivé dès le clic, avant la réponse de la route.
    const enEnvoi = screen.getByRole("button") as HTMLButtonElement
    expect(enEnvoi.disabled).toBe(true)
    fireEvent.click(enEnvoi)
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
    terminer({ ok: true })
    await vider()
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
  })

  it("échec de lancement → toast avec le message de la route, bouton réactivé", async () => {
    client.lancerDemandePanier.mockResolvedValue({
      ok: false,
      message: "Un panier est déjà en cours pour ton foyer.",
    })
    await rendre()
    fireEvent.click(bouton())
    await vider()
    expect(toast.error).toHaveBeenCalledWith("Un panier est déjà en cours pour ton foyer.")
    expect(toast.success).not.toHaveBeenCalled()
    expect(bouton().disabled).toBe(false)
  })

  it("demande active → bouton désactivé « Panier en cours… » et « Lancé à 18 h 05 »", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    expect(bouton("Panier en cours…").disabled).toBe(true)
    expect(screen.getByText("Lancé à 18 h 05")).toBeTruthy()
  })

  it("une demande active d’un autre cycle bloque aussi le bouton (RG-83)", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: cycleDecale(ANCRE, -1), statut: "en_attente" }),
    })
    await rendre()
    expect(bouton("Panier en cours…").disabled).toBe(true)
  })

  it("interroge toutes les 10 s pendant une demande active, puis s’arrête une fois terminée", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    await avancer(9_999)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    await avancer(1)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(bouton().disabled).toBe(false)
    await avancer(30_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
  })

  it("n’interroge pas sans demande active", async () => {
    await rendre()
    await avancer(30_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
  })

  it("arrête l’interrogation au démontage", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    const { unmount } = await rendre()
    unmount()
    await avancer(30_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
  })

  it("relit l’état au retour sur l’onglet", async () => {
    await rendre()
    expect(bouton().disabled).toBe(false)
    // Demande lancée entre-temps par un autre membre ou par l'assistant.
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    await vider()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(bouton("Panier en cours…").disabled).toBe(true)
  })

  it("ne relit pas quand l’onglet passe en arrière-plan", async () => {
    await rendre()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    await vider()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
  })

  it("terminee → résumé, rappel, sections « À choisir toi-même » et « Introuvables », « Ajoutés au panier » replié", async () => {
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    await rendre()
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
    expect(
      screen.getByText(
        "Rappel : rien n’est commandé. Relis et valide ton panier dans l’appli Chronodrive."
      )
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "À choisir toi-même" })).toBeTruthy()
    expect(screen.getByText("crème fraîche")).toBeTruthy()
    expect(screen.getByText("Plusieurs formats proches")).toBeTruthy()
    expect(screen.getByText("Crème fraîche épaisse 20 cl")).toBeTruthy()
    expect(screen.getByText("Crème fraîche légère 50 cl")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Introuvables" })).toBeTruthy()
    expect(screen.getByText("sumac")).toBeTruthy()
    const ajoutes = screen.getByText("Ajoutés au panier").closest("details")
    expect(ajoutes).not.toBeNull()
    expect(ajoutes?.open).toBe(false)
    expect(screen.getByText("Tomates grappe · Chronodrive × 2")).toBeTruthy()
    expect(screen.queryByText("Compte-rendu arrivé après le délai.")).toBeNull()
    // Après un compte-rendu, on peut relancer un panier.
    expect(bouton().disabled).toBe(false)
  })

  it("rapport tardif → mention discrète", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: { ...TERMINEE.derniere!, rapport_tardif: true },
    })
    await rendre()
    expect(screen.getByText("Compte-rendu arrivé après le délai.")).toBeTruthy()
  })

  it("une section vide n’est pas rendue", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({
        statut: "terminee",
        rapport: { ajoutes: RAPPORT.ajoutes, a_choisir: [], introuvables: [] },
      }),
    })
    await rendre()
    expect(screen.getByText("2 ajoutés · 0 à choisir · 0 introuvable")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "À choisir toi-même" })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Introuvables" })).toBeNull()
    expect(screen.getByText("Ajoutés au panier")).toBeTruthy()
  })

  it("terminee sans rapport → bouton, sans section de compte-rendu", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ statut: "terminee", rapport: null }),
    })
    await rendre()
    expect(bouton().disabled).toBe(false)
    expect(screen.queryByText(/ajouté/)).toBeNull()
    expect(screen.queryByText(/^Rappel :/)).toBeNull()
    expect(screen.queryByText("Ajoutés au panier")).toBeNull()
  })

  it("échec du cycle → message lisible, bouton disponible pour réessayer", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({
        statut: "echec",
        cause_echec: "injoignable",
        motif_echec: "délai de 10 s dépassé",
      }),
    })
    await rendre()
    expect(screen.getByText("Ton exécuteur n’a pas répondu (délai de 10 s dépassé).")).toBeTruthy()
    expect(bouton().disabled).toBe(false)
  })

  it("rapport d’un autre cycle masqué", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: cycleDecale(ANCRE, -1), statut: "terminee", rapport: RAPPORT }),
    })
    await rendre()
    expect(bouton().disabled).toBe(false)
    expect(screen.queryByText(/à choisir/)).toBeNull()
    expect(screen.queryByText("Ajoutés au panier")).toBeNull()
  })

  it("échec de lecture → log, pas de toast répété", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {})
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    client.chargerEtatPanier.mockRejectedValue(new Error("réseau coupé"))
    await avancer(10_000)
    await avancer(10_000)
    await avancer(10_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(4)
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    // Dernier état connu conservé.
    expect(bouton("Panier en cours…").disabled).toBe(true)
  })

  it("échec de la première lecture → rien n’est rendu, erreur loggée", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {})
    client.chargerEtatPanier.mockRejectedValue(new Error("réseau coupé"))
    const { container } = await rendre()
    expect(container.innerHTML).toBe("")
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
