import { describe, it, expect } from "vitest"
import {
  delaiAtterrissage,
  delaiJour,
  delaiNom,
  jourAtterrissage,
} from "@/lib/choregraphie-generation"
import type { Jour } from "@/types"

const SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

describe("chorégraphie de génération (#337)", () => {
  it("stagger de 60 ms par jour, nom décalé de +80 ms", () => {
    expect(delaiJour(0)).toBe(0)
    expect(delaiJour(3)).toBe(180)
    expect(delaiNom(0)).toBe(80)
    expect(delaiNom(6)).toBe(440)
  })

  it("atterrissage après le dernier nom posé (≈ 660 ms pour 7 jours)", () => {
    expect(delaiAtterrissage(7)).toBe(660)
    expect(delaiAtterrissage(0)).toBe(0)
  })

  it("atterrit sur aujourd'hui quand la semaine générée est la courante", () => {
    const jeudi = new Date("2026-11-05T19:00:00") // 2026-W45
    expect(jourAtterrissage("2026-W45", SEMAINE, jeudi)).toBe("jeudi")
  })

  it("pas d'atterrissage pour une autre semaine ou un jour absent", () => {
    const samedi = new Date("2026-11-07T10:00:00")
    expect(jourAtterrissage("2026-W46", SEMAINE, samedi)).toBeNull()
    expect(jourAtterrissage("2026-W45", ["lundi", "mardi"], samedi)).toBeNull()
  })
})
