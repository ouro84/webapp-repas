// Envoi du webhook d'exécuteur et schéma du rapport de panier (#308, RG-81, RG-84).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { envoyerWebhook, MESSAGES_PANIER, schemaRapport, type EnvoiWebhook } from "@/lib/panier"

const ENVOI: EnvoiWebhook = {
  demande_id: "d1",
  url: "https://executeur.example/webhook",
  entetes: {
    "webhook-id": "msg_abc",
    "webhook-timestamp": "1790000000",
    "webhook-signature": "v1,xyz",
  },
  corps: '{"evenement":"demande_panier"}',
}

describe("envoyerWebhook (RG-81)", () => {
  beforeEach(() => {
    // Les échecs sont loggés (règle « toute erreur capturée est loggée ») : on les tait ici.
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("envoie corps et en-têtes tels quels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    await envoyerWebhook(ENVOI, { fetch: fetchMock as unknown as typeof fetch })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENVOI.url)
    expect(init.method).toBe("POST")
    expect(init.body).toBe(ENVOI.corps)
    expect(init.headers).toMatchObject({ "content-type": "application/json", ...ENVOI.entetes })
  })

  it("2xx → ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    await expect(
      envoyerWebhook(ENVOI, { fetch: fetchMock as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: true })
  })

  it("non 2xx → échec avec le statut dans le motif", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    const r = await envoyerWebhook(ENVOI, { fetch: fetchMock as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, motif: expect.stringContaining("500") })
  })

  it("délai dépassé → échec sans lever", async () => {
    // fetch qui n'aboutit jamais, sauf à l'abandon du signal.
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        }),
    )
    const r = await envoyerWebhook(ENVOI, { fetch: fetchMock as unknown as typeof fetch, delaiMs: 20 })
    expect(r.ok).toBe(false)
  })

  it("erreur réseau → échec sans lever", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    const r = await envoyerWebhook(ENVOI, { fetch: fetchMock as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, motif: expect.stringContaining("fetch failed") })
  })
})

describe("schemaRapport (RG-84)", () => {
  const rapportValide = {
    ajoutes: [{ article: "lait", produit: "Lait demi-écrémé 1L", marque: "Marque", quantite: 2 }],
    a_choisir: [{ article: "pâtes", raison: "plusieurs formats", candidats: ["Penne", "Spaghetti"] }],
    introuvables: [{ article: "safran" }],
  }

  it("accepte un rapport valide", () => {
    expect(schemaRapport.safeParse(rapportValide).success).toBe(true)
  })

  it("refuse productId et prix", () => {
    const avecId = structuredClone(rapportValide) as Record<string, unknown[]>
    Object.assign(avecId.ajoutes[0] as object, { productId: "p-1" })
    expect(schemaRapport.safeParse(avecId).success).toBe(false)

    const avecPrix = structuredClone(rapportValide) as Record<string, unknown[]>
    Object.assign(avecPrix.ajoutes[0] as object, { prix: 1.99 })
    expect(schemaRapport.safeParse(avecPrix).success).toBe(false)
  })

  it("refuse 4 candidats", () => {
    const r = structuredClone(rapportValide)
    r.a_choisir[0].candidats = ["a", "b", "c", "d"]
    expect(schemaRapport.safeParse(r).success).toBe(false)
  })

  it("refuse une quantité nulle ou non entière", () => {
    for (const quantite of [0, 1.5]) {
      const r = structuredClone(rapportValide)
      r.ajoutes[0].quantite = quantite
      expect(schemaRapport.safeParse(r).success).toBe(false)
    }
  })

  it("refuse une chaîne vide ou trop longue", () => {
    const vide = structuredClone(rapportValide)
    vide.introuvables[0].article = ""
    expect(schemaRapport.safeParse(vide).success).toBe(false)

    const longue = structuredClone(rapportValide)
    longue.introuvables[0].article = "x".repeat(201)
    expect(schemaRapport.safeParse(longue).success).toBe(false)
  })
})

describe("MESSAGES_PANIER", () => {
  it("couvre OMQ01, OMQ02 et OMQ03 en français non vide", () => {
    for (const code of ["OMQ01", "OMQ02", "OMQ03"] as const) {
      expect(MESSAGES_PANIER[code].length).toBeGreaterThan(10)
    }
  })
})
