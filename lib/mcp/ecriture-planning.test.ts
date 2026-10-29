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
import { genererCycle } from "@/lib/mcp/ecriture-planning"
import {
  creerSupabaseMock,
  filtre,
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

  it("vivier insuffisant (422) : ErreurOutil avec le message de la génération", async () => {
    vi.mocked(genererPourUtilisateur).mockRejectedValue(new ErreurGeneration("Pas assez de recettes.", 422))
    const { client, rpcs } = mock()
    const promesse = genererCycle(client, {}, JEUDI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow("Pas assez de recettes.")
    expect(rpcs).toEqual([])
  })
})
