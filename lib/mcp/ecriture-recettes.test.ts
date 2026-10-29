// Outil MCP ajouter_recette (#306, RG-76) : recette DU FOYER, même validation
// que le formulaire de l'UI. Client injecté ; client navigateur mocké pour lever.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { ErreurOutil } from "@/lib/mcp/erreurs"
import { ajouterRecette, type SaisieRecetteMcp } from "@/lib/mcp/ecriture-recettes"
import { creerSupabaseMock, type AppelTable, type ReponseMock } from "@/tests/fixtures/supabase-mock"

type RecetteFoyer = { nom: string; temps_preparation: string; recette_ingredient: Array<{ ingredient: { nom: string } }> }

// `recette` répond à la recherche de doublon (liste) et à l'insertion ({ id }).
function mock(recettesFoyer: RecetteFoyer[] = []) {
  return creerSupabaseMock({
    tables: {
      recette: (appel: AppelTable): ReponseMock =>
        appel.ops.some(([op]) => op === "insert")
          ? { data: { id: "r-nouvelle" }, error: null }
          : { data: recettesFoyer, error: null },
      ingredient: { data: { id: "i1" }, error: null },
    },
  })
}

function args(modif: Partial<SaisieRecetteMcp> = {}): SaisieRecetteMcp {
  return {
    nom: "Poulet au riz",
    temps_preparation: "normal",
    ingredients: [
      { nom: "poulet", quantite: 400, unite: "g", categorie: "viandes-poissons" },
      { nom: "riz", quantite: 200, unite: "g", categorie: "epicerie" },
    ],
    etapes: ["Cuire le riz", " ", "Ajouter le poulet"],
    ...modif,
  }
}

const insertRecette = (appels: AppelTable[]) =>
  appels.find((a) => a.table === "recette" && a.ops.some(([op]) => op === "insert"))?.ops[0][1] as
    | Record<string, unknown>
    | undefined

describe("ajouterRecette (RG-76)", () => {
  it("crée une recette du foyer avec l'auteur, sans fournir foyer_id", async () => {
    const { client, appels } = mock()
    const resultat = await ajouterRecette(client, "u1", args())
    const insert = insertRecette(appels)!
    expect(insert).toMatchObject({ nom: "Poulet au riz", temps_preparation: "normal", user_id: "u1" })
    expect(insert).not.toHaveProperty("foyer_id")
    expect(insert.etapes).toEqual(["Cuire le riz", "Ajouter le poulet"])
    expect(resultat).toEqual({
      recette: { nom: "Poulet au riz", temps_preparation: "normal", vegetarien: false, ingredients: 2, etapes: 2 },
    })
  })

  it("champs absents : suggestions du formulaire (végé, accompagnement)", async () => {
    const { client, appels } = mock()
    await ajouterRecette(client, "u1", args())
    expect(insertRecette(appels)).toMatchObject({ vegetarien: false, accompagnement: "feculents" })
  })

  it("un champ fourni l'emporte sur la suggestion", async () => {
    const { client, appels } = mock()
    await ajouterRecette(client, "u1", args({ vegetarien: true, accompagnement: null }))
    expect(insertRecette(appels)).toMatchObject({ vegetarien: true, accompagnement: null })
  })

  it("doublon dans le foyer (casse et accents ignorés) : ErreurOutil qui décrit l'existante, aucun insert", async () => {
    const { client, appels } = mock([
      { nom: "Pâtes carbo", temps_preparation: "rapide", recette_ingredient: [{ ingredient: { nom: "lardons" } }] },
    ])
    const promesse = ajouterRecette(client, "u1", args({ nom: "pates CARBO" }))
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow("Le foyer a déjà une recette « Pâtes carbo » (rapide, ingrédients : lardons)")
    expect(insertRecette(appels)).toBeUndefined()
  })

  it("la recherche de doublon ne lit que les recettes du foyer (pas le catalogue global)", async () => {
    const { client, appels } = mock()
    await ajouterRecette(client, "u1", args())
    const recherche = appels.find((a) => a.table === "recette" && !a.ops.some(([op]) => op === "insert"))!
    expect(recherche.ops).toContainEqual(["not", "foyer_id", "is", null])
  })

  it("validation du formulaire : quantité nulle → message du formulaire, aucune écriture", async () => {
    const { client, appels } = mock()
    const ingredients = [{ nom: "sel", quantite: 0, unite: "g" as const, categorie: "epicerie" as const }]
    await expect(ajouterRecette(client, "u1", args({ ingredients }))).rejects.toThrow("Quantité invalide pour « sel ».")
    expect(appels).toEqual([])
  })
})
