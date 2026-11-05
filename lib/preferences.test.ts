// Préférences favoris/évités à client injecté (#306, RG-62) : « Changer » côté
// MCP les applique comme l'UI. Le client navigateur est mocké pour LEVER.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { chargerPreferences } from "@/lib/preferences"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

describe("chargerPreferences — client injecté", () => {
  it("renvoie la carte recette → préférence du foyer", async () => {
    const { client } = creerSupabaseMock({
      tables: { recette_preference: { data: [{ recette_id: "r1", preference: "favorite" }], error: null } },
    })
    expect(await chargerPreferences(client)).toEqual(new Map([["r1", "favorite"]]))
  })
})

// Écritures d'une même recette sérialisées, lecture après les écritures en vol
// (#352, flaky e2e « favorite/évitée ») : deux bascules rapides (favorite puis
// évitée) partaient en parallèle et pouvaient se valider dans le désordre, et la
// fiche rouverte relisait la base avant la fin de la dernière écriture.
describe("préférence d'une recette — ordre des écritures et lecture", () => {
  type Differe = { resoudre: () => void; promesse: Promise<{ error: null }> }
  function differe(): Differe {
    let resoudre!: () => void
    const promesse = new Promise<{ error: null }>((r) => (resoudre = () => r({ error: null })))
    return { resoudre, promesse }
  }
  async function clientFactice() {
    const { createClient } = await import("@/lib/supabase/client")
    const ecritures: { preference: string | null; differe: Differe }[] = []
    const lectures: string[] = []
    let enBase: string | null = null
    vi.mocked(createClient).mockImplementation(
      () =>
        ({
          from: () => ({
            upsert: (ligne: { preference: string }) => {
              const d = differe()
              ecritures.push({ preference: ligne.preference, differe: d })
              return d.promesse.then((r) => ((enBase = ligne.preference), r))
            },
            delete: () => ({
              eq: () => {
                const d = differe()
                ecritures.push({ preference: null, differe: d })
                return d.promesse.then((r) => ((enBase = null), r))
              },
            }),
            select: () => ({
              eq: (_c: string, id: string) => ({
                maybeSingle: async () => {
                  lectures.push(id)
                  return { data: enBase ? { preference: enBase } : null, error: null }
                },
              }),
            }),
          }),
        }) as unknown as ReturnType<typeof createClient>
    )
    return { ecritures, lectures }
  }
  const attendre = () => new Promise((r) => setTimeout(r, 10))

  it("deux bascules rapides : la seconde écriture ne part qu'après la première, la dernière gagne", async () => {
    const { ecritures } = await clientFactice()
    const { definirPreference } = await import("@/lib/preferences")

    const favorite = definirPreference("r-ordre", "favorite")
    const evitee = definirPreference("r-ordre", "evitee")
    await attendre()
    expect(ecritures.map((e) => e.preference)).toEqual(["favorite"])

    ecritures[0].differe.resoudre()
    await favorite
    await attendre()
    expect(ecritures.map((e) => e.preference)).toEqual(["favorite", "evitee"])
    ecritures[1].differe.resoudre()
    await evitee
  })

  it("la lecture d'une recette attend ses écritures en vol (fiche rouverte)", async () => {
    const { ecritures, lectures } = await clientFactice()
    const { chargerPreference, definirPreference } = await import("@/lib/preferences")

    const ecriture = definirPreference("r-lecture", "evitee")
    const lecture = chargerPreference("r-lecture")
    await attendre()
    expect(lectures).toEqual([])

    ecritures[0].differe.resoudre()
    await ecriture
    expect(await lecture).toBe("evitee")
  })

  it("une écriture en échec ne bloque pas la suivante", async () => {
    const { createClient } = await import("@/lib/supabase/client")
    const { definirPreference } = await import("@/lib/preferences")
    let appel = 0
    vi.mocked(createClient).mockImplementation(
      () =>
        ({
          from: () => ({
            upsert: async () => (++appel === 1 ? { error: { message: "réseau" } } : { error: null }),
          }),
        }) as unknown as ReturnType<typeof createClient>
    )

    await expect(definirPreference("r-echec", "favorite")).rejects.toThrow("réseau")
    await expect(definirPreference("r-echec", "evitee")).resolves.toBeUndefined()
    expect(appel).toBe(2)
  })
})
