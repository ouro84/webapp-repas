// Carte « Panier Chronodrive » de /courses (#308, #320, US-53, RG-81 à RG-85) :
// visible seulement avec un exécuteur ; bouton sur le cycle affiché (grisé sur
// un cycle terminé, RG-81 ; désactivé par une demande active de n'importe quel
// cycle, RG-83) ; lancement d'une demande, interrogation pendant une demande
// active, compte-rendu du cycle affiché (RG-84).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DemandePanier, EtatPanier } from "@/lib/panier-affichage"
import type { RapportPanier } from "@/lib/panier"
import { ancreParDefaut, cycleDecale } from "@/lib/cycles"

const client = vi.hoisted(() => ({
  chargerEtatPanier: vi.fn(),
  lancerDemandePanier: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/panier-client", () => client)
vi.mock("sonner", () => ({ toast }))

import { PanierChronodrive } from "./panier-chronodrive"

// Mercredi 28 octobre 2026, midi : le cycle courant est celui du lundi 26
// (jour de courses au lundi, 7 jours : 26 octobre au 1er novembre).
const MAINTENANT = new Date(2026, 9, 28, 12, 0, 0)
const ANCRE = ancreParDefaut(MAINTENANT, 1)
const PRECEDENT = cycleDecale(ANCRE, -1)
const SUIVANT = cycleDecale(ANCRE, 1)
const LIBELLE_BOUTON = "Remplir mon panier"
const LIBELLE_COMPLETER = "Compléter mon panier"
const LIBELLE_EN_COURS = "Panier en cours…"
const MOTIF_TERMINE = "Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir."
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

/** Réponse de `etat_panier` : `active` suit `derniere` quand elle est active (RG-83). */
function etatAvec(derniere: DemandePanier | null, active?: DemandePanier | null): EtatPanier {
  const estActive = derniere?.statut === "en_attente" || derniere?.statut === "en_cours"
  return {
    executeur: true,
    derniere,
    active: active !== undefined ? active : estActive ? derniere : null,
  }
}

const SANS_DEMANDE: EtatPanier = etatAvec(null)
const ACTIVE: EtatPanier = etatAvec(demande({ statut: "en_cours" }))
const TERMINEE: EtatPanier = etatAvec(
  demande({ statut: "terminee", rapport: RAPPORT, termine_le: "2026-10-28T17:09:00Z" })
)

/** Laisse se résoudre les promesses en attente (chargements, clic). */
async function vider() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

type Reglages = { longueur?: number; aDesCoches?: boolean }

function carte(ancreAffichee: string, { longueur = 7, aDesCoches = false }: Reglages = {}) {
  return (
    <PanierChronodrive ancreAffichee={ancreAffichee} longueur={longueur} aDesCoches={aDesCoches} />
  )
}

async function rendre(ancreAffichee = ANCRE, reglages: Reglages = {}) {
  const rendu = render(carte(ancreAffichee, reglages))
  await vider()
  return {
    ...rendu,
    /** Rend la carte avec d'autres props (changement de cycle, de coches). */
    async rerendre(ancre: string, nouveaux: Reglages = {}) {
      rendu.rerender(carte(ancre, nouveaux))
      await vider()
    },
  }
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
  client.chargerEtatPanier.mockResolvedValue(SANS_DEMANDE)
  client.lancerDemandePanier.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("PanierChronodrive (#308, #320, US-53)", () => {
  it("aucun exécuteur → rien n’est rendu", async () => {
    client.chargerEtatPanier.mockResolvedValue({ executeur: false, derniere: null, active: null })
    const { container } = await rendre()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe("")
  })

  it("lit l’état du cycle affiché, et le relit quand le cycle affiché change", async () => {
    const { rerendre } = await rendre()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    expect(client.chargerEtatPanier).toHaveBeenLastCalledWith(ANCRE)
    await rerendre(SUIVANT)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(client.chargerEtatPanier).toHaveBeenLastCalledWith(SUIVANT)
  })

  // Les deux tests ci-dessous résolvent la lecture périmée avec une demande
  // ACTIVE, que `affichagePanier` ne filtre pas par ancre (RG-83) : seule la
  // garde `numeroLecture` l'empêche de griser le bouton.
  it("réponse d’un ancien cycle arrivée après un changement de cycle → ignorée (garde numeroLecture)", async () => {
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    const { rerendre } = await rendre()
    await rerendre(SUIVANT)
    expect(desactive(bouton())).toBe(false)
    await act(async () => {
      lente.resoudre(ACTIVE)
    })
    expect(desactive(bouton(LIBELLE_BOUTON))).toBe(false)
    expect(screen.queryByText(LIBELLE_EN_COURS)).toBeNull()
  })

  it("lecture lente du même cycle arrivée après une lecture plus récente → ignorée (garde numeroLecture)", async () => {
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    await rendre()
    // Retour sur l'onglet : une seconde lecture, plus récente, répond d'abord.
    client.chargerEtatPanier.mockResolvedValueOnce(SANS_DEMANDE)
    await onglet("visible")
    expect(desactive(bouton())).toBe(false)
    await act(async () => {
      lente.resoudre(ACTIVE)
    })
    expect(desactive(bouton(LIBELLE_BOUTON))).toBe(false)
    expect(screen.queryByText(LIBELLE_EN_COURS)).toBeNull()
  })

  it("le rapport du cycle quitté ne s’affiche pas sur le cycle affiché pendant la relecture", async () => {
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    const { rerendre } = await rendre(ANCRE, { aDesCoches: true })
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    await rerendre(SUIVANT, { aDesCoches: false })
    expect(screen.queryByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeNull()
    expect(bouton(LIBELLE_BOUTON)).toBeTruthy()
  })

  it("titre « Panier Chronodrive » avec le logo décoratif, sans icône de panier", async () => {
    await rendre()
    expect(screen.getByRole("region", { name: "Panier Chronodrive" })).toBeTruthy()
    const titre = screen.getByRole("heading", { level: 2, name: "Panier Chronodrive" })
    const logo = titre.querySelector("svg")
    expect(logo).not.toBeNull()
    expect(logo?.getAttribute("aria-hidden")).toBe("true")
    expect(logo?.getAttribute("viewBox")).toBe("0 0 40 40")
    expect(logo?.getAttribute("fill")).toBe("currentColor")
    expect(titre.querySelectorAll("svg")).toHaveLength(1)
  })

  it("disponible → bouton principal « Remplir mon panier »", async () => {
    await rendre()
    const b = bouton()
    expect(desactive(b)).toBe(false)
    expect(b.className).toContain("bg-primary")
    expect(screen.queryByText(MOTIF_TERMINE)).toBeNull()
  })

  it("cycle à venir sans demande → bouton « Remplir mon panier » actif", async () => {
    await rendre(SUIVANT)
    expect(desactive(bouton())).toBe(false)
    expect(screen.queryByText(MOTIF_TERMINE)).toBeNull()
  })

  it("clic sur un cycle à venir → lancerDemandePanier(ancre affichée)", async () => {
    await rendre(SUIVANT)
    fireEvent.click(bouton())
    await vider()
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
    expect(client.lancerDemandePanier).toHaveBeenCalledWith(SUIVANT)
  })

  it("cycle terminé → carte visible, bouton aria-disabled et motif lisible, clic sans effet (RG-81)", async () => {
    await rendre(PRECEDENT)
    const b = bouton()
    expect(desactive(b)).toBe(true)
    // Le motif est un texte sous le bouton, pas un toast, et décrit le bouton.
    const motif = screen.getByText(MOTIF_TERMINE)
    expect(b.getAttribute("aria-describedby")).toBe(motif.id)
    fireEvent.click(b)
    await vider()
    expect(client.lancerDemandePanier).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("cycle terminé → rapport du cycle conservé, bouton grisé", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(
        demande({
          ancre: PRECEDENT,
          statut: "terminee",
          rapport: RAPPORT,
          termine_le: "2026-10-24T17:09:00Z",
        })
      )
    )
    await rendre(PRECEDENT, { aDesCoches: true })
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
    expect(desactive(bouton(LIBELLE_COMPLETER))).toBe(true)
    expect(screen.getByText(MOTIF_TERMINE)).toBeTruthy()
  })

  it("le dernier jour du cycle n’est pas terminé ; le lendemain, il l’est", async () => {
    // ANCRE = lundi 26 octobre : dernier jour = dimanche 1er novembre.
    vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 0))
    await rendre()
    expect(desactive(bouton())).toBe(false)
    vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0))
    await onglet("visible")
    expect(desactive(bouton())).toBe(true)
    expect(screen.getByText(MOTIF_TERMINE)).toBeTruthy()
  })

  it("la longueur du cycle décide s’il est terminé (14 jours : encore en cours)", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0))
    await rendre(ANCRE, { longueur: 14 })
    expect(desactive(bouton())).toBe(false)
  })

  it("demande active d’un autre cycle → bouton désactivé « Panier en cours… », sans rapport de l’autre cycle (RG-83)", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(null, demande({ ancre: PRECEDENT, statut: "en_cours" }))
    )
    await rendre()
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
    expect(screen.getByText("Lancé à 18 h 05")).toBeTruthy()
    expect(screen.queryByText(/ajouté/)).toBeNull()
    expect(screen.queryByText(/^Terminé à/)).toBeNull()
    fireEvent.click(bouton(LIBELLE_EN_COURS))
    await vider()
    expect(client.lancerDemandePanier).not.toHaveBeenCalled()
  })

  it("demande active d’un autre cycle + rapport du cycle affiché → les deux se lisent", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(TERMINEE.derniere, demande({ id: "d2", ancre: SUIVANT, statut: "en_attente" }))
    )
    await rendre(ANCRE, { aDesCoches: true })
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
  })

  it("clic → lancerDemandePanier(ancre affichée), toast succès, relecture", async () => {
    await rendre()
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    fireEvent.click(bouton())
    await vider()
    expect(client.lancerDemandePanier).toHaveBeenCalledTimes(1)
    expect(client.lancerDemandePanier).toHaveBeenCalledWith(ANCRE)
    expect(toast.success).toHaveBeenCalledWith("C’est parti : ton panier se remplit.")
    expect(toast.error).not.toHaveBeenCalled()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
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

  it("changement de cycle pendant le POST → la relecture finale vise le nouveau cycle (pas de fermeture périmée)", async () => {
    const { rerendre } = await rendre()
    const reponse = differee<{ ok: true }>()
    client.lancerDemandePanier.mockReturnValue(reponse.promesse)
    fireEvent.click(bouton())
    expect(client.lancerDemandePanier).toHaveBeenCalledWith(ANCRE)
    await rerendre(SUIVANT)
    client.chargerEtatPanier.mockClear()
    reponse.resoudre({ ok: true })
    await vider()
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    expect(client.chargerEtatPanier).toHaveBeenLastCalledWith(SUIVANT)
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
    fireEvent.click(bouton(LIBELLE_EN_COURS))
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
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(
        demande({
          statut: "echec",
          cause_echec: "injoignable",
          motif_echec: "réponse HTTP 500",
          termine_le: "2026-10-28T17:06:00Z",
        })
      )
    )
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
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
    expect(screen.getByText("Lancé à 18 h 05")).toBeTruthy()
  })

  it("cree_le invalide → pas de ligne « Lancé à »", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(demande({ statut: "en_cours", cree_le: "pas une date" }))
    )
    await rendre()
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
    expect(screen.queryByText(/^Lancé à/)).toBeNull()
  })

  it("interroge toutes les 10 s pendant une demande active, puis s’arrête une fois terminée", async () => {
    client.chargerEtatPanier.mockResolvedValue(ACTIVE)
    await rendre(ANCRE, { aDesCoches: true })
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    await avancer(9_999)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    await avancer(1)
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(2)
    expect(desactive(bouton(LIBELLE_COMPLETER))).toBe(false)
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
    await rendre(ANCRE, { aDesCoches: true })
    // Lecture 2 (tick) lente, puis lecture 3 (retour sur l'onglet) rapide.
    const lente = differee<EtatPanier>()
    client.chargerEtatPanier.mockReturnValueOnce(lente.promesse)
    await avancer(10_000)
    client.chargerEtatPanier.mockResolvedValueOnce(TERMINEE)
    await onglet("visible")
    expect(bouton(LIBELLE_COMPLETER)).toBeTruthy()
    // La lecture 2 arrive enfin, avec un état périmé : ignoré.
    await act(async () => {
      lente.resoudre(ACTIVE)
    })
    expect(bouton(LIBELLE_COMPLETER)).toBeTruthy()
    expect(screen.queryByRole("button", { name: LIBELLE_EN_COURS })).toBeNull()
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
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
  })

  it("ne relit pas quand l’onglet passe en arrière-plan", async () => {
    await rendre()
    await onglet("hidden")
    expect(client.chargerEtatPanier).toHaveBeenCalledTimes(1)
  })

  it("terminee + articles cochés → résumé, heure de fin, rappel, sections, « Ajoutés au panier » replié, « Compléter mon panier » secondaire", async () => {
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    await rendre(ANCRE, { aDesCoches: true })
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
    // Après un compte-rendu avec des articles cochés, compléter est l'action secondaire.
    expect(screen.queryByRole("button", { name: LIBELLE_BOUTON })).toBeNull()
    const completer = bouton(LIBELLE_COMPLETER)
    expect(desactive(completer)).toBe(false)
    expect(completer.className).toContain("bg-surface")
    expect(completer.className).not.toContain("bg-primary")
  })

  it("« Tout décocher » après un compte-rendu → le bouton repasse à « Remplir mon panier »", async () => {
    client.chargerEtatPanier.mockResolvedValue(TERMINEE)
    const { rerendre } = await rendre(ANCRE, { aDesCoches: true })
    expect(bouton(LIBELLE_COMPLETER)).toBeTruthy()
    await rerendre(ANCRE, { aDesCoches: false })
    expect(screen.queryByRole("button", { name: LIBELLE_COMPLETER })).toBeNull()
    const b = bouton(LIBELLE_BOUTON)
    expect(desactive(b)).toBe(false)
    expect(b.className).toContain("bg-primary")
    // Le compte-rendu reste lisible.
    expect(screen.getByText("2 ajoutés · 1 à choisir · 1 introuvable")).toBeTruthy()
  })

  it("rapport tardif → mention discrète", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec({ ...TERMINEE.derniere!, rapport_tardif: true })
    )
    await rendre()
    expect(screen.getByText("Compte-rendu arrivé après le délai.")).toBeTruthy()
  })

  it("une section vide n’est pas rendue", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(
        demande({
          statut: "terminee",
          rapport: { ajoutes: RAPPORT.ajoutes, a_choisir: [], introuvables: [] },
        })
      )
    )
    await rendre()
    expect(screen.getByText("2 ajoutés · 0 à choisir · 0 introuvable")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "À choisir toi-même" })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Introuvables" })).toBeNull()
    expect(screen.getByText("Ajoutés au panier")).toBeTruthy()
  })

  it("terminee sans rapport → bouton « Compléter mon panier » si des coches, sans section de compte-rendu", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(demande({ statut: "terminee", rapport: null }))
    )
    await rendre(ANCRE, { aDesCoches: true })
    expect(desactive(bouton(LIBELLE_COMPLETER))).toBe(false)
    expect(screen.queryByText(/ajouté/)).toBeNull()
    expect(screen.queryByText(/^Rappel :/)).toBeNull()
    expect(screen.queryByText("Ajoutés au panier")).toBeNull()
  })

  it("échec du cycle → message lisible, bouton principal pour réessayer", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(
        demande({
          statut: "echec",
          cause_echec: "injoignable",
          motif_echec: "délai de 10 s dépassé",
        })
      )
    )
    await rendre(ANCRE, { aDesCoches: true })
    expect(screen.getByText(MESSAGE_INJOIGNABLE_CARTE)).toBeTruthy()
    expect(screen.queryByText(/délai de 10 s dépassé/)).toBeNull()
    // Sans termine_le, pas de ligne d'heure.
    expect(screen.queryByText(/^Terminé à/)).toBeNull()
    const b = bouton()
    expect(desactive(b)).toBe(false)
    expect(b.className).toContain("bg-primary")
  })

  it("échec avec rapport partiel → message, puis résumé, rappel et détail (A1)", async () => {
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(
        demande({
          statut: "echec",
          cause_echec: "executeur",
          motif_echec: "Session Chronodrive expirée",
          rapport: RAPPORT,
          termine_le: "2026-10-28T17:20:00Z",
        })
      )
    )
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
    client.chargerEtatPanier.mockResolvedValue(
      etatAvec(demande({ ancre: PRECEDENT, statut: "terminee", rapport: RAPPORT }))
    )
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
    expect(desactive(bouton(LIBELLE_EN_COURS))).toBe(true)
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
})
