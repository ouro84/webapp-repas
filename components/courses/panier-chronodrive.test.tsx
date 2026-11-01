// Carte « Panier Chronodrive » de /courses (#308, US-53, RG-81 à RG-84) :
// visible seulement avec un exécuteur ; bouton sur le cycle courant, lecture
// seule sur un autre cycle qui a sa demande ; lancement d'une demande,
// interrogation pendant une demande active, compte-rendu du cycle.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DemandePanier, EtatPanier } from "@/lib/panier-affichage"
import type { RapportPanier } from "@/lib/panier"
import { ancreParDefaut, cycleDecale } from "@/lib/cycles"

const client = vi.hoisted(() => ({
  chargerEtatPanier: vi.fn(),
  chargerJourCoursesPanier: vi.fn(),
  lancerDemandePanier: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/panier-client", () => client)
vi.mock("sonner", () => ({ toast }))

import { PanierChronodrive } from "./panier-chronodrive"

// Mercredi 28 octobre 2026, midi : jour de semaine, donc ancreParDefaut =
// ancreCourante (lundi 26 avec un jour de courses au lundi).
const MAINTENANT = new Date(2026, 9, 28, 12, 0, 0)
const JOUR_COURSES = 1
const ANCRE = ancreParDefaut(MAINTENANT, JOUR_COURSES)
const LIBELLE_BOUTON = "Constituer mon panier Chronodrive"
const LIBELLE_RELANCE = "Relancer pour les articles restants"
const MESSAGE_INJOIGNABLE_CARTE =
  "Ton exécuteur n’a pas répondu. Vérifie qu’il est allumé, puis réessaie."

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

const SANS_DEMANDE: EtatPanier = { executeur: true, derniere: null, active: null }
const ACTIVE: EtatPanier = { executeur: true, derniere: demande({ statut: "en_cours" }), active: null }
const TERMINEE: EtatPanier = {
  executeur: true,
  derniere: demande({ statut: "terminee", rapport: RAPPORT, termine_le: "2026-10-28T17:09:00Z" }),
  active: null,
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

/** Désactivé par `aria-disabled` (le bouton garde le focus), jamais par `disabled`. */
function desactive(b: HTMLButtonElement): boolean {
  expect(b.disabled).toBe(false)
  return b.getAttribute("aria-disabled") === "true"
}

let visibilite: DocumentVisibilityState = "visible"

/** Change la visibilité de l'onglet et émet `visibilitychange`. */
async function onglet(etat: DocumentVisibilityState) {
  visibilite = etat
  document.dispatchEvent(new Event("visibilitychange"))
  await vider()
}

/** Promesse résolue à la main, pour une lecture lente. */
function differee<T>() {
  let resoudre: (v: T) => void = () => {}
  const promesse = new Promise<T>((ok) => {
    resoudre = ok
  })
  return { promesse, resoudre }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(MAINTENANT)
  visibilite = "visible"
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilite)
  client.chargerJourCoursesPanier.mockResolvedValue(JOUR_COURSES)
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
    client.chargerEtatPanier.mockResolvedValue({ executeur: false, derniere: null, active: null })
    const { container } = await rendre()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe("")
  })

  it("cycle non courant sans demande de ce cycle → rien", async () => {
    // Une demande (même terminée avec rapport) du cycle COURANT ne s'affiche
    // pas sur le cycle suivant.
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    const { container } = await rendre(cycleDecale(ANCRE, 1))
    expect(container.innerHTML).toBe("")
  })

  it("cycle non courant avec rapport de ce cycle → lecture seule, sans bouton (RG-84)", async () => {
    const suivant = cycleDecale(ANCRE, 1)
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: { ...TERMINEE.derniere!, ancre: suivant },
    })
    await rendre(suivant)
    expect(screen.getByRole("region", { name: "Panier Chronodrive" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /panier|Relancer/ })).toBeNull()
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
    expect(screen.getByText("Terminé à 18 h 09")).toBeTruthy()
  })

  it("cycle non courant avec demande active de ce cycle → « Panier en cours… » en texte", async () => {
    const suivant = cycleDecale(ANCRE, 1)
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: suivant, statut: "en_cours" }),
    })
    await rendre(suivant)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Panier en cours…")).toBeTruthy()
    expect(screen.getByText("Lancé à 18 h 05")).toBeTruthy()
  })

  it("disponible → bouton « Constituer mon panier Chronodrive »", async () => {
    await rendre()
    const carte = screen.getByRole("region", { name: "Panier Chronodrive" })
    expect(carte).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Panier Chronodrive" })).toBeTruthy()
    const b = bouton()
    expect(desactive(b)).toBe(false)
    expect(b.className).toContain("bg-primary")
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
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
  })

  it("pendant l’envoi → aria-disabled, « Envoi en cours… » annoncé", async () => {
    await rendre()
    const reponse = differee<{ ok: true }>()
    client.lancerDemandePanier.mockReturnValue(reponse.promesse)
    fireEvent.click(bouton())
    expect(desactive(bouton())).toBe(true)
    expect(screen.getByText("Envoi en cours…")).toBeTruthy()
    reponse.resoudre({ ok: true })
    await vider()
    expect(screen.queryByText("Envoi en cours…")).toBeNull()
  })

  it("double tap avant le rendu suivant → une seule requête (garde par ref)", async () => {
    await rendre()
    const reponse = differee<{ ok: true }>()
    client.lancerDemandePanier.mockReturnValue(reponse.promesse)
    const b = bouton()
    // Deux clics dans le même lot : React ne re-rend pas entre les deux, le
    // gestionnaire voit encore `occupe = false` ; seule la ref bloque.
    act(() => {
      b.click()
      b.click()
    })
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
    reponse.resoudre({ ok: true })
    await vider()
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
  })

  it("clic pendant une demande active → rien (aria-disabled gardé dans onClick)", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    fireEvent.click(bouton("Panier en cours…"))
    await vider()
    expect(client.lancerDemandePanier).not.toHaveBeenCalled()
  })

  it("échec de lancement (409) → toast avec le message de la route, bouton réactivé", async () => {
    client.lancerDemandePanier.mockResolvedValue({
      ok: false,
      statut: 409,
      message: "Un panier est déjà en cours pour ton foyer.",
    })
    await rendre()
    fireEvent.click(bouton())
    await vider()
    expect(toast.error).toHaveBeenCalledWith("Un panier est déjà en cours pour ton foyer.")
    expect(toast.success).not.toHaveBeenCalled()
    expect(desactive(bouton())).toBe(false)
  })

  it("échec de lancement en 502 → pas de toast, la carte porte le message", async () => {
    client.lancerDemandePanier.mockResolvedValue({
      ok: false,
      statut: 502,
      message: "Ton exécuteur est injoignable : vérifie qu'il est allumé, puis réessaie.",
    })
    await rendre()
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({
        statut: "echec",
        cause_echec: "injoignable",
        motif_echec: "réponse HTTP 500",
        termine_le: "2026-10-28T17:06:00Z",
      }),
    })
    fireEvent.click(bouton())
    await vider()
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByText(MESSAGE_INJOIGNABLE_CARTE)).toBeTruthy()
    expect(screen.getByText("Terminé à 18 h 06")).toBeTruthy()
    expect(desactive(bouton())).toBe(false)
  })

  it("502 et relecture échouée → le toast prend le relais", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {})
    client.lancerDemandePanier.mockResolvedValue({ ok: false, statut: 502, message: "Injoignable." })
    await rendre()
    client.chargerEtatPanier.mockRejectedValue(new Error("réseau coupé"))
    fireEvent.click(bouton())
    await vider()
    expect(toast.error).toHaveBeenCalledWith("Injoignable.")
    expect(erreur).toHaveBeenCalledTimes(1)
  })

  it("demande active → bouton désactivé « Panier en cours… » et « Lancé à 18 h 05 »", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
    expect(screen.getByText("Lancé à 18 h 05")).toBeTruthy()
  })

  it("cree_le invalide → pas de ligne « Lancé à »", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ statut: "en_cours", cree_le: "pas une date" }),
    })
    await rendre()
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
    expect(screen.queryByText(/^Lancé à/)).toBeNull()
  })

  it("une demande active d’un autre cycle bloque aussi le bouton (RG-83)", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: cycleDecale(ANCRE, -1), statut: "en_attente" }),
    })
    await rendre()
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
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
    expect(desactive(bouton(LIBELLE_RELANCE))).toBe(false)
    await avancer(30_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
  })

  it("lecture lente → pas de lecture qui se chevauche, prochaine 10 s après la fin", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    await avancer(10_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    // La lecture traîne 25 s : aucune autre ne part pendant ce temps.
    await avancer(25_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    await act(async () => {
      lente.resoudre(ACTIVE)
    })
    await avancer(9_999)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    await avancer(1)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(3)
  })

  it("un résultat plus ancien que la dernière lecture lancée est ignoré", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    // Lecture 2 (tick) lente, puis lecture 3 (retour sur l'onglet) rapide.
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    await avancer(10_000)
    client.chargerEtatPanier.mockResolvedValueOnce(TERMINEE)
    await onglet("visible")
    expect(bouton(LIBELLE_RELANCE)).toBeTruthy()
    // La lecture 2 arrive enfin, avec un état périmé : ignoré.
    await act(async () => {
      lente.resoudre(ACTIVE)
    })
    expect(bouton(LIBELLE_RELANCE)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Panier en cours…" })).toBeNull()
  })

  it("onglet masqué → plus d’interrogation ; retour → relecture immédiate et reprise", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre()
    await onglet("hidden")
    await avancer(60_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    await onglet("visible")
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    await avancer(10_000)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(3)
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
    expect(desactive(bouton())).toBe(false)
    // Demande lancée entre-temps par un autre membre ou par l'assistant.
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await onglet("visible")
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
  })

  it("ne relit pas quand l’onglet passe en arrière-plan", async () => {
    await rendre()
    await onglet("hidden")
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
  })

  it("retour sur l’onglet après un changement de cycle → cycle courant recalculé", async () => {
    await rendre()
    expect(bouton()).toBeTruthy()
    // L'onglet a dormi une semaine : le cycle affiché n'est plus le courant,
    // et aucune demande ne le concerne.
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0))
    await onglet("visible")
    expect(screen.queryByRole("region", { name: "Panier Chronodrive" })).toBeNull()
  })

  it("terminee → résumé, heure de fin, rappel, sections, « Ajoutés au panier » replié, relance secondaire", async () => {
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    await rendre()
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
    expect(screen.getByText("Terminé à 18 h 09")).toBeTruthy()
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
    // Après un compte-rendu, relancer est l'action secondaire (articles restants).
    expect(screen.queryByRole("button", { name: LIBELLE_BOUTON })).toBeNull()
    const relance = bouton(LIBELLE_RELANCE)
    expect(desactive(relance)).toBe(false)
    expect(relance.className).toContain("bg-surface")
    expect(relance.className).not.toContain("bg-primary")
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

  it("terminee sans rapport → bouton de relance, sans section de compte-rendu", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ statut: "terminee", rapport: null }),
    })
    await rendre()
    expect(desactive(bouton(LIBELLE_RELANCE))).toBe(false)
    expect(screen.queryByText(/ajouté/)).toBeNull()
    expect(screen.queryByText(/^Rappel :/)).toBeNull()
    expect(screen.queryByText("Ajoutés au panier")).toBeNull()
  })

  it("échec du cycle → message lisible, bouton principal pour réessayer", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({
        statut: "echec",
        cause_echec: "injoignable",
        motif_echec: "délai de 10 s dépassé",
      }),
    })
    await rendre()
    expect(screen.getByText(MESSAGE_INJOIGNABLE_CARTE)).toBeTruthy()
    expect(screen.queryByText(/délai de 10 s dépassé/)).toBeNull()
    // Sans termine_le, pas de ligne d'heure.
    expect(screen.queryByText(/^Terminé à/)).toBeNull()
    const b = bouton()
    expect(desactive(b)).toBe(false)
    expect(b.className).toContain("bg-primary")
  })

  it("échec avec rapport partiel → message, puis résumé, rappel et détail (A1)", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({
        statut: "echec",
        cause_echec: "executeur",
        motif_echec: "Session Chronodrive expirée",
        rapport: RAPPORT,
        termine_le: "2026-10-28T17:20:00Z",
      }),
    })
    await rendre()
    const message = screen.getByText("Ton exécuteur a signalé un problème : Session Chronodrive expirée")
    const resume = screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")
    // Le message d'échec vient avant le résumé.
    expect(message.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByText("Terminé à 18 h 20")).toHaveLength(1)
    expect(
      screen.getByText(
        "Rappel : rien n’est commandé. Relis et valide ton panier dans l’appli Chronodrive."
      )
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "À choisir toi-même" })).toBeTruthy()
    expect(screen.getByText("Ajoutés au panier")).toBeTruthy()
    // Après un échec, l'action reste principale.
    expect(bouton().className).toContain("bg-primary")
  })

  it("rapport d’un autre cycle masqué", async () => {
    client.chargerEtatPanier.mockResolvedValue({
      executeur: true,
      derniere: demande({ ancre: cycleDecale(ANCRE, -1), statut: "terminee", rapport: RAPPORT }),
    })
    await rendre()
    expect(desactive(bouton())).toBe(false)
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
    expect(desactive(bouton("Panier en cours…"))).toBe(true)
  })

  it("échec de la première lecture → rien n’est rendu, erreur loggée", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {})
    client.chargerEtatPanier.mockRejectedValue(new Error("réseau coupé"))
    const { container } = await rendre()
    expect(container.innerHTML).toBe("")
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("échec de la première lecture puis retour sur l’onglet → relecture, carte affichée (C1)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    client.chargerEtatPanier.mockRejectedValueOnce(new Error("réseau coupé"))
    const { container } = await rendre()
    expect(container.innerHTML).toBe("")
    await onglet("visible")
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(bouton()).toBeTruthy()
  })

  it("jour de courses illisible → erreur loggée, rien n’est rendu, sans repli sur lundi", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {})
    client.chargerJourCoursesPanier.mockRejectedValue(new Error("boom"))
    const { container } = await rendre()
    expect(container.innerHTML).toBe("")
    expect(erreur).toHaveBeenCalledWith("Lecture du jour de courses échouée.", expect.any(Error))
    // Retour sur l'onglet : le jour est relu.
    client.chargerJourCoursesPanier.mockResolvedValue(JOUR_COURSES)
    await onglet("visible")
    expect(client.chargerJourCoursesPanier).toHaveBeenCalledTimes(2)
    expect(bouton()).toBeTruthy()
  })
})
