import { describe, it, expect } from "vitest"
import {
  ancreCourante, cycleDecale, joursDuCycle, semainesDuCycle,
  dateVersSemaineJour, libelleCycle, cyclesSelectionnables, LONGUEUR_DEFAUT,
} from "@/lib/cycles"

describe("ancreCourante", () => {
  it("renvoie aujourd'hui si on EST le jour de courses (jeudi=4)", () => {
    // jeudi 9 juillet 2026
    expect(ancreCourante(new Date("2026-07-09T10:00:00"), 4)).toBe("2026-07-09")
  })
  it("recule au dernier jour de courses passé (samedi → jeudi précédent)", () => {
    // samedi 11 juillet → dernier jeudi = 9 juillet
    expect(ancreCourante(new Date("2026-07-11T10:00:00"), 4)).toBe("2026-07-09")
  })
  it("la veille du jour de courses garde l'ancre de la semaine précédente", () => {
    // mercredi 8 juillet, jour de courses jeudi → ancre = jeudi 2 juillet
    expect(ancreCourante(new Date("2026-07-08T23:00:00"), 4)).toBe("2026-07-02")
  })
  it("défaut lundi (1) = début de semaine ISO", () => {
    // mercredi 8 juillet → lundi 6 juillet
    expect(ancreCourante(new Date("2026-07-08T10:00:00"), 1)).toBe("2026-07-06")
  })
})

describe("cycleDecale", () => {
  it("avance et recule de 7 jours", () => {
    expect(cycleDecale("2026-07-09", 1)).toBe("2026-07-16")
    expect(cycleDecale("2026-07-09", -1)).toBe("2026-07-02")
    expect(cycleDecale("2026-07-09", 0)).toBe("2026-07-09")
  })
})

describe("joursDuCycle", () => {
  it("longueur 7 = 7 dates consécutives", () => {
    expect(joursDuCycle("2026-07-09", 7)).toEqual([
      "2026-07-09","2026-07-10","2026-07-11","2026-07-12",
      "2026-07-13","2026-07-14","2026-07-15",
    ])
  })
  it("longueur 9 = 9 dates (étirement)", () => {
    expect(joursDuCycle("2026-07-09", 9)).toHaveLength(9)
    expect(joursDuCycle("2026-07-09", 9).at(-1)).toBe("2026-07-17")
  })
})

describe("semainesDuCycle", () => {
  it("un cycle jeudi→mercredi touche 2 semaines ISO", () => {
    expect(semainesDuCycle("2026-07-09", 7)).toEqual(["2026-W28", "2026-W29"])
  })
  it("un cycle lundi/7 ne touche qu'une semaine ISO (rétro-compat)", () => {
    expect(semainesDuCycle("2026-07-06", 7)).toEqual(["2026-W28"])
  })
})

describe("dateVersSemaineJour", () => {
  it("jeudi 9 juillet 2026 = semaine W28, jour jeudi", () => {
    expect(dateVersSemaineJour("2026-07-09")).toEqual({ semaine: "2026-W28", jour: "jeudi" })
  })
  it("dimanche 12 juillet 2026 = W28, dimanche", () => {
    expect(dateVersSemaineJour("2026-07-12")).toEqual({ semaine: "2026-W28", jour: "dimanche" })
  })
})

describe("libelleCycle", () => {
  it("formate la plage du cycle", () => {
    expect(libelleCycle("2026-07-09", 7)).toBe("Courses du 9 au 15 juillet")
  })
})

describe("cyclesSelectionnables", () => {
  it("borne -12 à +6 autour de l'ancre courante", () => {
    const opts = cyclesSelectionnables(new Date("2026-07-09T10:00:00"), 4)
    expect(opts).toHaveLength(19) // 12 passées + courante + 6 futures
    expect(opts.find((o) => o.offset === 0)?.ancre).toBe("2026-07-09")
  })
})

it("LONGUEUR_DEFAUT vaut 7", () => { expect(LONGUEUR_DEFAUT).toBe(7) })
