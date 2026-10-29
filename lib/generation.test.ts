// Génération côté serveur à client injecté (#304, socle du serveur MCP #302).
//
// `genererPourUtilisateur` reprend la logique de POST /api/planning/generer :
// mêmes validations (plage −12/+6 semaines, RG-24/RG-73), mêmes messages et
// statuts, mêmes lectures best-effort. Le client navigateur est mocké pour
// LEVER : seul le client injecté doit servir.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { genererPourUtilisateur, semaineDansPlage } from "@/lib/generation"
import { creerSupabaseMock, type ConfigMock } from "@/tests/fixtures/supabase-mock"
import { RECETTES_FIXTURES_DB } from "@/tests/fixtures/recettes-db"

// Jeudi 29 octobre 2026 → semaine courante 2026-W44.
const JEUDI = new Date("2026-10-29T12:00:00Z")
const SAMEDI = new Date("2026-10-31T12:00:00Z")

function client(tables: ConfigMock["tables"] = {}) {
  return creerSupabaseMock({
    tables: { recette: { data: RECETTES_FIXTURES_DB, error: null }, ...tables },
  }).client
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("genererPourUtilisateur — mode semaine", () => {
  it("planning de la semaine demandée et avertissements", async () => {
    const r = await genererPourUtilisateur(client(), { semaine: "2026-W45" }, { aujourdhui: JEUDI })

    if (r.mode !== "semaine") throw new Error("mode attendu : semaine")
    expect(r.planning.semaine).toBe("2026-W45")
    expect(r.planning.jours).toHaveLength(7)
    for (const jour of r.planning.jours) {
      expect(jour.dejeuner).toBeDefined()
      expect(jour.diner).toBeDefined()
    }
    expect(r.vegeNonHonore).toBeGreaterThanOrEqual(0)
    expect(r.mixNonHonore).toBeGreaterThanOrEqual(0)
    expect(r.saisonNonHonore).toBeGreaterThanOrEqual(0)
  })

  it("corps vide un samedi : semaine suivante", async () => {
    const r = await genererPourUtilisateur(client(), {}, { aujourdhui: SAMEDI })

    if (r.mode !== "semaine") throw new Error("mode attendu : semaine")
    expect(r.planning.semaine).toBe("2026-W45")
  })
})

describe("genererPourUtilisateur — mode cycle", () => {
  it("jours du cycle répartis par semaine ISO", async () => {
    const r = await genererPourUtilisateur(
      client(),
      { ancre: "2026-10-29", longueur: 7 },
      { aujourdhui: JEUDI }
    )

    if (r.mode !== "cycle") throw new Error("mode attendu : cycle")
    expect(r.ancre).toBe("2026-10-29")
    expect(r.longueur).toBe(7)
    expect(r.semaines.map((s) => s.semaine)).toEqual(["2026-W44", "2026-W45"])
    expect(r.semaines.reduce((n, s) => n + s.jours.length, 0)).toBe(7)
  })

  it("cycle de 14 j depuis un dimanche : 3 semaines ISO", async () => {
    const r = await genererPourUtilisateur(
      client(),
      { ancre: "2026-11-01", longueur: 14 },
      { aujourdhui: JEUDI }
    )

    if (r.mode !== "cycle") throw new Error("mode attendu : cycle")
    expect(r.semaines.map((s) => s.semaine)).toEqual(["2026-W44", "2026-W45", "2026-W46"])
  })
})

describe("genererPourUtilisateur — refus 400", () => {
  const cas: Array<[string, Parameters<typeof genererPourUtilisateur>[1], string]> = [
    ["ancre mal formée", { ancre: "2026-10-9" }, "Ancre de cycle invalide."],
    ["longueur 0", { ancre: "2026-10-29", longueur: 0 }, "Longueur de cycle invalide."],
    ["longueur 15", { ancre: "2026-10-29", longueur: 15 }, "Longueur de cycle invalide."],
    ["longueur 1.5", { ancre: "2026-10-29", longueur: 1.5 }, "Longueur de cycle invalide."],
    ["cycle hors plage", { ancre: "2027-01-07" }, "Cycle hors de la plage autorisée."],
    ["semaine mal formée", { semaine: "2026-45" }, "Semaine invalide."],
    ["semaine +7", { semaine: "2026-W51" }, "Semaine cible hors de la plage autorisée."],
  ]

  for (const [nom, demande, message] of cas) {
    it(nom, async () => {
      await expect(
        genererPourUtilisateur(client(), demande, { aujourdhui: JEUDI })
      ).rejects.toMatchObject({ statut: 400, message })
    })
  }

  it("semaine +6 acceptée", async () => {
    const r = await genererPourUtilisateur(client(), { semaine: "2026-W50" }, { aujourdhui: JEUDI })
    expect(r.mode).toBe("semaine")
  })
})

describe("genererPourUtilisateur — lectures", () => {
  it("recettes illisibles : 500", async () => {
    const c = client({ recette: { data: null, error: { message: "boom" } } })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(genererPourUtilisateur(c, {}, { aujourdhui: JEUDI })).rejects.toMatchObject({
      statut: 500,
      message: "Impossible de récupérer tes recettes. Réessaie dans quelques instants.",
    })
  })

  it("vivier vide : 422", async () => {
    const c = client({ recette: { data: [], error: null } })

    await expect(genererPourUtilisateur(c, {}, { aujourdhui: JEUDI })).rejects.toMatchObject({
      statut: 422,
      message:
        "Pas assez de recettes pour générer un planning complet. Ajoute des recettes (notamment rapides ou normales) puis réessaie.",
    })
  })

  it("recettes masquées exclues", async () => {
    const c = client({
      recette_masquee: { data: [{ recette_id: "tagliatelles-au-parmesan" }], error: null },
    })

    for (let i = 0; i < 10; i++) {
      const r = await genererPourUtilisateur(c, { semaine: "2026-W45" }, { aujourdhui: JEUDI })
      if (r.mode !== "semaine") throw new Error("mode attendu : semaine")
      const ids = r.planning.jours.flatMap((j) => [j.dejeuner?.id, j.diner?.id])
      expect(ids).not.toContain("tagliatelles-au-parmesan")
    }
  })

  it("lectures best-effort en erreur : génération quand même", async () => {
    const erreur = { data: null, error: { message: "boom" } }
    const c = client({
      recette_masquee: erreur,
      reglages: erreur,
      planning: erreur,
      recette_preference: erreur,
    })
    const espion = vi.spyOn(console, "error").mockImplementation(() => {})

    const r = await genererPourUtilisateur(c, { semaine: "2026-W45" }, { aujourdhui: JEUDI })

    expect(r.mode).toBe("semaine")
    expect(espion).toHaveBeenCalledTimes(4)
  })
})

describe("semaineDansPlage (RG-24, RG-73)", () => {
  it("semaineDansPlage : bornes −12 et +6 incluses, −13 et +7 exclues", () => {
    expect(semaineDansPlage("2026-W44", "2026-W32")).toBe(true)
    expect(semaineDansPlage("2026-W44", "2026-W50")).toBe(true)
    expect(semaineDansPlage("2026-W44", "2026-W31")).toBe(false)
    expect(semaineDansPlage("2026-W44", "2026-W51")).toBe(false)
  })
})
