// Service serveur « liste de courses du cycle » (#304, pour lire_liste_courses
// du serveur MCP, RG-78). Client Supabase injecté ; le client navigateur est
// mocké pour LEVER, afin de prouver que seul le client injecté sert.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { chargerListeCoursesCycle } from "@/lib/liste-courses-cycle"
import {
  creerSupabaseMock,
  filtre,
  type ConfigMock,
  type ReponseMock,
} from "@/tests/fixtures/supabase-mock"

// Jeudi 29 octobre 2026, jour de courses du foyer = jeudi (4) → ancre
// 2026-10-29, cycle de 7 j sur 2026-W44 (jeu→dim) et 2026-W45 (lun→mer).
const JEUDI = new Date("2026-10-29T12:00:00Z")

function slot(jour: string, recette: string, ingredient: string) {
  return {
    jour,
    type_repas: "diner",
    personnes: 2,
    restes: false,
    recette: {
      id: recette,
      nom: recette,
      temps_preparation: "rapide",
      vegetarien: null,
      accompagnement: null,
      saisons: null,
      etapes: null,
      recette_ingredient: [
        {
          quantite: 1,
          unite: "piece",
          ingredient: { nom: ingredient, categorie: "legumes-fruits", fond_de_placard: false },
        },
      ],
    },
  }
}

const PLANNINGS: Record<string, unknown> = {
  "2026-W44": { semaine: "2026-W44", updated_at: "2026-10-29T10:00:00Z", planning_slot: [slot("jeudi", "a", "tomate")] },
  "2026-W45": { semaine: "2026-W45", updated_at: "2026-10-29T10:00:00Z", planning_slot: [slot("lundi", "b", "poireau")] },
}

function mock(tables: ConfigMock["tables"] = {}) {
  return creerSupabaseMock({
    tables: {
      foyers: { data: { jour_courses: 4 }, error: null },
      cycle_courses: { data: null, error: null },
      planning: (appel): ReponseMock => ({
        data: PLANNINGS[filtre(appel, "eq", "semaine") as string] ?? null,
        error: null,
      }),
      reglages: { data: null, error: null },
      article_manuel: {
        data: [
          {
            id: "m1",
            libelle: "Piles",
            quantite: null,
            unite: null,
            categorie: "epicerie",
            fond_de_placard: false,
            coche: false,
          },
        ],
        error: null,
      },
      etat_courses_article: { data: [{ cle: "tomate|piece", quantite: 1 }], error: null },
      ...tables,
    },
  })
}

function noms(liste: { normal: Array<{ ingredients: Array<{ nom: string }> }> }): string[] {
  return liste.normal.flatMap((l) => l.ingredients.map((i) => i.nom))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("chargerListeCoursesCycle", () => {
  it("cycle courant par défaut : ancre du jour de courses du foyer", async () => {
    const { client, appels } = mock()

    const r = await chargerListeCoursesCycle(client, { aujourdhui: JEUDI })

    expect(r.ancre).toBe("2026-10-29")
    expect(r.longueur).toBe(7)
    const semainesLues = appels
      .filter((a) => a.table === "planning")
      .map((a) => filtre(a, "eq", "semaine"))
    expect(semainesLues).toEqual(["2026-W44", "2026-W45"])
  })

  it("liste = ingrédients des repas du cycle + articles manuels", async () => {
    const r = await chargerListeCoursesCycle(mock().client, { aujourdhui: JEUDI })

    expect(noms(r.liste)).toEqual(expect.arrayContaining(["tomate", "poireau", "Piles"]))
  })

  it("coches de l'ancre renvoyées", async () => {
    const { client, appels } = mock()

    const r = await chargerListeCoursesCycle(client, { aujourdhui: JEUDI })

    expect(r.coches).toEqual({ "tomate|piece": 1 })
    for (const table of ["etat_courses_article", "article_manuel"]) {
      const appel = appels.find((a) => a.table === table)!
      expect(filtre(appel, "eq", "ancre")).toBe("2026-10-29")
    }
  })

  it("ancre explicite prioritaire", async () => {
    const { client, appels } = mock()

    const r = await chargerListeCoursesCycle(client, { ancre: "2026-11-05", aujourdhui: JEUDI })

    expect(r.ancre).toBe("2026-11-05")
    expect(appels.some((a) => a.table === "foyers")).toBe(false)
  })

  it("réglages illisibles : défauts appliqués", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = mock({ reglages: { data: null, error: { message: "boom" } } })

    const r = await chargerListeCoursesCycle(client, { aujourdhui: JEUDI })

    expect(noms(r.liste)).toEqual(expect.arrayContaining(["tomate", "poireau"]))
  })

  it("planning illisible : erreur propagée", async () => {
    const { client } = mock({ planning: { data: null, error: { message: "JWT expired" } } })

    await expect(chargerListeCoursesCycle(client, { aujourdhui: JEUDI })).rejects.toThrow(
      "Chargement du planning distant impossible : JWT expired"
    )
  })
})
