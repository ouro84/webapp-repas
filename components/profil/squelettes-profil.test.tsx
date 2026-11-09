// Squelettes de /profil (#400, RG-09) : une seule annonce « Chargement… » par
// bloc, `h2` réel, hauteurs réservées conservées (Review Focus 5), tout sous
// aria-hidden, et branchement dans les trois composants à leur état de chargement.
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  profil: null as unknown,
  chargerFoyer: vi.fn(() => new Promise(() => {})),
  listGrants: vi.fn(() => new Promise(() => {})),
}))
vi.mock("@/lib/profil", () => ({
  useProfil: () => mocks.profil,
  sauvegarderProfil: vi.fn(),
}))
vi.mock("@/lib/foyer", () => ({
  chargerFoyer: mocks.chargerFoyer,
  definirJourCoursesFoyer: vi.fn(),
  genererCodeInvitation: vi.fn(),
  quitterFoyer: vi.fn(),
  rejoindreFoyer: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { oauth: { listGrants: mocks.listGrants, revokeGrant: vi.fn() } } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AssistantsConnectes } from "./assistants-connectes"
import { EditionIdentite } from "./edition-identite"
import { PanneauFoyer } from "./panneau-foyer"
import { SqueletteAssistants, SqueletteFoyer, SqueletteIdentite } from "./squelettes-profil"

afterEach(() => {
  cleanup()
  mocks.profil = null
})

// Le `h2` réel est dans la zone, sous aria-hidden : invisible à getByRole.
function titre(container: HTMLElement, texte: string): HTMLElement {
  const h2 = Array.from(container.querySelectorAll("h2")).find((h) => h.textContent === texte)
  expect(h2).toBeDefined()
  expect(h2!.closest('[aria-hidden="true"]')).not.toBeNull()
  return h2!
}

describe("SqueletteIdentite", () => {
  it("est une zone de chargement unique, avec la hauteur réservée et le h2 réel", () => {
    const { container } = render(<SqueletteIdentite />)
    const zone = screen.getByRole("status")
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(zone.tagName).toBe("SECTION")
    expect(zone.textContent).toContain("Chargement…")
    expect(zone.className).toContain("mb-8")
    expect(zone.className).toContain("min-h-[15.4rem]")
    expect(zone.className).toContain("md:min-h-[13rem]")
    const h2 = titre(container, "Mon identité")
    expect(h2.id).toBe("section-identite")
    expect(h2.className).toBe("mb-4 text-lg font-semibold text-brand-900")
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("reprend les formes du chargé : avatar, champ et bouton ronds, 8 pastilles size-9", () => {
    const { container } = render(<SqueletteIdentite />)
    const avatar = container.querySelector(".size-20")
    expect(avatar?.className).toContain("rounded-full")
    const rangee = container.querySelector(".flex-col.gap-2")
    expect(Array.from(rangee!.children).every((c) => c.className.includes("rounded-full"))).toBe(true)
    const pastilles = Array.from(container.querySelectorAll(".size-9"))
    expect(pastilles).toHaveLength(8)
    expect(pastilles.every((p) => p.className.includes("rounded-full"))).toBe(true)
    // Textes fixes en vrai texte.
    expect(container.textContent).toContain("Prénom")
    expect(container.textContent).toContain("Couleur de l’avatar")
  })
})

describe("SqueletteFoyer", () => {
  it("est une zone de chargement unique, avec la hauteur réservée et le h2 réel", () => {
    const { container } = render(<SqueletteFoyer />)
    const zone = screen.getByRole("status")
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(zone.tagName).toBe("SECTION")
    expect(zone.className).toContain("mb-8")
    expect(zone.className).toContain("min-h-[33.6rem]")
    expect(zone.className).toContain("md:min-h-[30.6rem]")
    const h2 = titre(container, "Mon foyer")
    expect(h2.id).toBe("section-foyer")
    expect(h2.className).toBe("mb-1 text-lg font-semibold text-brand-900")
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("la phrase est une donnée en TexteSquelette ; les deux cartes sont rounded-2xl border p-4", () => {
    const { container } = render(<SqueletteFoyer />)
    expect(container.querySelector("p.mb-4 span.text-transparent")).not.toBeNull()
    const cartes = Array.from(container.querySelectorAll(".rounded-2xl"))
    expect(cartes).toHaveLength(2)
    for (const carte of cartes) {
      expect(carte.className).toContain("border")
      expect(carte.className).toContain("p-4")
    }
    // Carte jour de courses : bg-surface → teinte carte. Carte d'invitation : fond de page → teinte fond.
    expect(cartes[0].className).toContain("bg-surface")
    expect(cartes[0].querySelector(".bg-squelette-carte")).not.toBeNull()
    expect(cartes[0].querySelector(".bg-squelette")).toBeNull()
    expect(cartes[1].className).not.toContain("bg-surface")
    expect(cartes[1].querySelector(".bg-squelette")).not.toBeNull()
    // Textes fixes en vrai texte.
    expect(container.textContent).toContain("Jour de courses")
    expect(container.textContent).toContain("Rejoindre un foyer")
  })
})

describe("SqueletteAssistants", () => {
  it("est une zone de chargement unique avec le h2 réel et deux lignes de ul.flex-col gap-3", () => {
    const { container } = render(<SqueletteAssistants />)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(screen.getByRole("status").tagName).toBe("SECTION")
    const h2 = titre(container, "Assistants connectés")
    expect(h2.id).toBe("titre-assistants")
    const ul = container.querySelector("ul")
    expect(ul?.className).toBe("flex flex-col gap-3")
    const lignes = Array.from(ul!.children)
    expect(lignes).toHaveLength(2)
    for (const ligne of lignes) {
      expect(ligne.tagName).toBe("LI")
      expect(ligne.className).toBe("flex flex-wrap items-center justify-between gap-3")
      expect(ligne.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })
})

describe("états de chargement des composants", () => {
  it("EditionIdentite affiche le squelette tant que le profil est null", () => {
    const { container } = render(<EditionIdentite />)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(container.querySelector(".min-h-\\[15\\.4rem\\]")).not.toBeNull()
    expect(container.querySelectorAll(".size-9")).toHaveLength(8)
  })

  it("PanneauFoyer affiche le squelette tant que le foyer n’est pas chargé", () => {
    const { container } = render(<PanneauFoyer />)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(container.querySelector(".min-h-\\[33\\.6rem\\]")).not.toBeNull()
    expect(container.querySelectorAll(".rounded-2xl")).toHaveLength(2)
  })

  it("AssistantsConnectes affiche le squelette tant que la liste est en vol", () => {
    const { container } = render(<AssistantsConnectes />)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(container.querySelectorAll("li")).toHaveLength(2)
    expect(container.querySelector("li button")).toBeNull()
  })
})
