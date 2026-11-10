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

// Intention non confirmée rejouée au chargement suivant (#404) : la page
// rechargée (ou l'app fermée) pendant une écriture la perdait. Une bascule
// rapide favorite → évitée suivie d'un rechargement laissait même la seconde
// écriture jamais envoyée (sérialisée derrière la première).
describe("préférence d'une recette — journal des intentions (#404)", () => {
  const CLE = "preferences_en_attente"

  // Client navigateur factice : `enBase` = état de la table, chaque écriture
  // passe par `reponse` (par défaut : succès immédiat).
  async function clientEnBase(reponse: () => Promise<{ error: null | { message: string } }>) {
    const { createClient } = await import("@/lib/supabase/client")
    const etat = { enBase: null as string | null, ecritures: [] as (string | null)[] }
    vi.mocked(createClient).mockImplementation(
      () =>
        ({
          from: () => ({
            upsert: (ligne: { preference: string }) => {
              etat.ecritures.push(ligne.preference)
              return reponse().then((r) => {
                if (!r.error) etat.enBase = ligne.preference
                return r
              })
            },
            delete: () => ({
              eq: () => {
                etat.ecritures.push(null)
                return reponse().then((r) => {
                  if (!r.error) etat.enBase = null
                  return r
                })
              },
            }),
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: etat.enBase ? { preference: etat.enBase } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }) as unknown as ReturnType<typeof createClient>
    )
    return etat
  }

  // Nouveau chargement de page : module neuf (plus d'écriture en vol), même localStorage.
  async function rechargerModule() {
    vi.resetModules()
    return import("@/lib/preferences")
  }

  it("rechargement pendant une bascule favorite → évitée : l'intention est rejouée avant la lecture", async () => {
    localStorage.clear()
    // Première page : la première écriture ne répond jamais (page quittée).
    const premiere = await clientEnBase(() => new Promise(() => {}))
    const page1 = await rechargerModule()
    void page1.definirPreference("r-reload", "favorite")
    void page1.definirPreference("r-reload", "evitee")
    await new Promise((r) => setTimeout(r, 0))
    expect(premiere.ecritures).toEqual(["favorite"]) // « évitée » jamais envoyée
    expect(JSON.parse(localStorage.getItem(CLE)!)).toEqual({ "r-reload": "evitee" })

    // Page rechargée : la lecture rejoue d'abord l'intention en attente.
    const seconde = await clientEnBase(async () => ({ error: null }))
    const page2 = await rechargerModule()
    expect(await page2.chargerPreference("r-reload")).toBe("evitee")
    expect(seconde.ecritures).toEqual(["evitee"])
    expect(localStorage.getItem(CLE)).toBeNull()
  })

  it("retour au neutre interrompu : rejoué comme une suppression", async () => {
    localStorage.clear()
    await clientEnBase(() => new Promise(() => {}))
    const page1 = await rechargerModule()
    void page1.definirPreference("r-neutre", null)

    const seconde = await clientEnBase(async () => ({ error: null }))
    seconde.enBase = "favorite"
    const page2 = await rechargerModule()
    expect(await page2.chargerPreference("r-neutre")).toBeNull()
    expect(seconde.ecritures).toEqual([null])
  })

  it("écriture confirmée : le journal est vidé, rien n'est rejoué", async () => {
    localStorage.clear()
    const etat = await clientEnBase(async () => ({ error: null }))
    const { definirPreference, chargerPreferences } = await rechargerModule()
    await definirPreference("r-ok", "favorite")
    expect(localStorage.getItem(CLE)).toBeNull()

    const { createClient } = await import("@/lib/supabase/client")
    await chargerPreferences(createClient())
    expect(etat.ecritures).toEqual(["favorite"])
  })

  it("écriture refusée (erreur remontée à l'écran) : l'intention est abandonnée, pas rejouée", async () => {
    localStorage.clear()
    await clientEnBase(async () => ({ error: { message: "réseau" } }))
    const { definirPreference } = await rechargerModule()
    await expect(definirPreference("r-ko", "evitee")).rejects.toThrow("réseau")
    expect(localStorage.getItem(CLE)).toBeNull()
  })

  it("écriture en échec après que la page a été quittée (requête coupée) : l'intention reste à rejouer", async () => {
    localStorage.clear()
    let couper!: () => void
    await clientEnBase(
      () => new Promise((r) => (couper = () => r({ error: { message: "Failed to fetch" } })))
    )
    const { definirPreference } = await rechargerModule()
    const ecriture = definirPreference("r-coupee", "favorite")
    await new Promise((r) => setTimeout(r, 0))
    window.dispatchEvent(new Event("pagehide"))
    couper()
    await expect(ecriture).rejects.toThrow()
    expect(JSON.parse(localStorage.getItem(CLE)!)).toEqual({ "r-coupee": "favorite" })
    window.dispatchEvent(new Event("pageshow"))
  })
})
