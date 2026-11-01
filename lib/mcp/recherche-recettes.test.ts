// Outil MCP `chercher_recettes` (#320, RG-85). Client Supabase injecté (client
// « par jeton » en vrai) ; le client navigateur est mocké pour LEVER, afin de
// prouver que seul le client injecté sert (RG-71).

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { chercherRecettes, idsRecettesDuFoyer } from "@/lib/mcp/recherche-recettes"
import { creerSupabaseMock, filtre, type AppelTable, type ReponseMock } from "@/tests/fixtures/supabase-mock"

type Brut = {
  id: string
  nom: string
  temps_preparation?: "rapide" | "normal" | "long"
  vegetarien?: boolean
  accompagnement?: "feculents" | "legumes" | null
  saisons?: string[] | null
}

function dbRecette(r: Brut) {
  return {
    id: r.id,
    nom: r.nom,
    temps_preparation: r.temps_preparation ?? "rapide",
    vegetarien: r.vegetarien ?? false,
    accompagnement: r.accompagnement ?? null,
    saisons: r.saisons ?? null,
    etapes: null,
    recette_ingredient: [],
  }
}

// `idsFoyer` : ids des recettes du foyer (foyer_id non nul) ; `masquees` : ids
// de `recette_masquee`.
function mock(recettes: Brut[], idsFoyer: string[] = [], masquees: string[] = []) {
  return creerSupabaseMock({
    tables: {
      recette: (appel: AppelTable): ReponseMock =>
        filtre(appel, "not", "foyer_id") !== undefined
          ? { data: idsFoyer.map((id) => ({ id })), error: null }
          : { data: recettes.map(dbRecette), error: null },
      recette_masquee: { data: masquees.map((recette_id) => ({ recette_id })), error: null },
    },
  }).client
}

// PRNG déterministe (mulberry32), comme `rngSeed` de lib/generateur.test.ts.
function rngSeed(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("chercherRecettes (#320, RG-85)", () => {
  it("filtres combinés (ET) : rapide + végé + légumes", async () => {
    const client = mock([
      { id: "a", nom: "Ratatouille", vegetarien: true, accompagnement: "legumes" },
      { id: "b", nom: "Gratin dauphinois", vegetarien: true, accompagnement: "feculents" },
      { id: "c", nom: "Poulet rôti", vegetarien: false, accompagnement: "legumes" },
      { id: "d", nom: "Curry de légumes", vegetarien: true, accompagnement: "legumes", temps_preparation: "long" },
    ])
    const r = await chercherRecettes(client, { temps_preparation: "rapide", vegetarien: true, accompagnement: "legumes" })
    expect(r.recettes.map((x) => x.nom)).toEqual(["Ratatouille"])
    expect(r.total).toBe(1)
  })

  it("vegetarien: false ne garde que les recettes non végétariennes", async () => {
    const client = mock([
      { id: "a", nom: "Ratatouille", vegetarien: true },
      { id: "c", nom: "Poulet rôti", vegetarien: false },
    ])
    const r = await chercherRecettes(client, { vegetarien: false })
    expect(r.recettes.map((x) => x.nom)).toEqual(["Poulet rôti"])
  })

  it("saison : une recette sans saison déclarée passe pour toute saison", async () => {
    const client = mock([
      { id: "a", nom: "Toute l’année", saisons: null },
      { id: "b", nom: "Soupe d’hiver", saisons: ["hiver"] },
      { id: "c", nom: "Salade d’été", saisons: ["ete"] },
    ])
    const r = await chercherRecettes(client, { saison: "hiver" })
    expect(r.recettes.map((x) => x.nom)).toEqual(["Soupe d’hiver", "Toute l’année"])
    expect(r.recettes.find((x) => x.nom === "Toute l’année")!.saisons).toEqual([])
    expect(r.recettes.find((x) => x.nom === "Soupe d’hiver")!.saisons).toEqual(["hiver"])
  })

  it("texte : casse et accents ignorés", async () => {
    const client = mock([
      { id: "a", nom: "Pâtes à la crème" },
      { id: "b", nom: "Poulet rôti" },
    ])
    const r = await chercherRecettes(client, { texte: "PATES" })
    expect(r.recettes.map((x) => x.nom)).toEqual(["Pâtes à la crème"])
    const r2 = await chercherRecettes(client, { texte: "crème" })
    expect(r2.recettes.map((x) => x.nom)).toEqual(["Pâtes à la crème"])
  })

  it("masquée exclue", async () => {
    const client = mock(
      [
        { id: "a", nom: "Ratatouille" },
        { id: "b", nom: "Gratin" },
      ],
      [],
      ["b"]
    )
    const r = await chercherRecettes(client, {})
    expect(r.recettes.map((x) => x.nom)).toEqual(["Ratatouille"])
    expect(r.total).toBe(1)
  })

  it("origine : foyer si foyer_id non nul, sinon catalogue", async () => {
    const client = mock(
      [
        { id: "a", nom: "Ma recette" },
        { id: "b", nom: "Recette du catalogue" },
      ],
      ["a"]
    )
    const r = await chercherRecettes(client, {})
    expect(r.recettes.find((x) => x.nom === "Ma recette")!.origine).toBe("foyer")
    expect(r.recettes.find((x) => x.nom === "Recette du catalogue")!.origine).toBe("catalogue")
  })

  it("renvoie les attributs de chaque recette", async () => {
    const client = mock([
      { id: "a", nom: "Ratatouille", vegetarien: true, accompagnement: "legumes", temps_preparation: "normal", saisons: ["ete"] },
    ])
    const r = await chercherRecettes(client, {})
    expect(r.recettes).toEqual([
      {
        nom: "Ratatouille",
        temps_preparation: "normal",
        vegetarien: true,
        accompagnement: "legumes",
        saisons: ["ete"],
        origine: "catalogue",
      },
    ])
  })

  it("plus de 10 correspondances : 10 renvoyées, total exact, triées par nom, deux graines → deux sélections", async () => {
    const brutes = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      nom: `Plat ${String(i + 1).padStart(2, "0")}`,
    }))
    const client = mock(brutes)
    const un = await chercherRecettes(client, {}, rngSeed(1))
    const deux = await chercherRecettes(client, {}, rngSeed(2))
    for (const r of [un, deux]) {
      expect(r.recettes).toHaveLength(10)
      expect(r.total).toBe(30)
      const noms = r.recettes.map((x) => x.nom)
      expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, "fr")))
      expect(new Set(noms).size).toBe(10) // sans remise
    }
    expect(un.recettes.map((x) => x.nom)).not.toEqual(deux.recettes.map((x) => x.nom))
  })

  it("aleatoire() renvoyant 1 ne sort pas du tableau (tirage borné)", async () => {
    const client = mock(Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, nom: `Plat ${String(i).padStart(2, "0")}` })))
    const r = await chercherRecettes(client, {}, () => 1)
    expect(r.recettes).toHaveLength(10)
    expect(r.recettes.every((x) => typeof x.nom === "string")).toBe(true)
  })

  it("exactement 10 correspondances : toutes renvoyées", async () => {
    const client = mock(Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, nom: `Plat ${i}` })))
    const r = await chercherRecettes(client, {})
    expect(r.recettes).toHaveLength(10)
    expect(r.total).toBe(10)
  })

  it("aucune correspondance → recettes vide, total 0 (pas une erreur)", async () => {
    const client = mock([{ id: "a", nom: "Ratatouille" }])
    expect(await chercherRecettes(client, { texte: "inexistant" })).toEqual({ recettes: [], total: 0 })
  })
})

describe("idsRecettesDuFoyer", () => {
  it("renvoie les ids des recettes à foyer_id non nul", async () => {
    const client = mock([], ["a", "b"])
    expect(await idsRecettesDuFoyer(client)).toEqual(new Set(["a", "b"]))
  })

  it("lève une erreur lisible si la lecture échoue", async () => {
    const client = creerSupabaseMock({
      tables: { recette: { data: null, error: { message: "boom" } } },
    }).client
    await expect(idsRecettesDuFoyer(client)).rejects.toThrow("Lecture des recettes du foyer impossible : boom")
  })
})
