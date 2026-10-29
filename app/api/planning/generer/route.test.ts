// @vitest-environment node
//
// POST /api/planning/generer — adaptateur HTTP mince de genererPourUtilisateur
// (#304). Garde de non-régression web : mêmes statuts, mêmes messages, même
// forme JSON qu'avant l'extraction de la logique dans lib/generation.ts.

import { beforeEach, describe, expect, it, vi } from "vitest"

const serveur = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: serveur.getUser } }),
}))

const rateLimit = vi.hoisted(() => ({ limiteGeneration: vi.fn() }))
vi.mock("@/lib/rate-limit", () => rateLimit)

const generation = vi.hoisted(() => ({ genererPourUtilisateur: vi.fn() }))
vi.mock("@/lib/generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation")>()),
  genererPourUtilisateur: generation.genererPourUtilisateur,
}))

import { POST } from "@/app/api/planning/generer/route"
import { ErreurGeneration } from "@/lib/generation"

const AVERTISSEMENTS = { vegeNonHonore: 1, mixNonHonore: 0, saisonNonHonore: 2 }

function requete(corps: unknown): Request {
  return new Request("http://localhost/api/planning/generer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  serveur.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
  rateLimit.limiteGeneration.mockResolvedValue({ autorise: true })
  generation.genererPourUtilisateur.mockResolvedValue({
    mode: "semaine",
    planning: { semaine: "2026-W45", jours: [] },
    ...AVERTISSEMENTS,
  })
})

describe("POST /api/planning/generer", () => {
  it("401 sans utilisateur", async () => {
    serveur.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const reponse = await POST(requete({}))

    expect(reponse.status).toBe(401)
    expect(await reponse.json()).toEqual({
      error: "Tu dois être connecté pour générer un planning.",
    })
    expect(generation.genererPourUtilisateur).not.toHaveBeenCalled()
  })

  it("429 si rate-limit dépassé", async () => {
    rateLimit.limiteGeneration.mockResolvedValue({ autorise: false })

    const reponse = await POST(requete({}))

    expect(reponse.status).toBe(429)
    expect(await reponse.json()).toEqual({
      error: "Trop de générations en peu de temps. Patiente une minute puis réessaie.",
    })
  })

  it("corps cycle : longueur numérisée", async () => {
    await POST(requete({ ancre: "2026-10-29", longueur: "7" }))
    expect(generation.genererPourUtilisateur).toHaveBeenLastCalledWith(expect.anything(), {
      ancre: "2026-10-29",
      longueur: 7,
    })

    await POST(requete({ ancre: "2026-10-29" }))
    expect(generation.genererPourUtilisateur).toHaveBeenLastCalledWith(expect.anything(), {
      ancre: "2026-10-29",
      longueur: undefined,
    })
  })

  it("corps semaine non textuelle ou non JSON : semaine par défaut", async () => {
    await POST(requete({ semaine: 12 }))
    expect(generation.genererPourUtilisateur).toHaveBeenLastCalledWith(expect.anything(), {})

    await POST(requete("pas du json"))
    expect(generation.genererPourUtilisateur).toHaveBeenLastCalledWith(expect.anything(), {})

    await POST(requete({ semaine: "2026-W45" }))
    expect(generation.genererPourUtilisateur).toHaveBeenLastCalledWith(expect.anything(), {
      semaine: "2026-W45",
    })
  })

  it("réponse cycle inchangée", async () => {
    const semaines = [{ semaine: "2026-W44", jours: [] }]
    generation.genererPourUtilisateur.mockResolvedValue({
      mode: "cycle",
      ancre: "2026-10-29",
      longueur: 7,
      semaines,
      ...AVERTISSEMENTS,
    })

    const reponse = await POST(requete({ ancre: "2026-10-29", longueur: 7 }))

    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toEqual({ semaines, ...AVERTISSEMENTS })
  })

  it("réponse semaine inchangée", async () => {
    const reponse = await POST(requete({ semaine: "2026-W45" }))

    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toEqual({
      planning: { semaine: "2026-W45", jours: [] },
      ...AVERTISSEMENTS,
    })
  })

  it("ErreurGeneration traduite", async () => {
    generation.genererPourUtilisateur.mockRejectedValue(
      new ErreurGeneration("Semaine invalide.", 400)
    )

    const reponse = await POST(requete({ semaine: "2026-45" }))

    expect(reponse.status).toBe(400)
    expect(await reponse.json()).toEqual({ error: "Semaine invalide." })
  })

  it("erreur inattendue : 500", async () => {
    generation.genererPourUtilisateur.mockRejectedValue(new Error("x"))

    const reponse = await POST(requete({}))

    expect(reponse.status).toBe(500)
    expect(await reponse.json()).toEqual({
      error: "La génération a échoué. Réessaie dans quelques instants.",
    })
  })
})
