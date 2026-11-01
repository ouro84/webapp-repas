// @vitest-environment node
//
// Création de la demande de panier + webhook + fermeture si l'exécuteur est
// injoignable (#308, #320, RG-81). Fonction partagée route / MCP : le client
// Supabase est injecté, `envoyerWebhook` est mocké.

import { beforeEach, describe, expect, it, vi } from "vitest"

const panier = vi.hoisted(() => ({ envoyerWebhook: vi.fn() }))
vi.mock("@/lib/panier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/panier")>()),
  envoyerWebhook: panier.envoyerWebhook,
}))

import { creerEtEnvoyerDemande, ERREUR_GENERIQUE } from "@/lib/panier-demande"
import { MESSAGE_INJOIGNABLE, MESSAGES_PANIER } from "@/lib/panier"
import type { ClientSupabase } from "@/lib/supabase/types"

const ENVOI = {
  demande_id: "d1",
  url: "https://executeur.test/hook",
  entetes: { "webhook-id": "msg_x" },
  corps: '{"evenement":"demande_panier"}',
}

const rpc = vi.fn()
const supabase = { rpc } as unknown as ClientSupabase

// Réponses RPC par nom, surchargées test par test.
function rpcs(reponses: Record<string, { data: unknown; error: unknown }>) {
  rpc.mockImplementation(async (nom: string) => reponses[nom] ?? { data: null, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  rpcs({
    creer_demande_panier: { data: ENVOI, error: null },
    echouer_envoi_demande_panier: { data: true, error: null },
  })
  panier.envoyerWebhook.mockResolvedValue({ ok: true })
})

describe("creerEtEnvoyerDemande", () => {
  it("crée la demande sur l'ancre donnée, envoie le webhook → ok", async () => {
    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toEqual({ ok: true, demandeId: "d1" })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("creer_demande_panier", { p_ancre: "2026-11-05" })
    // Sans `fetch` injecté, l'option n'est pas passée du tout (égalité stricte).
    expect(panier.envoyerWebhook.mock.calls[0][1]).toStrictEqual({})
  })

  it("transmet le fetch injecté au webhook", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch

    await creerEtEnvoyerDemande(supabase, "2026-11-05", { fetch: fetchMock })

    expect(panier.envoyerWebhook).toHaveBeenCalledWith(ENVOI, { fetch: fetchMock })
  })

  it.each(["OMQ01", "OMQ02", "OMQ04"] as const)(
    "%s → 409 avec son message, sans webhook",
    async (code) => {
      rpcs({ creer_demande_panier: { data: null, error: { code, message: "x" } } })

      const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

      expect(resultat).toMatchObject({
        ok: false,
        statut: 409,
        message: MESSAGES_PANIER[code],
        code,
      })
      expect(panier.envoyerWebhook).not.toHaveBeenCalled()
    }
  )

  it("500 générique sur une erreur RPC inconnue", async () => {
    rpcs({ creer_demande_panier: { data: null, error: { code: "XX000", message: "boum" } } })

    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toMatchObject({ ok: false, statut: 500, message: ERREUR_GENERIQUE })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("500 générique si la RPC ne renvoie rien", async () => {
    rpcs({ creer_demande_panier: { data: null, error: null } })

    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toMatchObject({ ok: false, statut: 500, message: ERREUR_GENERIQUE })
    expect(panier.envoyerWebhook).not.toHaveBeenCalled()
  })

  it("webhook en échec → echouer_envoi_demande_panier puis 502", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "réponse HTTP 500" })

    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toMatchObject({ ok: false, statut: 502, message: MESSAGE_INJOIGNABLE })
    expect(rpc).toHaveBeenLastCalledWith("echouer_envoi_demande_panier", {
      p_demande: "d1",
      p_motif: "réponse HTTP 500",
    })
  })

  it("webhook en échec mais demande déjà prise par l'exécuteur → ok", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "délai de 10 s dépassé" })
    rpcs({
      creer_demande_panier: { data: ENVOI, error: null },
      echouer_envoi_demande_panier: { data: false, error: null },
    })

    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toEqual({ ok: true, demandeId: "d1" })
  })

  it("502 même si la fermeture de la demande échoue (expiration paresseuse), échec loggé", async () => {
    panier.envoyerWebhook.mockResolvedValue({ ok: false, motif: "erreur réseau" })
    const erreurFermeture = { code: "XX000", message: "boum" }
    rpcs({
      creer_demande_panier: { data: ENVOI, error: null },
      echouer_envoi_demande_panier: { data: null, error: erreurFermeture },
    })

    const resultat = await creerEtEnvoyerDemande(supabase, "2026-11-05")

    expect(resultat).toMatchObject({ ok: false, statut: 502, message: MESSAGE_INJOIGNABLE })
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("fermeture de la demande impossible"),
      erreurFermeture
    )
  })
})
