// Outils MCP prendre_demande_panier et rapporter_panier (#308, RG-81→84).
// Client injecté ; client navigateur mocké pour lever (RG-71).

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { ErreurOutil } from "@/lib/mcp/erreurs"
import { prendreDemandePanier, rapporterPanier } from "@/lib/mcp/panier"
import { MESSAGES_PANIER, type RapportPanier } from "@/lib/panier"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

const DEMANDE = "11111111-1111-4111-8111-111111111111"

const RAPPORT: RapportPanier = {
  ajoutes: [{ article: "lait", produit: "Lait demi-écrémé 1 L", marque: "Lactel", quantite: 2 }],
  a_choisir: [{ article: "farine", raison: "plusieurs formats", candidats: ["T45 1 kg", "T55 1 kg"] }],
  introuvables: [{ article: "estragon" }],
}

describe("prendreDemandePanier (RG-81)", () => {
  it("prendre : null → { demande: null }", async () => {
    const { client, rpcs } = creerSupabaseMock({ rpc: { prendre_demande_panier: { data: null, error: null } } })
    expect(await prendreDemandePanier(client)).toEqual({ demande: null })
    expect(rpcs.map((r) => r.nom)).toEqual(["prendre_demande_panier"])
  })

  it("prendre : renvoie id et ancre", async () => {
    const { client } = creerSupabaseMock({
      rpc: { prendre_demande_panier: { data: { id: DEMANDE, ancre: "2026-10-29" }, error: null } },
    })
    expect(await prendreDemandePanier(client)).toEqual({ demande: { id: DEMANDE, ancre: "2026-10-29" } })
  })

  it("prendre : erreur PostgREST → exception (masquée par le serveur)", async () => {
    const { client } = creerSupabaseMock({
      rpc: { prendre_demande_panier: { data: null, error: { message: "boom" } } },
    })
    const promesse = prendreDemandePanier(client)
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})

describe("rapporterPanier (RG-83, RG-84)", () => {
  it("rapporter : transmet statut, rapport et motif à la RPC", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: { statut: "echec", rapport_tardif: false }, error: null } },
    })
    const resultat = await rapporterPanier(client, {
      demande_id: DEMANDE,
      statut: "echec",
      motif: "Session Chronodrive expirée",
      ...RAPPORT,
    })
    expect(rpcs).toEqual([
      {
        nom: "rapporter_panier",
        args: { p_demande: DEMANDE, p_statut: "echec", p_rapport: RAPPORT, p_motif: "Session Chronodrive expirée" },
      },
    ])
    expect(resultat).toEqual({ statut: "echec", rapport_tardif: false })
  })

  it("rapporter : terminee sans motif → p_motif null, rapport_tardif relayé", async () => {
    const { client, rpcs } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: { statut: "terminee", rapport_tardif: true }, error: null } },
    })
    const resultat = await rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    expect(rpcs[0].args).toEqual({ p_demande: DEMANDE, p_statut: "terminee", p_rapport: RAPPORT, p_motif: null })
    expect(resultat).toEqual({ statut: "terminee", rapport_tardif: true })
  })

  it("rapporter : echec sans motif → ErreurOutil", async () => {
    for (const motif of [undefined, "  "]) {
      const { client, rpcs } = creerSupabaseMock()
      await expect(
        rapporterPanier(client, { demande_id: DEMANDE, statut: "echec", motif, ...RAPPORT })
      ).rejects.toBeInstanceOf(ErreurOutil)
      expect(rpcs).toEqual([])
    }
  })

  it("rapporter : OMQ03 → ErreurOutil avec MESSAGES_PANIER.OMQ03", async () => {
    const { client } = creerSupabaseMock({
      rpc: {
        rapporter_panier: {
          data: null,
          error: { message: "Demande de panier introuvable ou déjà close", code: "OMQ03" },
        },
      },
    })
    const promesse = rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ03)
  })

  it("rapporter : autre erreur PostgREST → exception non ErreurOutil", async () => {
    const { client } = creerSupabaseMock({
      rpc: { rapporter_panier: { data: null, error: { message: "boom", code: "XX000" } } },
    })
    const promesse = rapporterPanier(client, { demande_id: DEMANDE, statut: "terminee", ...RAPPORT })
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})
