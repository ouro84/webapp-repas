// Primitives de squelette de chargement (#400, RG-09) : pulsation sous
// `motion-safe` uniquement, une seule annonce « Chargement… » par zone, blocs
// masqués aux lecteurs d'écran, coque `EcranChargement` à boîte stable (CLS).
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { EcranChargement } from "./ecran-chargement"
import { Squelette, TexteSquelette, ZoneChargement } from "./squelette"

afterEach(cleanup)

describe("ZoneChargement", () => {
  it("expose une annonce « Chargement… » et masque les enfants aux lecteurs d’écran", () => {
    render(
      <ZoneChargement>
        <span data-testid="bloc">bloc</span>
      </ZoneChargement>,
    )
    const zone = screen.getByRole("status")
    expect(zone.textContent).toContain("Chargement…")
    expect(zone.querySelector(".sr-only")?.textContent).toBe("Chargement…")
    expect(screen.getByTestId("bloc").closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it("applique className et le conteneur choisi par `as`", () => {
    render(<ZoneChargement as="section" className="flex gap-2">x</ZoneChargement>)
    const zone = screen.getByRole("status")
    expect(zone.tagName).toBe("SECTION")
    expect(zone.className).toContain("flex gap-2")
  })
})

describe("Squelette", () => {
  it("pulse sous motion-safe uniquement, sur la teinte fond", () => {
    const { container } = render(<Squelette className="h-10 w-28 rounded-full" />)
    const el = container.firstElementChild as HTMLElement
    const classes = el.className.split(/\s+/)
    expect(classes).toContain("bg-squelette")
    expect(classes).toContain("motion-safe:animate-pulse")
    expect(classes).not.toContain("animate-pulse")
    expect(classes).toContain("block")
    expect(classes).toContain("h-10")
  })

  it("un rayon fourni par l’appelant remplace le rayon par défaut", () => {
    const { container } = render(<Squelette className="rounded-full" />)
    const classes = (container.firstElementChild as HTMLElement).className.split(/\s+/)
    expect(classes).toContain("rounded-full")
    expect(classes).not.toContain("rounded-md")
  })

  it("garde rounded-md par défaut sans rayon fourni", () => {
    const { container } = render(<Squelette className="h-4 w-4" />)
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain("rounded-md")
  })

  it("sur=\"carte\" utilise la teinte carte", () => {
    const { container } = render(<Squelette sur="carte" />)
    const classes = (container.firstElementChild as HTMLElement).className.split(/\s+/)
    expect(classes).toContain("bg-squelette-carte")
    expect(classes).not.toContain("bg-squelette")
  })
})

describe("TexteSquelette", () => {
  it("rend le texte factice en transparent, pulsation motion-safe", () => {
    render(<TexteSquelette>Poulet rôti aux herbes</TexteSquelette>)
    const el = screen.getByText("Poulet rôti aux herbes")
    const classes = el.className.split(/\s+/)
    expect(classes).toContain("text-transparent")
    expect(classes).toContain("select-none")
    expect(classes).toContain("motion-safe:animate-pulse")
    expect(classes).not.toContain("animate-pulse")
    expect(classes).toContain("bg-squelette")
  })

  it("sur=\"carte\" utilise la teinte carte", () => {
    render(<TexteSquelette sur="carte">Lundi</TexteSquelette>)
    expect(screen.getByText("Lundi").className).toContain("bg-squelette-carte")
  })
})

describe("EcranChargement", () => {
  it("avec enfants : un seul status, main#contenu, boîte étroite par défaut", () => {
    const { container } = render(
      <EcranChargement>
        <Squelette className="h-4 w-4" />
      </EcranChargement>,
    )
    expect(screen.getAllByRole("status")).toHaveLength(1)
    const main = container.querySelector("main#contenu") as HTMLElement
    expect(main).not.toBeNull()
    expect(main.className).toContain("min-h-dvh")
    expect(main.className).toContain("max-w-2xl")
    expect(main.className).toContain("p-4")
    expect(main.className).not.toContain("justify-center")
  })

  it("largeur pleine : pas de max-w-2xl", () => {
    const { container } = render(
      <EcranChargement largeur="pleine">
        <Squelette />
      </EcranChargement>,
    )
    expect((container.querySelector("main") as HTMLElement).className).not.toContain("max-w-2xl")
  })

  it("espacement remplace le padding par défaut", () => {
    const { container } = render(
      <EcranChargement espacement="px-4 py-6">
        <Squelette />
      </EcranChargement>,
    )
    const classes = (container.querySelector("main") as HTMLElement).className.split(/\s+/)
    expect(classes).toContain("px-4")
    expect(classes).toContain("py-6")
    expect(classes).not.toContain("p-4")
    expect(classes).not.toContain("md:p-8")
  })
})
