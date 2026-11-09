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
  chargerEtatCochesDistant,
  chargerFoyerId,
  chargerLongueurCycle,
  chargerPlanningDistant,
  basculerCocheArticleManuelDistant,
  cocherArticleDistant,
  creerArticleManuelDistant,
  decocherArticleDistant,
  sauvegarderCycleDistant,
  sauvegarderSlotsDistant,
  viderCochesArticlesManuelsDistantes,
  viderCochesDistantes,
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

  it("chargerCochesDistantes ne lit que les coches actives (coche = true, #362)", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: { etat_courses_article: { data: [], error: null } },
    })

    await chargerCochesDistantes("2026-10-29", client)
    // Une ligne `coche = false` est une décoche horodatée, jamais une coche.
    expect(filtre(appels[0], "eq", "coche")).toBe(true)
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

  it("chargerLongueurCycle : erreur de lecture → rejet, jamais le défaut (#365)", async () => {
    const enErreur = creerSupabaseMock({
      tables: { cycle_courses: { data: null, error: { message: "boom" } } },
    })
    await expect(chargerLongueurCycle("2026-10-29", enErreur.client)).rejects.toThrow(
      "Lecture de la longueur du cycle impossible : boom"
    )
  })

  it("chargerJourCoursesFoyer : jour du foyer, 1 en cas d'erreur", async () => {
    const jeudi = creerSupabaseMock({ tables: { foyers: { data: { jour_courses: 4 }, error: null } } })
    expect(await chargerJourCoursesFoyer(jeudi.client)).toBe(4)

    const enErreur = creerSupabaseMock({
      tables: { foyers: { data: null, error: { message: "boom" } } },
    })
    expect(await chargerJourCoursesFoyer(enErreur.client)).toBe(1)
  })

  it("chargerFoyerId lit `foyers` (une ligne par RLS), jamais `profiles` (tous les membres)", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: { foyers: { data: { id: "foyer-1" }, error: null } },
    })
    expect(await chargerFoyerId(client)).toBe("foyer-1")
    expect(appels.map((a) => a.table)).toEqual(["foyers"])

    const enErreur = creerSupabaseMock({ tables: { foyers: { data: null, error: { message: "boom" } } } })
    await expect(chargerFoyerId(enErreur.client)).rejects.toThrow("Chargement du foyer impossible : boom")
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

// Écritures à client injecté (#306) : le serveur MCP écrit EN TANT QUE
// l'utilisateur, par les mêmes RPC / tables que l'UI (RG-79).
describe("écritures — client injecté (#306)", () => {
  const recette = { id: "r1", nom: "R1", tempsPreparation: "rapide" as const, ingredients: [] }

  it("sauvegarderSlotsDistant appelle sauvegarder_slots via le client injecté", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { sauvegarder_slots: { data: "2026-10-29T12:00:00Z", error: null } },
    })
    const maj = await sauvegarderSlotsDistant("2026-W44", [{ jour: "jeudi", diner: recette }], client)
    expect(maj).toBe("2026-10-29T12:00:00Z")
    expect(rpcs).toEqual([
      {
        nom: "sauvegarder_slots",
        args: {
          p_semaine: "2026-W44",
          p_slots: [{ recette_id: "r1", jour: "jeudi", type_repas: "diner", personnes: 2, restes: false }],
        },
      },
    ])
  })

  it("cocherArticleDistant upserte coche = true et renvoie l'updated_at lu", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        etat_courses_article: { data: [{ updated_at: "2026-11-06T10:00:00.123456Z" }], error: null },
      },
    })
    const maj = await cocherArticleDistant("2026-10-29", "oignon|g", 200, client)
    expect(maj).toBe("2026-11-06T10:00:00.123456Z")
    expect(appels).toEqual([
      {
        table: "etat_courses_article",
        ops: [
          [
            "upsert",
            { ancre: "2026-10-29", cle: "oignon|g", quantite: 200, coche: true },
            { onConflict: "foyer_id,ancre,cle" },
          ],
          ["select", "updated_at"],
        ],
      },
    ])
  })

  it("decocherArticleDistant conserve la ligne : upsert coche = false, quantite 0, sans delete (#362)", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        etat_courses_article: { data: [{ updated_at: "2026-11-06T10:00:01Z" }], error: null },
      },
    })
    const maj = await decocherArticleDistant("2026-10-29", "oignon|g", client)
    expect(maj).toBe("2026-11-06T10:00:01Z")
    expect(appels).toEqual([
      {
        table: "etat_courses_article",
        ops: [
          [
            "upsert",
            { ancre: "2026-10-29", cle: "oignon|g", quantite: 0, coche: false },
            { onConflict: "foyer_id,ancre,cle" },
          ],
          ["select", "updated_at"],
        ],
      },
    ])
    expect(appels[0].ops.some(([o]) => o === "delete")).toBe(false)
  })

  it("cocher / décocher remontent l'erreur et refusent une réponse sans updated_at", async () => {
    const enErreur = creerSupabaseMock({
      tables: { etat_courses_article: { data: null, error: { message: "RLS" } } },
    })
    await expect(cocherArticleDistant("a", "k", 1, enErreur.client)).rejects.toThrow("Cochage impossible : RLS")
    await expect(decocherArticleDistant("a", "k", enErreur.client)).rejects.toThrow("Décochage impossible : RLS")

    const vide = creerSupabaseMock({ tables: { etat_courses_article: { data: [], error: null } } })
    await expect(cocherArticleDistant("a", "k", 1, vide.client)).rejects.toThrow("Cochage impossible")
    await expect(decocherArticleDistant("a", "k", vide.client)).rejects.toThrow("Décochage impossible")
  })

  it("viderCochesDistantes décoche en conservant les lignes et renvoie les horodatages", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        etat_courses_article: {
          data: [
            { cle: "a|g", updated_at: "2026-11-06T10:00:00Z" },
            { cle: "b|piece", updated_at: "2026-11-06T10:00:01Z" },
          ],
          error: null,
        },
      },
    })
    const maj = await viderCochesDistantes("2026-10-29", client)
    expect(maj).toEqual([
      { cle: "a|g", maj: "2026-11-06T10:00:00Z" },
      { cle: "b|piece", maj: "2026-11-06T10:00:01Z" },
    ])
    expect(appels[0].ops).toEqual([
      ["update", { coche: false }],
      ["eq", "ancre", "2026-10-29"],
      ["eq", "coche", true],
      ["select", "cle, updated_at"],
    ])
  })

  it("viderCochesDistantes remonte l'erreur", async () => {
    const { client } = creerSupabaseMock({
      tables: { etat_courses_article: { data: null, error: { message: "boom" } } },
    })
    await expect(viderCochesDistantes("2026-10-29", client)).rejects.toThrow(
      "Vidage des coches impossible : boom"
    )
  })

  it("viderCochesArticlesManuelsDistantes décoche via le client injecté et renvoie les horodatages", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        article_manuel: {
          data: [{ id: "a1", updated_at: "2026-11-06T10:00:00Z" }],
          error: null,
        },
      },
    })
    const lignes = await viderCochesArticlesManuelsDistantes("2026-10-29", client)
    expect(lignes).toEqual([{ id: "a1", majLe: "2026-11-06T10:00:00Z" }])
    expect(appels[0].ops).toEqual([
      ["update", { coche: false }],
      ["eq", "ancre", "2026-10-29"],
      ["select", "id, updated_at"],
    ])
  })

  it("écritures de coche : statut HTTP et code PostgREST gardés dans `cause`", async () => {
    const refus = creerSupabaseMock({
      tables: {
        etat_courses_article: { data: null, error: { message: "RLS", code: "42501" }, status: 403 },
        article_manuel: { data: null, error: { message: "RLS", code: "42501" }, status: 403 },
      },
    })
    const attendue = { cause: { status: 403, code: "42501" } }
    await expect(cocherArticleDistant("a", "k", 1, refus.client)).rejects.toMatchObject(attendue)
    await expect(decocherArticleDistant("a", "k", refus.client)).rejects.toMatchObject(attendue)
    await expect(viderCochesDistantes("a", refus.client)).rejects.toMatchObject(attendue)
    await expect(basculerCocheArticleManuelDistant("a1", true, refus.client)).rejects.toMatchObject(
      attendue
    )
    await expect(viderCochesArticlesManuelsDistantes("a", refus.client)).rejects.toMatchObject(
      attendue
    )

    // Échec réseau (statut absent ou 0) : `status: 0`, transitoire côté synchro.
    const reseau = creerSupabaseMock({
      tables: { etat_courses_article: { data: null, error: { message: "Failed to fetch" } } },
    })
    await expect(cocherArticleDistant("a", "k", 1, reseau.client)).rejects.toMatchObject({
      cause: { status: 0, code: "" },
    })
  })

  it("chargerEtatCochesDistant lit lignes cochées ET décochées, sans filtre coche", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        etat_courses_article: {
          data: [
            { cle: "a|g", quantite: 200, coche: true, updated_at: "2026-11-06T10:00:00Z" },
            { cle: "b|piece", quantite: 0, coche: false, updated_at: "2026-11-06T10:00:05Z" },
          ],
          error: null,
        },
      },
    })
    const etat = await chargerEtatCochesDistant("2026-10-29", client)
    expect(etat).toEqual({
      "a|g": { coche: true, valeur: 200, maj: "2026-11-06T10:00:00Z" },
      "b|piece": { coche: false, valeur: 0, maj: "2026-11-06T10:00:05Z" },
    })
    expect(appels[0].ops).toEqual([
      ["select", "cle, quantite, coche, updated_at"],
      ["eq", "ancre", "2026-10-29"],
    ])
  })

  it("chargerEtatCochesDistant remonte l'erreur", async () => {
    const { client } = creerSupabaseMock({
      tables: { etat_courses_article: { data: null, error: { message: "x" } } },
    })
    await expect(chargerEtatCochesDistant("a", client)).rejects.toThrow(
      "Chargement de l'état des coches distantes impossible : x"
    )
  })

  it("creerArticleManuelDistant insère l'article sur l'ancre", async () => {
    const { client, appels } = creerSupabaseMock({
      tables: {
        article_manuel: {
          data: { id: "a1", libelle: "Bougies", quantite: null, unite: null, categorie: "autre", fond_de_placard: false, coche: false },
          error: null,
        },
      },
    })
    const article = await creerArticleManuelDistant(
      "2026-10-29",
      { libelle: "Bougies", quantite: null, unite: null, categorie: "autre", fondDePlacard: false },
      client
    )
    expect(article).toMatchObject({ id: "a1", libelle: "Bougies", coche: false })
    expect(appels[0].ops[0]).toEqual([
      "insert",
      { ancre: "2026-10-29", libelle: "Bougies", quantite: null, unite: null, categorie: "autre", fond_de_placard: false },
    ])
  })

  it("basculerCocheArticleManuelDistant met à jour la coche de l'article", async () => {
    const { client, appels } = creerSupabaseMock()
    await basculerCocheArticleManuelDistant("a1", true, client)
    expect(appels).toEqual([
      {
        table: "article_manuel",
        ops: [["update", { coche: true }], ["eq", "id", "a1"], ["select", "updated_at"]],
      },
    ])
  })
})
