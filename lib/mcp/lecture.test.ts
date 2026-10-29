// Outils de lecture du serveur MCP (#305, US-51, RG-73, RG-78). Client
// Supabase injecté (client « par jeton » en vrai) ; le client navigateur est
// mocké pour LEVER, afin de prouver que seul le client injecté sert (RG-71).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import * as listeCoursesCycle from "@/lib/liste-courses-cycle"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { lireListeCourses, lirePlanning, lireRecette } from "@/lib/mcp/lecture"
import {
  creerSupabaseMock,
  filtre,
  type ConfigMock,
  type ReponseMock,
} from "@/tests/fixtures/supabase-mock"

// Jeudi 29 octobre 2026, jour de courses = jeudi (4) → cycle courant du
// 29/10 (W44) au 04/11 (W45).
const JEUDI = new Date(2026, 9, 29, 12)

type OptionsSlot = { type?: "diner" | "dejeuner"; personnes?: number; restes?: boolean; vegetarien?: boolean }

function slot(jour: string, recette: string, ingredient: string, o: OptionsSlot = {}) {
  return {
    jour,
    type_repas: o.type ?? "diner",
    personnes: o.personnes ?? 2,
    restes: o.restes ?? false,
    recette: {
      id: recette,
      nom: recette,
      temps_preparation: "rapide",
      vegetarien: o.vegetarien ?? false,
      accompagnement: null,
      saisons: null,
      etapes: ["Couper", "Cuire"],
      recette_ingredient: [
        { quantite: 200, unite: "g", ingredient: { nom: ingredient, categorie: "legumes-fruits", fond_de_placard: false } },
        { quantite: 1, unite: "cas", ingredient: { nom: "huile", categorie: "epicerie", fond_de_placard: true } },
      ],
    },
  }
}

let plannings: Record<string, unknown>

function reglages(maxDinerSemaine = "long") {
  return {
    user_id: "u1",
    personnes_defaut: 2,
    max_dejeuner_semaine: "long",
    max_diner_semaine: maxDinerSemaine,
    max_dejeuner_weekend: "long",
    max_diner_weekend: "long",
    vege_dejeuner_semaine: false,
    vege_diner_semaine: false,
    vege_dejeuner_weekend: false,
    vege_diner_weekend: false,
    mix_accompagnement_jour: false,
    saisonnalite: false,
    updated_at: "2026-10-01T00:00:00Z",
  }
}

function mock(tables: ConfigMock["tables"] = {}) {
  return creerSupabaseMock({
    tables: {
      foyers: { data: { jour_courses: 4 }, error: null },
      cycle_courses: { data: null, error: null },
      planning: (appel): ReponseMock => ({
        data: plannings[filtre(appel, "eq", "semaine") as string] ?? null,
        error: null,
      }),
      reglages: { data: null, error: null },
      article_manuel: {
        data: [
          { id: "m1", libelle: "Piles", quantite: null, unite: null, categorie: "epicerie", fond_de_placard: false, coche: false },
        ],
        error: null,
      },
      etat_courses_article: { data: [{ cle: "tomate|g", quantite: 400 }], error: null },
      ...tables,
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  plannings = {
    "2026-W44": {
      semaine: "2026-W44",
      updated_at: "2026-10-29T10:00:00Z",
      planning_slot: [
        slot("lundi", "lundi-passe", "navet"),
        slot("jeudi", "gratin", "tomate", { personnes: 4 }),
        slot("samedi", "salade", "concombre", { type: "dejeuner", vegetarien: true }),
        slot("samedi", "restes-gratin", "tomate", { restes: true }),
      ],
    },
    "2026-W45": {
      semaine: "2026-W45",
      updated_at: "2026-10-29T10:00:00Z",
      planning_slot: [slot("lundi", "soupe", "poireau")],
    },
  }
})

describe("lirePlanning (RG-73, RG-78)", () => {
  it("lirePlanning : cycle courant, repas avec date + créneau (RG-73)", async () => {
    const { client } = mock()
    const resultat = await lirePlanning(client, {}, JEUDI)
    expect(resultat.periode).toMatchObject({ du: "2026-10-29", au: "2026-11-04" })
    expect(resultat.repas.map((r) => [r.date, r.creneau, r.recette])).toEqual([
      ["2026-10-29", "soir", "gratin"],
      ["2026-10-31", "midi", "salade"],
      ["2026-10-31", "soir", "restes-gratin"],
      ["2026-11-02", "soir", "soupe"],
    ])
    expect(resultat.repas[0]).toEqual({
      date: "2026-10-29",
      creneau: "soir",
      jour: "jeudi",
      recette: "gratin",
      personnes: 4,
      restes: false,
      vegetarien: false,
      temps_preparation: "rapide",
    })
    expect(resultat.repas[1].vegetarien).toBe(true)
    expect(resultat.repas[2].restes).toBe(true)
  })

  it("lirePlanning : semaine ISO donnée → 7 dates de la semaine", async () => {
    const { client } = mock()
    const resultat = await lirePlanning(client, { semaine: "2026-W44" }, JEUDI)
    expect(resultat.periode).toMatchObject({ du: "2026-10-26", au: "2026-11-01" })
    expect(resultat.repas.map((r) => r.recette)).toEqual(["lundi-passe", "gratin", "salade", "restes-gratin"])
  })

  it("lirePlanning : créneau désactivé dans les réglages → absent (RG-46)", async () => {
    const { client } = mock({ reglages: { data: reglages("aucun"), error: null } })
    const resultat = await lirePlanning(client, { semaine: "2026-W44" }, JEUDI)
    // Dîners de semaine (lundi, jeudi) désactivés ; le week-end reste.
    expect(resultat.repas.map((r) => r.recette)).toEqual(["salade", "restes-gratin"])
  })

  it("lirePlanning : semaine mal formée / hors plage → ErreurOutil (message exact)", async () => {
    const { client } = mock()
    await expect(lirePlanning(client, { semaine: "2026-44" }, JEUDI)).rejects.toThrow(
      new ErreurOutil("Semaine invalide : utilise le format AAAA-Www (ex. 2026-W44).")
    )
    await expect(lirePlanning(client, { semaine: "2027-W30" }, JEUDI)).rejects.toThrow(
      "Cette date est hors de la plage consultable (12 semaines en arrière, 6 en avant). Choisis une date plus proche."
    )
  })
})

describe("lireListeCourses (RG-78)", () => {
  it("lireListeCourses : non cochés par défaut, groupés par libellé de catégorie, manuels inclus (RG-78)", async () => {
    const { client } = mock()
    const resultat = await lireListeCourses(client, {}, JEUDI)
    expect(resultat.cycle).toMatchObject({ du: "2026-10-29", au: "2026-11-04" })
    const noms = resultat.categories.flatMap((c) => c.articles.map((a) => a.nom))
    expect(noms).not.toContain("tomate") // cochée
    expect(resultat.categories.map((c) => c.categorie)).toEqual(["Légumes & Fruits", "Épicerie"])
    expect(resultat.categories[1].articles).toEqual([{ nom: "Piles", quantite: "", manuel: true }])
    expect(resultat.a_verifier_au_placard.map((a) => a.nom)).toEqual(["huile"])
    expect(resultat.nombre_articles).toBe(noms.length + resultat.a_verifier_au_placard.length)
  })

  it("lireListeCourses : inclure_coches → articles cochés présents avec coche: true", async () => {
    const { client } = mock()
    const resultat = await lireListeCourses(client, { inclure_coches: true }, JEUDI)
    const articles = resultat.categories.flatMap((c) => c.articles)
    expect(articles.find((a) => a.nom === "tomate")).toMatchObject({ coche: true, quantite: "400 g" })
    expect(articles.find((a) => a.nom === "poireau")).toMatchObject({ coche: false })
  })

  it("lireListeCourses : passe le client injecté à chargerListeCoursesCycle (jamais le défaut)", async () => {
    const espion = vi.spyOn(listeCoursesCycle, "chargerListeCoursesCycle")
    const { client } = mock()
    await lireListeCourses(client, {}, JEUDI)
    expect(espion).toHaveBeenCalledWith(client, { aujourdhui: JEUDI })
  })
})

describe("lireRecette (RG-73, RG-78)", () => {
  it("lireRecette : ingrédients à l'échelle des personnes du repas et étapes", async () => {
    const { client } = mock()
    const resultat = await lireRecette(client, { date: "2026-10-29", creneau: "soir" }, JEUDI)
    expect(resultat).toEqual({
      date: "2026-10-29",
      creneau: "soir",
      recette: "gratin",
      personnes: 4,
      restes: false,
      vegetarien: false,
      temps_preparation: "rapide",
      ingredients: [{ nom: "tomate", quantite: "400 g" }],
      a_verifier_au_placard: [{ nom: "huile", quantite: "2 c.à.s" }],
      etapes: ["Couper", "Cuire"],
    })
  })

  it("lireRecette : repas de restes → restes: true", async () => {
    const { client } = mock()
    const resultat = await lireRecette(client, { date: "2026-10-31", creneau: "soir" }, JEUDI)
    expect(resultat.restes).toBe(true)
  })

  it("lireRecette : aucun repas / créneau désactivé → ErreurOutil (message exact)", async () => {
    const message =
      "Aucun repas prévu le vendredi 30 octobre au soir. Appelle lire_planning pour voir les repas prévus."
    await expect(lireRecette(mock().client, { date: "2026-10-30", creneau: "soir" }, JEUDI)).rejects.toThrow(message)
    const desactive = mock({ reglages: { data: reglages("aucun"), error: null } }).client
    await expect(lireRecette(desactive, { date: "2026-10-29", creneau: "soir" }, JEUDI)).rejects.toThrow(
      "Aucun repas prévu le jeudi 29 octobre au soir. Appelle lire_planning pour voir les repas prévus."
    )
  })

  it("lireRecette : 2026-02-30, demain, 2027-12-01 → ErreurOutil (format ou plage)", async () => {
    const { client } = mock()
    for (const date of ["2026-02-30", "demain"]) {
      await expect(lireRecette(client, { date, creneau: "soir" }, JEUDI)).rejects.toThrow(
        "Date invalide : utilise le format AAAA-MM-JJ (ex. 2026-10-29)."
      )
    }
    await expect(lireRecette(client, { date: "2027-12-01", creneau: "soir" }, JEUDI)).rejects.toThrow(
      "Cette date est hors de la plage consultable (12 semaines en arrière, 6 en avant). Choisis une date plus proche."
    )
  })
})
