import { describe, it, expect } from "vitest"
import {
  ancreCourante, ancreDeSemaine, ancreParDefaut, cycleDecale, joursDuCycle, semainesDuCycle,
  cycleTermine, dateVersSemaineJour, estDateISO, libelleCycle, cyclesSelectionnables, LONGUEUR_DEFAUT,
  planningDuCycle, planningGenereParSemaine, remplacerJourDansSemaines,
} from "@/lib/cycles"
import type { JourPlanning, Planning } from "@/types"
import { genererListeCourses } from "@/lib/courses"
import { semaineISO } from "@/lib/semaines"

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

describe("ancreParDefaut", () => {
  it("en semaine, vaut ancreCourante (aucun décalage)", () => {
    // mercredi 8 juillet, jour de courses lundi → lundi 6 juillet (= ancreCourante)
    const j = new Date("2026-07-08T10:00:00")
    expect(ancreParDefaut(j, 1)).toBe(ancreCourante(j, 1))
    expect(ancreParDefaut(j, 1)).toBe("2026-07-06")
  })
  it("le SAMEDI, décale d'un cycle (la génération vise la semaine prochaine)", () => {
    // samedi 4 juillet, jour de courses lundi : ancreCourante = lundi 29 juin ;
    // ancreParDefaut = lundi suivant 6 juillet (couvre la semaine générée).
    expect(ancreCourante(new Date("2026-07-04T10:00:00"), 1)).toBe("2026-06-29")
    expect(ancreParDefaut(new Date("2026-07-04T10:00:00"), 1)).toBe("2026-07-06")
  })
  it("le DIMANCHE, décale aussi d'un cycle", () => {
    // dimanche 5 juillet, jour de courses lundi → lundi 6 juillet
    expect(ancreParDefaut(new Date("2026-07-05T10:00:00"), 1)).toBe("2026-07-06")
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

describe("planningDuCycle", () => {
  const recette = (nom: string) => ({
    id: nom, nom, tempsPreparation: "rapide" as const,
    ingredients: [{ nom: "pâtes", quantite: 200, unite: "g" as const,
      categorie: "epicerie" as const, fondDePlacard: false }],
  })

  const w28: Planning = { semaine: "2026-W28", jours: [
    { jour: "jeudi" as const, diner: recette("A") },
    { jour: "vendredi" as const, diner: recette("B") },
  ]}
  const w29: Planning = { semaine: "2026-W29", jours: [
    { jour: "lundi" as const, diner: recette("C") },
    { jour: "mardi" as const, diner: recette("D") },
  ]}

  it("recolle les jours des 2 semaines dans la fenêtre, sans reliquat", () => {
    const p = planningDuCycle([w28, w29], "2026-07-09", 7) // jeudi 9 → mercredi 15
    const jours = p.jours.map((j) => j.jour)
    // jeudi/vendredi (W28) + lundi/mardi (W29) ; PAS lundi..mercredi de W28
    expect(jours).toEqual(["jeudi", "vendredi", "lundi", "mardi"])
  })

  it("produit une seule liste de courses agrégée sur la fenêtre", () => {
    const p = planningDuCycle([w28, w29], "2026-07-09", 7)
    const liste = genererListeCourses(p)
    const epicerie = liste?.normal.find((c) => c.categorie === "epicerie")
    // 4 dîners × 200 g de pâtes = 800 g
    expect(epicerie?.ingredients[0].quantite).toBe(800)
  })

  it("jours hors planning omis (cycle partiellement vide)", () => {
    const p = planningDuCycle([w28], "2026-07-09", 7)
    expect(p.jours.map((j) => j.jour)).toEqual(["jeudi", "vendredi"])
  })
})

describe("planningGenereParSemaine (#259)", () => {
  const recette = (nom: string) => ({
    id: nom, nom, tempsPreparation: "rapide" as const, ingredients: [],
  })
  // Planning GÉNÉRÉ d'une semaine ISO : keyé par jour de semaine (7 jours).
  const genere: Planning = {
    semaine: "2026-W28",
    jours: (["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"] as const)
      .map((jour) => ({ jour, diner: recette(jour), dejeuner: recette(`${jour}-dej`) })),
  }

  it("un cycle lundi/7 (rétro-compat) → 1 semaine, 7 jours", () => {
    const m = planningGenereParSemaine(genere, "2026-07-06", 7) // lundi 6 juillet
    expect([...m.keys()]).toEqual(["2026-W28"])
    expect(m.get("2026-W28")!.map((j) => j.jour)).toEqual([
      "lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche",
    ])
  })

  it("un cycle jeudi→mercredi → 2 semaines ISO, jours répartis, sans reliquat", () => {
    const m = planningGenereParSemaine(genere, "2026-07-09", 7) // jeudi 9 → mercredi 15
    expect([...m.keys()]).toEqual(["2026-W28", "2026-W29"])
    // W28 = jeudi/vendredi/samedi/dimanche ; W29 = lundi/mardi/mercredi.
    expect(m.get("2026-W28")!.map((j) => j.jour)).toEqual([
      "jeudi","vendredi","samedi","dimanche",
    ])
    expect(m.get("2026-W29")!.map((j) => j.jour)).toEqual([
      "lundi","mardi","mercredi",
    ])
  })

  it("ne duplique pas un même (semaine, jour) au sein d'une semaine", () => {
    const m = planningGenereParSemaine(genere, "2026-07-06", 7)
    const jours = m.get("2026-W28")!.map((j) => j.jour)
    expect(new Set(jours).size).toBe(jours.length)
  })
})

describe("ancreDeSemaine", () => {
  it("trouve l'ancre du cycle qui contient la semaine (jour de courses AVANT jeudi)", () => {
    // Semaine 2026-W28 = lundi 6 juillet → dimanche 12 juillet. Jour de courses
    // lundi (1) : l'ancre de cette semaine est son propre lundi.
    expect(ancreDeSemaine("2026-W28", 1)).toBe("2026-07-06")
  })
  it("trouve l'ancre du cycle qui contient la semaine (jour de courses APRÈS jeudi)", () => {
    // Jour de courses vendredi (5) : le jeudi de 2026-W28 (9 juillet) est APRÈS
    // le dernier vendredi (3 juillet, semaine précédente) → l'ancre est ce
    // vendredi-là, pas un vendredi de cette semaine.
    expect(ancreDeSemaine("2026-W28", 5)).toBe("2026-07-03")
  })
  it("cohérent avec ancreCourante sur le jeudi de la semaine (référence commune)", () => {
    // Le jeudi est LA référence de la fonction (cf. commentaire d'implémentation) :
    // une semaine dont le jourCourses tombe pile un jeudi n'est pas ambiguë —
    // contrairement à un autre jour de la semaine, qui pourrait tomber dans le
    // cycle précédent OU suivant selon jourCourses (cf. les 2 tests ci-dessus).
    const jeudi = new Date("2026-07-09T10:00:00") // jeudi 2026-W28
    const semaine = semaineISO(jeudi)
    expect(ancreDeSemaine(semaine, 4)).toBe(ancreCourante(jeudi, 4))
  })
})

describe("remplacerJourDansSemaines (#301)", () => {
  const r = (id: string) => ({ id, nom: id, tempsPreparation: "rapide" as const, ingredients: [] })
  const lundiW12: JourPlanning = { jour: "lundi", diner: r("ancien") }
  const mardiW12: JourPlanning = { jour: "mardi", diner: r("mardi") }
  const w13: Planning = { semaine: "2026-W13", jours: [{ jour: "lundi", diner: r("w13") }] }
  const entree = (): Map<string, Planning> =>
    new Map([
      ["2026-W12", { semaine: "2026-W12", jours: [lundiW12, mardiW12] }],
      ["2026-W13", w13],
    ])

  it("remplace le jour ciblé sans muter l'entrée ni toucher les autres jours/semaines", () => {
    const avant = entree()
    const nouveau: JourPlanning = { jour: "lundi", diner: r("nouveau"), personnes: { diner: 4 } }

    const resultat = remplacerJourDansSemaines(avant, "2026-W12", nouveau)

    expect(resultat.get("2026-W12")!.jours.find((j) => j.jour === "lundi")).toBe(nouveau)
    expect(resultat.get("2026-W12")!.jours.find((j) => j.jour === "mardi")).toBe(mardiW12)
    expect(resultat.get("2026-W13")).toBe(w13)
    expect(avant.get("2026-W12")!.jours.find((j) => j.jour === "lundi")).toBe(lundiW12)
    expect(resultat).not.toBe(avant)
  })

  it("semaine absente → contenu identique", () => {
    const avant = entree()

    const resultat = remplacerJourDansSemaines(avant, "2026-W20", { jour: "lundi", diner: r("x") })

    expect([...resultat.entries()]).toEqual([...avant.entries()])
  })
})

describe("estDateISO", () => {
  it("accepte une date AAAA-MM-JJ qui existe au calendrier", () => {
    expect(estDateISO("2026-10-29")).toBe(true)
    expect(estDateISO("2028-02-29")).toBe(true)
  })

  it("refuse un format autre ou une date impossible", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-2-3", "29/10/2026"]) {
      expect(estDateISO(date)).toBe(false)
    }
  })
})

describe("cycleTermine (#320, RG-81)", () => {
  // Aujourd'hui = jeudi 29 octobre 2026, à l'heure locale.
  const AUJOURDHUI = new Date(2026, 9, 29, 10, 0)

  it("la veille du début du cycle → non terminé (cycle à venir)", () => {
    expect(cycleTermine("2026-10-30", 7, AUJOURDHUI)).toBe(false)
  })

  it("dernier jour = aujourd'hui → non terminé", () => {
    // 23 oct + 7 jours → dernier jour = 29 oct.
    expect(cycleTermine("2026-10-23", 7, AUJOURDHUI)).toBe(false)
  })

  it("dernier jour = hier → terminé", () => {
    // 22 oct + 7 jours → dernier jour = 28 oct.
    expect(cycleTermine("2026-10-22", 7, AUJOURDHUI)).toBe(true)
  })

  it("cycle de 5 jours : le dernier jour compte, pas ancre + 7", () => {
    // 24 oct + 5 jours → dernier jour = 28 oct (terminé) ; sur 7 jours il courrait encore.
    expect(cycleTermine("2026-10-24", 5, AUJOURDHUI)).toBe(true)
    expect(cycleTermine("2026-10-25", 5, AUJOURDHUI)).toBe(false)
  })

  it("cycle en cours (aujourd'hui au milieu) → non terminé", () => {
    expect(cycleTermine("2026-10-27", 7, AUJOURDHUI)).toBe(false)
  })
})
