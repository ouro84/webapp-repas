import { describe, it, expect } from "vitest"
import {
  JOUR_COURSES_PROPOSE,
  PARAM_BIENVENUE,
  joursAPartirDe,
  midiSemaineDepuisReglages,
  premierCycle,
  reglagesInitiaux,
  urlFinOnboarding,
} from "@/lib/onboarding"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import type { SemaineGeneree } from "@/types"

describe("constantes", () => {
  it("proposent le samedi comme jour de courses et le paramètre « bienvenue »", () => {
    expect(JOUR_COURSES_PROPOSE).toBe(6)
    expect(PARAM_BIENVENUE).toBe("bienvenue")
  })
})

describe("reglagesInitiaux", () => {
  it("désactive le déjeuner de semaine quand midiSemaine est faux", () => {
    const r = reglagesInitiaux({ personnes: 4, vege: false, midiSemaine: false })
    expect(r.plafonds).toEqual({ ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" })
    expect(r.personnesDefaut).toBe(4)
    expect(r.vegetarienPrefere).toBeUndefined()
  })

  it("garde les plafonds par défaut et pose le végé en semaine seulement", () => {
    const r = reglagesInitiaux({ personnes: 2, vege: true, midiSemaine: true })
    expect(r.plafonds).toEqual(REGLAGES_DEFAUT.plafonds)
    expect(r.vegetarienPrefere).toEqual({
      dejeunerSemaine: true,
      dinerSemaine: true,
      dejeunerWeekend: false,
      dinerWeekend: false,
    })
  })
})

describe("midiSemaineDepuisReglages", () => {
  it("vaut vrai sans réglages enregistrés", () => {
    expect(midiSemaineDepuisReglages(null)).toBe(true)
  })

  it("vaut faux quand le déjeuner de semaine est « aucun »", () => {
    const r = { ...REGLAGES_DEFAUT, plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" as const } }
    expect(midiSemaineDepuisReglages(r)).toBe(false)
  })

  it("vaut vrai quand le déjeuner de semaine est « normal »", () => {
    const r = { ...REGLAGES_DEFAUT, plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "normal" as const } }
    expect(midiSemaineDepuisReglages(r)).toBe(true)
  })
})

describe("joursAPartirDe", () => {
  // Cycle samedi 4 → vendredi 10 juillet 2026.
  const cycle: SemaineGeneree[] = [
    { semaine: "2026-W27", jours: [{ jour: "samedi" }, { jour: "dimanche" }] },
    {
      semaine: "2026-W28",
      jours: [
        { jour: "lundi" }, { jour: "mardi" }, { jour: "mercredi" }, { jour: "jeudi" }, { jour: "vendredi" },
      ],
    },
  ]

  it("retire les jours passés et les semaines devenues vides", () => {
    const res = joursAPartirDe(cycle, "2026-07-08")
    expect(res).toHaveLength(1)
    expect(res[0].semaine).toBe("2026-W28")
    expect(res[0].jours.map((j) => j.jour)).toEqual(["mercredi", "jeudi", "vendredi"])
  })

  it("garde tout le cycle le jour de l’ancre", () => {
    expect(joursAPartirDe(cycle, "2026-07-04")).toEqual(cycle)
  })

  it("garde tout un cycle entièrement futur, jamais []", () => {
    expect(joursAPartirDe(cycle, "2026-07-02")).toEqual(cycle)
  })
})

describe("premierCycle", () => {
  it("vise le cycle suivant quand il reste 2 jours ou moins (jeudi, courses le samedi)", () => {
    expect(premierCycle(new Date("2026-07-09T10:00:00"), 6)).toEqual({ ancre: "2026-07-11", longueur: 7 })
  })
})

describe("urlFinOnboarding", () => {
  it("n’ajoute le paramètre que pour un foyer solo dont la génération a réussi", () => {
    expect(urlFinOnboarding({ solo: true, generationReussie: true })).toBe("/planning?bienvenue=1")
    expect(urlFinOnboarding({ solo: true, generationReussie: false })).toBe("/planning")
    expect(urlFinOnboarding({ solo: false, generationReussie: true })).toBe("/planning")
    expect(urlFinOnboarding({ solo: false, generationReussie: false })).toBe("/planning")
  })
})
