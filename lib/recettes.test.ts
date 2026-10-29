// Accès aux recettes à client injecté (#306) : le serveur MCP lit et crée les
// recettes EN TANT QUE l'utilisateur (RLS mon_foyer(), RG-71). Le client
// navigateur est mocké pour LEVER : seul le client injecté doit servir.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { chargerRecettes, creerRecette, type SaisieRecette } from "@/lib/recettes"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

const dbRecette = (id: string, nom: string) => ({
  id,
  nom,
  temps_preparation: "rapide",
  vegetarien: true,
  accompagnement: null,
  saisons: null,
  etapes: null,
  recette_ingredient: [],
})

describe("chargerRecettes — client injecté", () => {
  it("exclut les recettes masquées par le foyer", async () => {
    const { client } = creerSupabaseMock({
      tables: {
        recette: { data: [dbRecette("r1", "Gratin"), dbRecette("r2", "Soupe")], error: null },
        recette_masquee: { data: [{ recette_id: "r2" }], error: null },
      },
    })
    const recettes = await chargerRecettes(client)
    expect(recettes.map((r) => r.id)).toEqual(["r1"])
  })
})

describe("creerRecette — client injecté et auteur fourni", () => {
  const saisie: SaisieRecette = {
    nom: "Gratin",
    tempsPreparation: "normal",
    vegetarien: true,
    accompagnement: null,
    saisons: [],
    etapes: ["Cuire"],
    ingredients: [{ nom: "pommes de terre", quantite: 500, unite: "g", categorie: "legumes-fruits", fondDePlacard: false }],
  }

  it("insère la recette avec user_id = auteur, sans auth.getUser, puis ses ingrédients", async () => {
    // Le mock n'a pas d'`auth` : un appel à auth.getUser() lèverait.
    const { client, appels } = creerSupabaseMock({
      tables: {
        recette: { data: { id: "r9" }, error: null },
        ingredient: { data: { id: "i1" }, error: null },
      },
    })
    const recette = await creerRecette(saisie, client, "u1")
    expect(recette.id).toBe("r9")
    const insertRecette = appels.find((a) => a.table === "recette")!.ops[0]
    expect(insertRecette).toEqual([
      "insert",
      {
        nom: "Gratin",
        temps_preparation: "normal",
        vegetarien: true,
        accompagnement: null,
        saisons: null,
        etapes: ["Cuire"],
        user_id: "u1",
      },
    ])
    const liens = appels.find((a) => a.table === "recette_ingredient")!.ops[0]
    expect(liens).toEqual([
      "insert",
      [{ recette_id: "r9", ingredient_id: "i1", quantite: 500, unite: "g" }],
    ])
  })

  it("échec des ingrédients : la recette créée est supprimée et l'erreur remonte", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        recette: { data: { id: "r9" }, error: null },
        ingredient: { data: { id: "i1" }, error: null },
        recette_ingredient: { data: null, error: { message: "duplicate key" } },
      },
    })
    await expect(creerRecette(saisie, client, "u1")).rejects.toThrow(
      "Enregistrement des ingrédients impossible : duplicate key"
    )
    const suppression = appels.filter((a) => a.table === "recette" && a.ops.some(([op]) => op === "delete"))
    expect(suppression).toEqual([{ table: "recette", ops: [["delete"], ["eq", "id", "r9"]] }])
  })
})
