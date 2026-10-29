// Outils MCP ajouter_article_courses et cocher_article (#306, RG-77). Client
// injecté ; client navigateur mocké pour lever (RG-71).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import * as listeCoursesCycle from "@/lib/liste-courses-cycle"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { ajouterArticleCourses, cocherArticle } from "@/lib/mcp/ecriture-courses"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"
import type { Ingredient } from "@/types"

// Jeudi 29 octobre 2026, jour de courses jeudi → ancre 2026-10-29.
const JEUDI = new Date(2026, 9, 29, 12)

function mock() {
  return creerSupabaseMock({
    tables: {
      foyers: { data: { jour_courses: 4 }, error: null },
      cycle_courses: { data: null, error: null },
      article_manuel: {
        data: { id: "a1", libelle: "Bougies", quantite: null, unite: null, categorie: "autre", fond_de_placard: false, coche: false },
        error: null,
      },
    },
  })
}

const ing = (nom: string, quantite: number, unite: Ingredient["unite"], modif: Partial<Ingredient> = {}): Ingredient => ({
  nom,
  quantite,
  unite,
  categorie: "legumes-fruits",
  fondDePlacard: false,
  ...modif,
})

function liste(ingredients: Ingredient[], coches: Record<string, number> = {}) {
  vi.spyOn(listeCoursesCycle, "chargerListeCoursesCycle").mockResolvedValue({
    ancre: "2026-10-29",
    longueur: 7,
    liste: { normal: [{ categorie: "legumes-fruits", ingredients }], fondDePlacard: [] },
    coches,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("ajouterArticleCourses (RG-77, #216)", () => {
  it("ajoute un article manuel au cycle courant, catégorie « autre » par défaut", async () => {
    const { client, appels } = mock()
    const resultat = await ajouterArticleCourses(client, { libelle: "  Bougies " }, JEUDI)
    const insert = appels.find((a) => a.table === "article_manuel")!.ops[0]
    expect(insert).toEqual([
      "insert",
      { ancre: "2026-10-29", libelle: "Bougies", quantite: null, unite: null, categorie: "autre", fond_de_placard: false },
    ])
    expect(resultat).toEqual({
      article: { nom: "Bougies", quantite: "", manuel: true },
      periode: { du: "2026-10-29", au: "2026-11-04", libelle: "du 29 octobre au 4 novembre" },
    })
  })

  it("quantité non positive : ignorée comme dans le formulaire", async () => {
    const { client, appels } = mock()
    await ajouterArticleCourses(client, { libelle: "Piles", quantite: 0, unite: "piece" }, JEUDI)
    expect(appels.find((a) => a.table === "article_manuel")!.ops[0][1]).toMatchObject({ quantite: null, unite: "piece" })
  })

  it("libellé vide ou de plus de 200 caractères : ErreurOutil, rien écrit", async () => {
    for (const libelle of ["  ", "x".repeat(201)]) {
      const { client, appels } = mock()
      await expect(ajouterArticleCourses(client, { libelle }, JEUDI)).rejects.toBeInstanceOf(ErreurOutil)
      expect(appels.filter((a) => a.table === "article_manuel")).toEqual([])
    }
  })
})

describe("cocherArticle (RG-77, RG-10, RG-12)", () => {
  it("coche un ingrédient de recette : upsert de la clé nom|unité et de sa quantité", async () => {
    liste([ing("carottes", 400, "g")])
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "Carottes" }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops[0]).toEqual([
      "upsert",
      { ancre: "2026-10-29", cle: "carottes|g", quantite: 400 },
      { onConflict: "foyer_id,ancre,cle" },
    ])
    expect(resultat).toEqual({ modifie: true, article: { nom: "carottes", quantite: "400 g", manuel: false, coche: true } })
  })

  it("coche un article manuel : update de sa colonne coche", async () => {
    liste([ing("Bougies", 0, "piece", { categorie: "autre", source: "manuel", id: "a1", coche: false })])
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "bougies" }, JEUDI)
    expect(appels.find((a) => a.table === "article_manuel")!.ops).toEqual([["update", { coche: true }], ["eq", "id", "a1"]])
  })

  it("coche: false décoche (delete de la ligne)", async () => {
    liste([ing("carottes", 400, "g")], { "carottes|g": 400 })
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "carottes", coche: false }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops).toEqual([
      ["delete"],
      ["eq", "ancre", "2026-10-29"],
      ["eq", "cle", "carottes|g"],
    ])
  })

  it("déjà dans l'état visé : modifie false, aucune écriture", async () => {
    liste([ing("carottes", 400, "g")], { "carottes|g": 400 })
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "carottes" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: false, article: { coche: true } })
    expect(appels.filter((a) => a.table === "etat_courses_article")).toEqual([])
  })

  it("même nom, deux unités : candidats, rien coché", async () => {
    liste([ing("oignon", 3, "piece"), ing("oignon", 200, "g")])
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "oignon" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: false })
    expect("candidats" in resultat && resultat.candidats.map((c) => c.quantite)).toEqual(["3", "200 g"])
    expect(appels.filter((a) => a.table === "etat_courses_article")).toEqual([])
  })

  it("quantite lève l'ambiguïté", async () => {
    liste([ing("oignon", 3, "piece"), ing("oignon", 200, "g")])
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "oignon", quantite: "200 g" }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops[0][1]).toEqual({
      ancre: "2026-10-29",
      cle: "oignon|g",
      quantite: 200,
    })
  })

  it("un libellé exact l'emporte sur une inclusion (« lait » vs « lait de coco »)", async () => {
    liste([ing("lait", 1, "l"), ing("lait de coco", 40, "cl")])
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "lait" }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops[0][1]).toMatchObject({ cle: "lait|l" })
  })

  it("introuvable : ErreurOutil qui cite lire_liste_courses", async () => {
    liste([ing("carottes", 400, "g")])
    const { client } = mock()
    await expect(cocherArticle(client, { libelle: "chocolat" }, JEUDI)).rejects.toThrow("lire_liste_courses")
  })
})
