// Module feuille des dates ISO locales (#352) : extrait de lib/cycles.ts pour
// casser l'import circulaire cycles ↔ planning-affichage.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { depuisISO, versISO } from "@/lib/dates-iso"
import * as cycles from "@/lib/cycles"

// Chemins résolus depuis ce fichier (et non le cwd) : le test passe quel que
// soit le dossier d'où vitest est lancé.
const lireLib = (fichier: string) =>
  readFileSync(resolve(__dirname, "../lib", fichier), "utf8")

describe("lib/dates-iso", () => {
  it("aller-retour en heure locale, sans UTC", () => {
    const d = depuisISO("2026-11-05")
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 5, 0])
    expect(versISO(d)).toBe("2026-11-05")
    expect(versISO(new Date(2026, 0, 3, 23, 30))).toBe("2026-01-03")
  })

  it("lib/cycles les réexporte (aucun consommateur cassé)", () => {
    expect(cycles.depuisISO).toBe(depuisISO)
    expect(cycles.versISO).toBe(versISO)
  })

  it("module feuille : aucun import interne ; planning-affichage n'importe plus lib/cycles", () => {
    const feuille = lireLib("dates-iso.ts")
    expect(feuille).not.toMatch(/from\s+["']@\/lib\//)
    const affichage = lireLib("planning-affichage.ts")
    expect(affichage).not.toMatch(/from\s+["']@\/lib\/cycles["']/)
  })
})
