import { describe, it, expect } from "vitest"
import {
  datesDeSemaine, decalageCycles, enRangees, libelleJourAbrege, libelleJourComplet,
  libellePlageDates, libelleRelatifCycle,
} from "@/lib/planning-affichage"

describe("libellePlageDates (#352)", () => {
  it("même mois : mois cité une seule fois", () => {
    expect(libellePlageDates("2026-11-02", "2026-11-08")).toBe("du 2 au 8 novembre")
  })
  it("à cheval sur deux mois : les deux mois cités", () => {
    expect(libellePlageDates("2026-10-30", "2026-11-05")).toBe("du 30 octobre au 5 novembre")
  })
  it("à cheval sur deux années", () => {
    expect(libellePlageDates("2026-12-28", "2027-01-03")).toBe("du 28 décembre au 3 janvier")
  })
})

describe("libelleRelatifCycle (#352)", () => {
  it("cycle courant, suivant, précédent", () => {
    expect(libelleRelatifCycle(0)).toBe("Ce cycle")
    expect(libelleRelatifCycle(1)).toBe("Cycle suivant")
    expect(libelleRelatifCycle(-1)).toBe("Cycle précédent")
  })
  it("au-delà : pluriel", () => {
    expect(libelleRelatifCycle(3)).toBe("Dans 3 cycles")
    expect(libelleRelatifCycle(-2)).toBe("Il y a 2 cycles")
  })
})

describe("decalageCycles (#352)", () => {
  it("écart en pas de 7 jours", () => {
    expect(decalageCycles("2026-11-19", "2026-11-05")).toBe(2)
    expect(decalageCycles("2026-10-29", "2026-11-05")).toBe(-1)
  })
  it("même ancre : 0", () => {
    expect(decalageCycles("2026-11-05", "2026-11-05")).toBe(0)
  })
  it("robuste au changement d'heure (octobre) : arrondi", () => {
    expect(decalageCycles("2026-11-05", "2026-10-22")).toBe(2)
  })
})

describe("datesDeSemaine (#352)", () => {
  it("7 dates locales, lundi → dimanche", () => {
    expect(datesDeSemaine("2026-W45")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
      "2026-11-06", "2026-11-07", "2026-11-08",
    ])
  })
  it("semaine 53 : commence le 28 décembre 2026", () => {
    const dates = datesDeSemaine("2026-W53")
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe("2026-12-28")
    expect(dates[6]).toBe("2027-01-03")
  })
})

describe("libellés de jour (#352)", () => {
  it("libelleJourComplet : majuscule + mois court", () => {
    expect(libelleJourComplet("2026-11-02")).toBe("Lundi 2 nov.")
    expect(libelleJourComplet("2026-07-09")).toBe("Jeudi 9 juil.")
    expect(libelleJourComplet("2026-08-15")).toBe("Samedi 15 août")
  })
  it("libelleJourAbrege : jour court sans point + numéro", () => {
    expect(libelleJourAbrege("2026-11-02")).toBe("Lun 2")
    expect(libelleJourAbrege("2026-11-08")).toBe("Dim 8")
  })
})

describe("enRangees (#352)", () => {
  it("découpe par 7", () => {
    expect(enRangees([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([[1, 2, 3, 4, 5, 6, 7], [8, 9, 10]])
  })
  it("liste vide : aucune rangée", () => {
    expect(enRangees([])).toEqual([])
  })
  it("moins d'une rangée : une seule", () => {
    expect(enRangees([1, 2, 3, 4, 5])).toEqual([[1, 2, 3, 4, 5]])
  })
  it("taille personnalisée", () => {
    expect(enRangees([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
