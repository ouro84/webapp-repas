// Lectures à client Supabase injecté (#304, socle du serveur MCP #302).
//
// Les fonctions de lecture prennent un client optionnel : le serveur MCP passe
// un client « par jeton » (RLS mon_foyer() de l'utilisateur, RG-71), le web
// garde le client navigateur par défaut. Le client navigateur est ici mocké
// pour LEVER : tout appel qui l'utiliserait au lieu du client injecté échoue.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import {
  chargerArticlesManuelsDistants,
  chargerCochesDistantes,
  chargerLongueurCycle,
  chargerPlanningDistant,
  sauvegarderCycleDistant,
} from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { chargerReglages } from "@/lib/reglages-data"
import { REGLAGES_DEFAUT } from "@/lib/reglages"
import { creerSupabaseMock, filtre } from "@/tests/fixtures/supabase-mock"

describe("chargerPlanningDistant — client injecté", () => {
  it("lit la semaine via le client injecté", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        planning: {
          data: { semaine: "2026-W44", updated_at: "2026-10-29T10:00:00Z", planning_slot: [] },
          error: null,
        },
      },
    })

    const resultat = await chargerPlanningDistant("2026-W44", client)

    expect(resultat).toEqual({
      planning: { semaine: "2026-W44", jours: [] },
      updatedAt: "2026-10-29T10:00:00Z",
    })
    expect(appels[0].table).toBe("planning")
    expect(filtre(appels[0], "eq", "semaine")).toBe("2026-W44")
  })

  it("remonte une erreur de lecture", async () => {
    const { client } = creerSupabaseMock({
      tables: { planning: { data: null, error: { message: "JWT expired" } } },
    })

    await expect(chargerPlanningDistant("2026-W44", client)).rejects.toThrow(
      "Chargement du planning distant impossible : JWT expired"
    )
  })
})

describe("lectures du cycle — client injecté", () => {
  it("chargerCochesDistantes reconstruit le blob de l'ancre", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        etat_courses_article: { data: [{ cle: "tomate|piece", quantite: 3 }], error: null },
      },
    })

    expect(await chargerCochesDistantes("2026-10-29", client)).toEqual({ "tomate|piece": 3 })
    expect(filtre(appels[0], "eq", "ancre")).toBe("2026-10-29")
  })

  it("chargerArticlesManuelsDistants mappe les lignes de l'ancre", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        article_manuel: {
          data: [
            {
              id: "a1",
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
      },
    })

    const articles = await chargerArticlesManuelsDistants("2026-10-29", client)

    expect(articles).toHaveLength(1)
    expect(articles[0].libelle).toBe("Piles")
    expect(filtre(appels[0], "eq", "ancre")).toBe("2026-10-29")
  })

  it("chargerLongueurCycle : défaut 7 sans ligne, valeur sinon", async () => {
    const vide = creerSupabaseMock({ tables: { cycle_courses: { data: null, error: null } } })
    expect(await chargerLongueurCycle("2026-10-29", vide.client)).toBe(7)

    const dix = creerSupabaseMock({
      tables: { cycle_courses: { data: { longueur: 10 }, error: null } },
    })
    expect(await chargerLongueurCycle("2026-10-29", dix.client)).toBe(10)
  })

  it("chargerJourCoursesFoyer : jour du foyer, 1 en cas d'erreur", async () => {
    const jeudi = creerSupabaseMock({ tables: { foyers: { data: { jour_courses: 4 }, error: null } } })
    expect(await chargerJourCoursesFoyer(jeudi.client)).toBe(4)

    const enErreur = creerSupabaseMock({
      tables: { foyers: { data: null, error: { message: "boom" } } },
    })
    expect(await chargerJourCoursesFoyer(enErreur.client)).toBe(1)
  })

  it("chargerReglages : REGLAGES_DEFAUT sans ligne", async () => {
    const { client } = creerSupabaseMock({ tables: { reglages: { data: null, error: null } } })
    expect(await chargerReglages(client)).toEqual(REGLAGES_DEFAUT)
  })

  it("le défaut reste le client navigateur", async () => {
    await expect(chargerLongueurCycle("2026-10-29")).rejects.toThrow(
      "client navigateur interdit côté serveur"
    )
  })
})

describe("sauvegarderCycleDistant — RPC atomique sauvegarder_cycle (#304)", () => {
  const recette = { id: "r1", nom: "R1", tempsPreparation: "rapide" as const, ingredients: [] }
  const semaines = [
    { semaine: "2026-W44", jours: [{ jour: "jeudi" as const, diner: recette }] },
    { semaine: "2026-W45", jours: [{ jour: "lundi" as const, diner: recette }] },
  ]
  const slot = (jour: string) => ({
    recette_id: "r1",
    jour,
    type_repas: "diner",
    personnes: 2,
    restes: false,
  })

  it("appelle sauvegarder_cycle une seule fois avec toutes les semaines", async () => {
    const maj = { "2026-W44": "2026-10-29T12:00:00Z", "2026-W45": "2026-10-29T12:00:00Z" }
    const { client, rpcs } = creerSupabaseMock({
      rpc: { sauvegarder_cycle: { data: maj, error: null } },
    })

    const resultat = await sauvegarderCycleDistant("2026-10-29", semaines, client)

    expect(rpcs).toEqual([
      {
        nom: "sauvegarder_cycle",
        args: {
          p_ancre: "2026-10-29",
          p_semaines: [
            { semaine: "2026-W44", slots: [slot("jeudi")] },
            { semaine: "2026-W45", slots: [slot("lundi")] },
          ],
        },
      },
    ])
    expect(resultat).toEqual(maj)
  })

  it("remonte l'erreur de la RPC", async () => {
    const enErreur = creerSupabaseMock({
      rpc: { sauvegarder_cycle: { data: null, error: { message: "Semaine invalide : x" } } },
    })
    await expect(sauvegarderCycleDistant("2026-10-29", semaines, enErreur.client)).rejects.toThrow(
      "Sauvegarde du cycle impossible : Semaine invalide : x"
    )

    const vide = creerSupabaseMock({ rpc: { sauvegarder_cycle: { data: null, error: null } } })
    await expect(sauvegarderCycleDistant("2026-10-29", semaines, vide.client)).rejects.toThrow(
      "Sauvegarde du cycle impossible : réponse vide"
    )
  })
})
