// Raccourci « annuler » (US-09, RG-19), partagé par les vues Semaine et Cycle
// (#373) : Ctrl/Cmd+Z sans Maj, jamais dans un champ de saisie.

import { describe, expect, it } from "vitest"

import { estRaccourciAnnuler } from "@/lib/raccourci-annuler"

function touche(init: KeyboardEventInit, cible?: HTMLElement): KeyboardEvent {
  const e = new KeyboardEvent("keydown", init)
  if (cible) Object.defineProperty(e, "target", { value: cible })
  return e
}

describe("estRaccourciAnnuler", () => {
  it("Ctrl+Z et Cmd+Z (minuscule ou majuscule) : vrai", () => {
    expect(estRaccourciAnnuler(touche({ key: "z", ctrlKey: true }))).toBe(true)
    expect(estRaccourciAnnuler(touche({ key: "Z", metaKey: true }))).toBe(true)
  })

  it("sans modificateur, avec Maj (rétablir) ou une autre touche : faux", () => {
    expect(estRaccourciAnnuler(touche({ key: "z" }))).toBe(false)
    expect(estRaccourciAnnuler(touche({ key: "z", ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(estRaccourciAnnuler(touche({ key: "y", ctrlKey: true }))).toBe(false)
  })

  it("dans un champ de saisie : faux (annulation native du texte)", () => {
    const editable = document.createElement("div")
    Object.defineProperty(editable, "isContentEditable", { value: true })
    for (const cible of [document.createElement("input"), document.createElement("textarea"), editable]) {
      expect(estRaccourciAnnuler(touche({ key: "z", ctrlKey: true }, cible))).toBe(false)
    }
    expect(estRaccourciAnnuler(touche({ key: "z", ctrlKey: true }, document.createElement("button")))).toBe(true)
  })
})
