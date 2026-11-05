import { describe, it, expect } from "vitest"
import {
  prochainRepasActif,
  repasActifSuivant,
  semaineDuRepas,
  libelleContexteRepas,
  libelleMomentActuel,
} from "@/lib/prochain-repas"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import type { Planning, ReglagesGeneration } from "@/types"

function planningSemaine(semaine: string, jours: Planning["jours"]): Planning {
  return { semaine, jours }
}
function recette(id: string): NonNullable<Planning["jours"][number]["diner"]> {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] }
}

describe("prochainRepasActif", () => {
  it("avant 15h un jour de semaine : vise le déjeuner du jour", () => {
    const maintenant = new Date("2026-07-16T10:00:00") // jeudi 16 juillet 2026
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r).toEqual({
      dateISO: "2026-07-16",
      jour: "jeudi",
      typeRepas: "dejeuner",
      recette: recette("dej"),
      restes: false,
      personnes: 2,
    })
  })

  it("après 15h : vise le dîner du jour, pas le déjeuner du lendemain", () => {
    const maintenant = new Date("2026-07-16T18:00:00")
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toEqual(recette("din"))
  })

  it("créneau désactivé (« Aucun ») : saute au prochain créneau ACTIF", () => {
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" },
    }
    const maintenant = new Date("2026-07-16T10:00:00") // jeudi, déjeuner désactivé
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, reglages)
    // Le déjeuner du jeudi est désactivé → on saute directement au dîner du même jour.
    expect(r?.typeRepas).toBe("diner")
    expect(r?.dateISO).toBe("2026-07-16")
  })

  it("créneau actif mais sans recette planifiée → recette undefined (pas de saut)", () => {
    const maintenant = new Date("2026-07-16T10:00:00")
    const map = new Map<string, Planning>() // aucun planning chargé
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r).toEqual({
      dateISO: "2026-07-16",
      jour: "jeudi",
      typeRepas: "dejeuner",
      recette: undefined,
      restes: false,
      personnes: 2,
    })
  })

  it("restes : recette conservée dans le résultat, restes = true", () => {
    const maintenant = new Date("2026-07-16T18:00:00")
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        {
          jour: "jeudi",
          diner: recette("din"),
          restes: { diner: true },
        },
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r?.restes).toBe(true)
    expect(r?.recette).toEqual(recette("din")) // conservée malgré les restes
  })

  it("traverse la fin de semaine (samedi soir → dîner du samedi, actif par défaut)", () => {
    const maintenant = new Date("2026-07-18T22:00:00") // samedi soir, après 15h → dîner du samedi
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "samedi" }, // dîner du samedi actif (REGLAGES_DEFAUT) mais pas de recette
      ])],
    ])
    const r = prochainRepasActif(maintenant, map, REGLAGES_DEFAUT)
    expect(r?.dateISO).toBe("2026-07-18")
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toBeUndefined()
  })
})

describe("repasActifSuivant (#336, aperçu « Ensuite »)", () => {
  it("après un déjeuner : le dîner du même jour", () => {
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "jeudi", dejeuner: recette("dej"), diner: recette("din") },
      ])],
    ])
    const r = repasActifSuivant({ dateISO: "2026-07-16", typeRepas: "dejeuner" }, map, REGLAGES_DEFAUT)
    expect(r?.dateISO).toBe("2026-07-16")
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toEqual(recette("din"))
  })

  it("après un dîner : le déjeuner du lendemain", () => {
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "vendredi", dejeuner: recette("dej-ven") },
      ])],
    ])
    const r = repasActifSuivant({ dateISO: "2026-07-16", typeRepas: "diner" }, map, REGLAGES_DEFAUT)
    expect(r?.dateISO).toBe("2026-07-17")
    expect(r?.typeRepas).toBe("dejeuner")
    expect(r?.recette).toEqual(recette("dej-ven"))
  })

  it("saute les créneaux désactivés", () => {
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "aucun" },
    }
    const map = new Map([
      ["2026-W29", planningSemaine("2026-W29", [
        { jour: "vendredi", dejeuner: recette("dej-ven"), diner: recette("din-ven") },
      ])],
    ])
    // Jeudi soir → vendredi midi désactivé → vendredi soir.
    const r = repasActifSuivant({ dateISO: "2026-07-16", typeRepas: "diner" }, map, reglages)
    expect(r?.dateISO).toBe("2026-07-17")
    expect(r?.typeRepas).toBe("diner")
    expect(r?.recette).toEqual(recette("din-ven"))
  })

  it("dimanche soir → lundi midi de la semaine suivante", () => {
    const map = new Map([
      ["2026-W30", planningSemaine("2026-W30", [
        { jour: "lundi", dejeuner: recette("dej-lun") },
      ])],
    ])
    const r = repasActifSuivant({ dateISO: "2026-07-19", typeRepas: "diner" }, map, REGLAGES_DEFAUT)
    expect(r?.dateISO).toBe("2026-07-20")
    expect(r?.recette).toEqual(recette("dej-lun"))
  })

  it("créneau suivant sans recette : recette undefined (aperçu absent côté page)", () => {
    const r = repasActifSuivant({ dateISO: "2026-07-16", typeRepas: "dejeuner" }, new Map(), REGLAGES_DEFAUT)
    expect(r?.recette).toBeUndefined()
  })
})

describe("semaineDuRepas", () => {
  it("renvoie la semaine ISO du jour du repas", () => {
    expect(semaineDuRepas({ dateISO: "2026-07-19" })).toBe("2026-W29")
    expect(semaineDuRepas({ dateISO: "2026-07-20" })).toBe("2026-W30")
  })
})

describe("libelleContexteRepas", () => {
  const maintenant = new Date("2026-07-16T10:00:00") // jeudi 16 juillet

  it("aujourd'hui, dîner → « Dîner de ce soir »", () => {
    expect(libelleContexteRepas("2026-07-16", "diner", maintenant)).toBe("Dîner de ce soir")
  })
  it("aujourd'hui, déjeuner → « Déjeuner de ce midi »", () => {
    expect(libelleContexteRepas("2026-07-16", "dejeuner", maintenant)).toBe("Déjeuner de ce midi")
  })
  it("demain → « Dîner de demain »", () => {
    expect(libelleContexteRepas("2026-07-17", "diner", maintenant)).toBe("Dîner de demain")
  })
  it("au-delà → date complète", () => {
    expect(libelleContexteRepas("2026-07-20", "diner", maintenant)).toBe(
      "Dîner du lundi 20 juillet"
    )
  })
})

describe("libelleMomentActuel", () => {
  it("avant le seuil (~15h) → « Ce midi »", () => {
    expect(libelleMomentActuel(new Date("2026-07-16T10:00:00"))).toBe("Ce midi")
  })
  it("après le seuil → « Ce soir »", () => {
    expect(libelleMomentActuel(new Date("2026-07-16T18:00:00"))).toBe("Ce soir")
  })
})
