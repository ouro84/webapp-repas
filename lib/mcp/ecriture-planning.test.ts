// Outils MCP d'écriture du planning (#306, US-52, RG-74→77). Client Supabase
// injecté (client « par jeton » en vrai) ; le client navigateur est mocké pour
// LEVER, afin de prouver que seul le client injecté sert (RG-71).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

vi.mock("@/lib/generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation")>()),
  genererPourUtilisateur: vi.fn(),
}))

import { ErreurGeneration, genererPourUtilisateur } from "@/lib/generation"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { changerPersonnes, genererCycle, remplacerRepas } from "@/lib/mcp/ecriture-planning"
import {
  creerSupabaseMock,
  filtre,
  type AppelTable,
  type ConfigMock,
  type ReponseMock,
} from "@/tests/fixtures/supabase-mock"
import type { Recette } from "@/types"

// Jeudi 29 octobre 2026 ; jour de courses jeudi (4) par défaut → cycle courant
// du 29/10 (W44) au 04/11 (W45).
const JEUDI = new Date(2026, 9, 29, 12)
const SAMEDI = new Date(2026, 9, 31, 12)

function dbRecette(id: string) {
  return {
    id,
    nom: id,
    temps_preparation: "rapide",
    vegetarien: false,
    accompagnement: null,
    saisons: null,
    etapes: null,
    recette_ingredient: [],
  }
}

function slot(jour: string, recette: string, type: "diner" | "dejeuner" = "diner", personnes = 2) {
  return { jour, type_repas: type, personnes, restes: false, recette: dbRecette(recette) }
}

function reglages(modif: Record<string, unknown> = {}) {
  return {
    user_id: "u1",
    personnes_defaut: 2,
    max_dejeuner_semaine: "long",
    max_diner_semaine: "long",
    max_dejeuner_weekend: "long",
    max_diner_weekend: "long",
    vege_dejeuner_semaine: false,
    vege_diner_semaine: false,
    vege_dejeuner_weekend: false,
    vege_diner_weekend: false,
    mix_accompagnement_jour: false,
    saisonnalite: false,
    updated_at: "2026-10-01T00:00:00Z",
    ...modif,
  }
}

let plannings: Record<string, unknown>

function mock(tables: ConfigMock["tables"] = {}, rpc: ConfigMock["rpc"] = {}) {
  return creerSupabaseMock({
    tables: {
      foyers: { data: { jour_courses: 4 }, error: null },
      cycle_courses: { data: null, error: null },
      planning: (appel): ReponseMock => ({
        data: plannings[filtre(appel, "eq", "semaine") as string] ?? null,
        error: null,
      }),
      reglages: { data: null, error: null },
      ...tables,
    },
    rpc: {
      sauvegarder_cycle: { data: { "2026-W44": "t", "2026-W45": "t" }, error: null },
      sauvegarder_slots: { data: "t", error: null },
      ...rpc,
    },
  })
}

const recette = (id: string): Recette => ({ id, nom: id, tempsPreparation: "rapide", ingredients: [] })

function cycleGenere(ancre = "2026-10-29") {
  return {
    mode: "cycle" as const,
    ancre,
    longueur: 7,
    semaines: [
      { semaine: "2026-W44", jours: [{ jour: "jeudi" as const, diner: recette("gratin") }] },
      { semaine: "2026-W45", jours: [{ jour: "lundi" as const, diner: recette("soupe") }] },
    ],
    vegeNonHonore: 1,
    mixNonHonore: 0,
    saisonNonHonore: 0,
  }
}

beforeEach(() => {
  vi.mocked(genererPourUtilisateur).mockReset()
  vi.mocked(genererPourUtilisateur).mockResolvedValue(cycleGenere())
  plannings = {}
})

describe("genererCycle (RG-74)", () => {
  it("cycle vide : génère, écrit via sauvegarder_cycle et renvoie les repas", async () => {
    const { client, rpcs } = mock()
    const resultat = await genererCycle(client, {}, JEUDI)

    expect(genererPourUtilisateur).toHaveBeenCalledWith(client, { ancre: "2026-10-29", longueur: 7 }, { aujourdhui: JEUDI })
    expect(rpcs.map((r) => r.nom)).toEqual(["sauvegarder_cycle"])
    expect((rpcs[0].args as { p_ancre: string }).p_ancre).toBe("2026-10-29")
    expect(resultat.periode).toEqual({ du: "2026-10-29", au: "2026-11-04", libelle: "du 29 octobre au 4 novembre" })
    expect(resultat.repas.map((r) => [r.date, r.creneau, r.recette])).toEqual([
      ["2026-10-29", "soir", "gratin"],
      ["2026-11-02", "soir", "soupe"],
    ])
    expect(resultat.avertissements).toEqual({ vege_non_honore: 1, mix_non_honore: 0, saison_non_honore: 0 })
  })

  it("cycle non vide sans remplacer : refuse sans rien écrire", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("vendredi", "pizza")] }
    const { client, rpcs } = mock()

    const promesse = genererCycle(client, {}, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow("Un cycle existe déjà du 29 octobre au 4 novembre (1 repas prévus)")
    await expect(promesse).rejects.toThrow("remplacer: true")
    expect(rpcs).toEqual([])
    expect(genererPourUtilisateur).not.toHaveBeenCalled()
  })

  it("remplacer: true écrase un cycle existant", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("vendredi", "pizza")] }
    const { client, rpcs } = mock()
    await genererCycle(client, { remplacer: true }, JEUDI)
    expect(rpcs.map((r) => r.nom)).toEqual(["sauvegarder_cycle"])
  })

  it("un repas hors de la fenêtre du cycle ne compte pas", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("lundi", "passe")] }
    const { client, rpcs } = mock()
    await genererCycle(client, {}, JEUDI)
    expect(rpcs.map((r) => r.nom)).toEqual(["sauvegarder_cycle"])
  })

  it("seuls des créneaux désactivés portent des repas : considéré vide", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("vendredi", "pizza")] }
    const { client, rpcs } = mock({ reglages: { data: reglages({ max_diner_semaine: "aucun" }), error: null } })
    await genererCycle(client, {}, JEUDI)
    expect(rpcs.map((r) => r.nom)).toEqual(["sauvegarder_cycle"])
  })

  it("samedi sans ancre : vise le cycle affiché par /courses", async () => {
    vi.mocked(genererPourUtilisateur).mockResolvedValue(cycleGenere("2026-11-02"))
    const { client, rpcs } = mock({ foyers: { data: { jour_courses: 1 }, error: null } })
    await genererCycle(client, {}, SAMEDI)
    expect((rpcs[0].args as { p_ancre: string }).p_ancre).toBe("2026-11-02")
  })

  it("ancre quelconque : vise le cycle qui la contient", async () => {
    const { client, rpcs } = mock()
    await genererCycle(client, { ancre: "2026-11-01" }, JEUDI)
    expect((rpcs[0].args as { p_ancre: string }).p_ancre).toBe("2026-10-29")
  })

  it("ancre au calendrier impossible : ErreurOutil, rien généré", async () => {
    const { client, rpcs } = mock()
    await expect(genererCycle(client, { ancre: "2026-02-30" }, JEUDI)).rejects.toThrow("Date invalide")
    expect(rpcs).toEqual([])
  })

  it("cycle hors de la plage : ErreurOutil, rien généré", async () => {
    const { client, rpcs } = mock()
    await expect(genererCycle(client, { ancre: "2027-03-04" }, JEUDI)).rejects.toThrow("hors de la plage")
    expect(genererPourUtilisateur).not.toHaveBeenCalled()
    expect(rpcs).toEqual([])
  })

  it("cycle existant : le quota de génération n'est pas consommé", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("vendredi", "pizza")] }
    const quota = vi.fn(async () => {})
    const { client } = mock()
    await expect(genererCycle(client, {}, JEUDI, quota)).rejects.toThrow("Un cycle existe déjà")
    expect(quota).not.toHaveBeenCalled()
  })

  it("quota refusé : ErreurOutil, rien généré ni écrit", async () => {
    const quota = vi.fn(async () => {
      throw new ErreurOutil("Trop de générations en peu de temps. Patiente une minute puis réessaie.")
    })
    const { client, rpcs } = mock()
    await expect(genererCycle(client, {}, JEUDI, quota)).rejects.toThrow("Trop de générations")
    expect(quota).toHaveBeenCalledTimes(1)
    expect(genererPourUtilisateur).not.toHaveBeenCalled()
    expect(rpcs).toEqual([])
  })

  it("vivier insuffisant (422) : ErreurOutil avec le message de la génération", async () => {
    vi.mocked(genererPourUtilisateur).mockRejectedValue(new ErreurGeneration("Pas assez de recettes.", 422))
    const { client, rpcs } = mock()
    const promesse = genererCycle(client, {}, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow("Pas assez de recettes.")
    expect(rpcs).toEqual([])
  })
})

// Semaine W44 : jeudi midi « salade », jeudi soir « gratin » à 4 personnes.
function semaineJeudi() {
  plannings["2026-W44"] = {
    semaine: "2026-W44",
    updated_at: "t",
    planning_slot: [slot("jeudi", "salade", "dejeuner"), slot("jeudi", "gratin", "diner", 4)],
  }
}

function catalogue(noms: string[], tables: ConfigMock["tables"] = {}) {
  return mock({
    recette: { data: noms.map(dbRecette), error: null },
    recette_masquee: { data: [], error: null },
    recette_preference: { data: [], error: null },
    ...tables,
  })
}

type SlotEcrit = { recette_id: string; jour: string; type_repas: string; personnes: number; restes: boolean }
const slotsEcrits = (rpcs: Array<{ nom: string; args: unknown }>) =>
  (rpcs.find((r) => r.nom === "sauvegarder_slots")?.args as { p_slots: SlotEcrit[] }).p_slots

describe("remplacerRepas (RG-75)", () => {
  beforeEach(() => {
    semaineJeudi()
    vi.restoreAllMocks()
  })

  it("auto : un seul slot écrit, l'autre repas du jour intact", async () => {
    const { client, rpcs } = catalogue(["salade", "gratin", "omelette"])
    const resultat = await remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)
    expect(rpcs.map((r) => r.nom)).toEqual(["sauvegarder_slots"])
    expect((rpcs[0].args as { p_semaine: string }).p_semaine).toBe("2026-W44")
    expect(slotsEcrits(rpcs)).toEqual([
      { recette_id: "omelette", jour: "jeudi", type_repas: "dejeuner", personnes: 2, restes: false },
    ])
    expect(resultat).toEqual({
      modifie: true,
      repas: expect.objectContaining({ date: "2026-10-29", creneau: "midi", recette: "omelette" }),
      avertissements: [],
    })
  })

  it("auto applique les préférences du foyer (RG-62)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const { client, rpcs } = catalogue(["salade", "gratin", "evitee", "favorite"], {
      recette_preference: {
        data: [
          { recette_id: "evitee", preference: "evitee" },
          { recette_id: "favorite", preference: "favorite" },
        ],
        error: null,
      },
    })
    await remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)
    expect(slotsEcrits(rpcs)[0].recette_id).toBe("favorite")
  })

  it("auto sans autre recette éligible : ErreurOutil qui cite ajouter_recette", async () => {
    const { client, rpcs } = catalogue(["salade", "gratin"])
    await expect(remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)).rejects.toThrow(
      "ajouter_recette"
    )
    expect(rpcs).toEqual([])
  })

  it("par nom : un résultat → appliqué, personnes conservées (RG-15, RG-16)", async () => {
    const { client, rpcs } = catalogue(["salade", "gratin", "Blanquette de veau"])
    const resultat = await remplacerRepas(
      client,
      { date: "2026-10-29", creneau: "soir", recette: "blanquette" },
      JEUDI
    )
    expect(slotsEcrits(rpcs)).toEqual([
      { recette_id: "Blanquette de veau", jour: "jeudi", type_repas: "diner", personnes: 4, restes: false },
    ])
    expect(resultat).toMatchObject({ modifie: true, repas: { recette: "Blanquette de veau", personnes: 4 } })
  })

  it("par nom : nom exact parmi plusieurs partiels → appliqué", async () => {
    const { client, rpcs } = catalogue(["Blanquette de veau", "Blanquette de veau à l’ancienne"])
    await remplacerRepas(client, { date: "2026-10-29", creneau: "soir", recette: "blanquette de veau" }, JEUDI)
    expect(slotsEcrits(rpcs)[0].recette_id).toBe("Blanquette de veau")
  })

  it("par nom : homonyme exact catalogue + foyer → la recette du foyer est appliquée", async () => {
    const homonymes = [
      { ...dbRecette("blanquette-catalogue"), nom: "Blanquette de veau" },
      { ...dbRecette("blanquette-foyer"), nom: "Blanquette de veau" },
    ]
    const { client, rpcs } = mock({
      // Recherche des recettes du foyer (foyer_id non nul) : seulement la copie du foyer.
      recette: (appel: AppelTable): ReponseMock =>
        appel.ops.some(([op]) => op === "not")
          ? { data: [{ id: "blanquette-foyer" }], error: null }
          : { data: homonymes, error: null },
      recette_masquee: { data: [], error: null },
      recette_preference: { data: [], error: null },
    })
    await remplacerRepas(client, { date: "2026-10-29", creneau: "soir", recette: "Blanquette de veau" }, JEUDI)
    expect(slotsEcrits(rpcs)[0].recette_id).toBe("blanquette-foyer")
  })

  it("par nom : plusieurs → candidats, rien écrit", async () => {
    const { client, rpcs } = catalogue(["Blanquette de veau", "Blanquette de poisson"])
    const resultat = await remplacerRepas(
      client,
      { date: "2026-10-29", creneau: "soir", recette: "blanquette" },
      JEUDI
    )
    expect(resultat).toEqual({
      modifie: false,
      candidats: ["Blanquette de poisson", "Blanquette de veau"],
      total: 2,
    })
    expect(rpcs).toEqual([])
  })

  it("par nom : plus de 10 candidats → 10 renvoyés et le total annoncé", async () => {
    const noms = Array.from({ length: 12 }, (_, i) => `Gratin ${String(i + 1).padStart(2, "0")}`)
    const { client } = catalogue(noms)
    const resultat = await remplacerRepas(client, { date: "2026-10-29", creneau: "soir", recette: "gratin" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: false, total: 12 })
    expect("candidats" in resultat && resultat.candidats).toHaveLength(10)
  })

  it("auto : avertit quand la préférence végé du créneau n'est pas honorée (RG-26, comme le site)", async () => {
    const { client } = catalogue(["salade", "gratin", "omelette"], {
      reglages: { data: reglages({ vege_dejeuner_semaine: true }), error: null },
    })
    const resultat = await remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)
    expect(resultat).toMatchObject({
      modifie: true,
      avertissements: ["Pas de recette végétarienne disponible pour ce repas."],
    })
  })

  it("auto sans préférence non honorée : avertissements vides", async () => {
    const { client } = catalogue(["salade", "gratin", "omelette"])
    const resultat = await remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)
    expect(resultat).toMatchObject({ modifie: true, avertissements: [] })
  })

  it("par nom : aucun → ErreurOutil qui cite ajouter_recette", async () => {
    const { client, rpcs } = catalogue(["gratin"])
    const promesse = remplacerRepas(client, { date: "2026-10-29", creneau: "soir", recette: "blanquette" }, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow("Propose de l’ajouter avec ajouter_recette")
    expect(rpcs).toEqual([])
  })

  it("par nom : une recette masquée par le foyer est introuvable", async () => {
    const { client } = catalogue(["Blanquette de veau"], {
      recette_masquee: { data: [{ recette_id: "Blanquette de veau" }], error: null },
    })
    await expect(
      remplacerRepas(client, { date: "2026-10-29", creneau: "soir", recette: "blanquette" }, JEUDI)
    ).rejects.toBeInstanceOf(ErreurOutil)
  })

  it("repas absent (pas de déjeuner ce jour) : ErreurOutil, rien écrit", async () => {
    plannings["2026-W44"] = { semaine: "2026-W44", updated_at: "t", planning_slot: [slot("jeudi", "gratin")] }
    const { client, rpcs } = catalogue(["gratin", "omelette"])
    await expect(remplacerRepas(client, { date: "2026-10-29", creneau: "midi" }, JEUDI)).rejects.toThrow(
      "Aucun repas prévu le jeudi 29 octobre au midi"
    )
    expect(rpcs).toEqual([])
  })

  it("créneau désactivé dans les réglages : ErreurOutil, rien écrit", async () => {
    const { client, rpcs } = catalogue(["gratin", "omelette"], {
      reglages: { data: reglages({ max_diner_semaine: "aucun" }), error: null },
    })
    await expect(remplacerRepas(client, { date: "2026-10-29", creneau: "soir" }, JEUDI)).rejects.toThrow(
      "Aucun repas prévu"
    )
    expect(rpcs).toEqual([])
  })
})

describe("changerPersonnes (RG-77, RG-16)", () => {
  beforeEach(() => semaineJeudi())

  it("6 personnes : seul le slot visé est réécrit", async () => {
    const { client, rpcs } = mock()
    const resultat = await changerPersonnes(client, { date: "2026-10-29", creneau: "soir", personnes: 6 }, JEUDI)
    expect(slotsEcrits(rpcs)).toEqual([
      { recette_id: "gratin", jour: "jeudi", type_repas: "diner", personnes: 6, restes: false },
    ])
    expect(resultat.repas).toMatchObject({ recette: "gratin", personnes: 6 })
  })

  it("hors [1 ; 12] ou non entier : ErreurOutil, rien écrit", async () => {
    for (const personnes of [0, 13, 2.5]) {
      const { client, rpcs } = mock()
      await expect(
        changerPersonnes(client, { date: "2026-10-29", creneau: "soir", personnes }, JEUDI)
      ).rejects.toThrow("Nombre de personnes invalide : choisis un entier entre 1 et 12.")
      expect(rpcs).toEqual([])
    }
  })
})
