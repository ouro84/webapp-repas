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

function mock(foyers: { data: unknown; error: { message: string } | null } = { data: { jour_courses: 4 }, error: null }) {
  return creerSupabaseMock({
    tables: {
      foyers,
      cycle_courses: { data: null, error: null },
      // Écritures de coche : l'`updated_at` relu par `.select("updated_at")` (#362).
      etat_courses_article: { data: [{ updated_at: "2026-10-29T10:00:00Z" }], error: null },
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
      article: { nom: "Bougies", quantite: "", manuel: true, ref: "man:a1" },
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
      { ancre: "2026-10-29", cle: "carottes|g", quantite: 400, coche: true },
      { onConflict: "foyer_id,ancre,cle" },
    ])
    expect(resultat).toEqual({
      modifie: true,
      article: { nom: "carottes", quantite: "400 g", manuel: false, ref: "ing:carottes|g", coche: true },
    })
  })

  it("coche un article manuel : update de sa colonne coche", async () => {
    liste([ing("Bougies", 0, "piece", { categorie: "autre", source: "manuel", id: "a1", coche: false })])
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "bougies" }, JEUDI)
    expect(appels.find((a) => a.table === "article_manuel")!.ops).toEqual([
      ["update", { coche: true }],
      ["eq", "id", "a1"],
      ["select", "updated_at"],
    ])
  })

  it("coche: false décoche en conservant la ligne (upsert coche = false, #362)", async () => {
    liste([ing("carottes", 400, "g")], { "carottes|g": 400 })
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "carottes", coche: false }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops).toEqual([
      [
        "upsert",
        { ancre: "2026-10-29", cle: "carottes|g", quantite: 0, coche: false },
        { onConflict: "foyer_id,ancre,cle" },
      ],
      ["select", "updated_at"],
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
      coche: true,
    })
  })

  it("un libellé exact l'emporte sur une inclusion (« lait » vs « lait de coco »)", async () => {
    liste([ing("lait", 1, "l"), ing("lait de coco", 40, "cl")])
    const { client, appels } = mock()
    await cocherArticle(client, { libelle: "lait" }, JEUDI)
    expect(appels.find((a) => a.table === "etat_courses_article")!.ops[0][1]).toMatchObject({ cle: "lait|l" })
  })

  it("homonymes indiscernables (même nom, même quantité) : coche le premier non coché", async () => {
    const pile = (id: string, coche: boolean) =>
      ing("Piles", 0, "piece", { categorie: "autre", source: "manuel", id, coche })
    liste([pile("a1", true), pile("a2", false)])
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "piles" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: true })
    expect(appels.find((a) => a.table === "article_manuel")!.ops).toEqual([
      ["update", { coche: true }],
      ["eq", "id", "a2"],
      ["select", "updated_at"],
    ])
  })

  it("homonymes indiscernables tous déjà cochés : modifie false, rien écrit", async () => {
    const pile = (id: string) => ing("Piles", 0, "piece", { categorie: "autre", source: "manuel", id, coche: true })
    liste([pile("a1"), pile("a2")])
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "piles" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: false, article: { nom: "Piles", coche: true } })
    expect(appels.filter((a) => a.table === "article_manuel")).toEqual([])
  })

  it("avec ancre : coche dans ce cycle, même libellé du cycle courant non touché (#320, RG-85)", async () => {
    // Le cycle courant (29/10) et le suivant (05/11) portent « carottes » ; seul
    // le suivant est visé : la lecture est faite sur son ancre et la coche y est écrite.
    const lire = vi.spyOn(listeCoursesCycle, "chargerListeCoursesCycle").mockImplementation(async (_s, options) => {
      const ancre = options?.ancre ?? "2026-10-29"
      const quantite = ancre === "2026-11-05" ? 600 : 400
      return {
        ancre,
        longueur: 7,
        liste: { normal: [{ categorie: "legumes-fruits", ingredients: [ing("carottes", quantite, "g")] }], fondDePlacard: [] },
        coches: {},
      }
    })
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { libelle: "carottes", ancre: "2026-11-07" }, JEUDI)
    expect(lire).toHaveBeenCalledTimes(1)
    expect(lire.mock.calls[0][1]).toMatchObject({ ancre: "2026-11-05" })
    const ecritures = appels.filter((a) => a.table === "etat_courses_article")
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0].ops[0]).toEqual([
      "upsert",
      { ancre: "2026-11-05", cle: "carottes|g", quantite: 600, coche: true },
      { onConflict: "foyer_id,ancre,cle" },
    ])
    expect(resultat).toMatchObject({ modifie: true, article: { quantite: "600 g", coche: true } })
  })

  it("introuvable : ErreurOutil qui cite lire_liste_courses", async () => {
    liste([ing("carottes", 400, "g")])
    const { client } = mock()
    await expect(cocherArticle(client, { libelle: "chocolat" }, JEUDI)).rejects.toThrow("lire_liste_courses")
  })
})

describe("cocherArticle par ref (#372)", () => {
  it("deux « lait » (l et g) : la ref de l'un coche celui-là seul, sans candidats", async () => {
    liste([ing("lait", 1, "l"), ing("lait", 200, "g")])
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { ref: "ing:lait|g" }, JEUDI)
    const ecritures = appels.filter((a) => a.table === "etat_courses_article")
    expect(ecritures).toHaveLength(1)
    // RG-12 : quantité courante de la liste, comme le chemin par libellé.
    expect(ecritures[0].ops[0][1]).toEqual({ ancre: "2026-10-29", cle: "lait|g", quantite: 200, coche: true })
    expect(resultat).toEqual({
      modifie: true,
      article: { nom: "lait", quantite: "200 g", manuel: false, ref: "ing:lait|g", coche: true },
    })
  })

  it("ref et libellé contradictoires : la ref l'emporte", async () => {
    liste([ing("carottes", 400, "g"), ing("lait", 1, "l")])
    const { client, appels } = mock()
    await cocherArticle(client, { ref: "ing:lait|l", libelle: "carottes", quantite: "400 g" }, JEUDI)
    const ecritures = appels.filter((a) => a.table === "etat_courses_article")
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0].ops[0][1]).toMatchObject({ cle: "lait|l", quantite: 1 })
  })

  it("ref absente de la liste (cycle régénéré) : ErreurOutil, aucune écriture, pas de repli sur le libellé", async () => {
    liste([ing("lait", 1, "l")])
    const { client, appels } = mock()
    const appel = cocherArticle(client, { ref: "ing:lait|g", libelle: "lait" }, JEUDI)
    await expect(appel).rejects.toBeInstanceOf(ErreurOutil)
    await expect(appel).rejects.toThrow("Cet article n'est plus dans la liste.")
    expect(appels.filter((a) => a.table === "etat_courses_article" || a.table === "article_manuel")).toEqual([])
  })

  it("ref mal formée : ErreurOutil, aucune écriture", async () => {
    liste([ing("lait", 1, "l")])
    const { client, appels } = mock()
    await expect(cocherArticle(client, { ref: "lait|l" }, JEUDI)).rejects.toBeInstanceOf(ErreurOutil)
    expect(appels.filter((a) => a.table === "etat_courses_article")).toEqual([])
  })

  it("article manuel et ingrédient de même libellé : la ref vise le bon", async () => {
    const manuel = ing("Lait", 1, "l", { categorie: "autre", source: "manuel", id: "a1", coche: false })
    liste([ing("lait", 1, "l"), manuel])

    const viaManuel = mock()
    await cocherArticle(viaManuel.client, { ref: "man:a1" }, JEUDI)
    expect(viaManuel.appels.find((a) => a.table === "article_manuel")!.ops).toEqual([
      ["update", { coche: true }],
      ["eq", "id", "a1"],
      ["select", "updated_at"],
    ])
    expect(viaManuel.appels.filter((a) => a.table === "etat_courses_article")).toEqual([])

    const viaIngredient = mock()
    await cocherArticle(viaIngredient.client, { ref: "ing:lait|l" }, JEUDI)
    expect(viaIngredient.appels.find((a) => a.table === "etat_courses_article")!.ops[0][1]).toMatchObject({
      cle: "lait|l",
    })
    expect(viaIngredient.appels.filter((a) => a.table === "article_manuel")).toEqual([])
  })

  it("ref déjà cochée : modifie false, aucune écriture", async () => {
    liste([ing("lait", 1, "l")], { "lait|l": 1 })
    const { client, appels } = mock()
    const resultat = await cocherArticle(client, { ref: "ing:lait|l" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: false, article: { ref: "ing:lait|l", coche: true } })
    expect(appels.filter((a) => a.table === "etat_courses_article")).toEqual([])
  })

  it("ni ref ni libellé : ErreurOutil, rien lu ni écrit", async () => {
    const espion = vi.spyOn(listeCoursesCycle, "chargerListeCoursesCycle")
    const { client, appels } = mock()
    await expect(cocherArticle(client, {}, JEUDI)).rejects.toBeInstanceOf(ErreurOutil)
    expect(espion).not.toHaveBeenCalled()
    expect(appels.filter((a) => a.table === "etat_courses_article" || a.table === "article_manuel")).toEqual([])
  })
})

describe("sans ancre, jour de courses illisible (#360)", () => {
  // Avant #360, ces outils retombaient sur lundi et écrivaient dans un autre cycle.
  const FOYERS_KO = [
    { data: null, error: { message: "réseau coupé" } },
    { data: null, error: null },
  ]

  it("ajouterArticleCourses : rejet (pas une ErreurOutil), aucun article écrit", async () => {
    for (const foyers of FOYERS_KO) {
      const { client, appels } = mock(foyers)
      const appel = ajouterArticleCourses(client, { libelle: "Bougies" }, JEUDI)
      await expect(appel).rejects.toThrow()
      await expect(appel).rejects.not.toBeInstanceOf(ErreurOutil)
      expect(appels.filter((a) => a.table !== "foyers")).toEqual([])
    }
  })

  it("cocherArticle : rejet (pas une ErreurOutil), aucune lecture de liste ni coche", async () => {
    for (const foyers of FOYERS_KO) {
      const espion = vi.spyOn(listeCoursesCycle, "chargerListeCoursesCycle")
      const { client, appels } = mock(foyers)
      const appel = cocherArticle(client, { libelle: "tomate" }, JEUDI)
      await expect(appel).rejects.toThrow()
      await expect(appel).rejects.not.toBeInstanceOf(ErreurOutil)
      expect(espion).not.toHaveBeenCalled()
      expect(appels.filter((a) => a.table !== "foyers")).toEqual([])
    }
  })
})
