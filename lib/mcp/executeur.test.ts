// Outils du run de l'exécuteur de panier : prendre_demande_panier enrichi (liste
// signée) et cocher_article_demande (#330, RG-83, RG-85). Client injecté ; client
// navigateur mocké pour lever (RG-71).

import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  resoudreAncreCycle: vi.fn(),
  chargerListeCoursesCycle: vi.fn(),
  cocherArticle: vi.fn(),
}))

vi.mock("@/lib/ancre-cycle", () => ({ resoudreAncreCycle: m.resoudreAncreCycle }))
vi.mock("@/lib/liste-courses-cycle", () => ({ chargerListeCoursesCycle: m.chargerListeCoursesCycle }))
vi.mock("@/lib/mcp/ecriture-courses", () => ({ cocherArticle: m.cocherArticle }))
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { cleAgregation } from "@/lib/courses"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { cocherArticleDemande, prendreDemandeExecuteur } from "@/lib/mcp/executeur"
import { MESSAGES_PANIER } from "@/lib/panier"
import { creerSupabaseMock, type ConfigMock } from "@/tests/fixtures/supabase-mock"
import type { Ingredient } from "@/types"

const DEMANDE = "11111111-1111-4111-8111-111111111111"
const ANCRE = "2026-11-12"
// Mardi 3 novembre 2026 : la demande vise le cycle SUIVANT (ancre ≠ ancre du jour).
const AUJOURDHUI = new Date(2026, 10, 3, 12)
const EXPIRE_LE = 1_793_000_000

const ing = (nom: string, quantite: number, unite: Ingredient["unite"], modif: Partial<Ingredient> = {}): Ingredient => ({
  nom,
  quantite,
  unite,
  categorie: "legumes-fruits",
  fondDePlacard: false,
  ...modif,
})

function liste(
  normal: Array<{ categorie: Ingredient["categorie"]; ingredients: Ingredient[] }>,
  fondDePlacard: Ingredient[] = [],
  coches: Record<string, number> = {}
) {
  m.chargerListeCoursesCycle.mockResolvedValue({
    ancre: ANCRE,
    longueur: 7,
    liste: { normal, fondDePlacard },
    coches,
  })
}

const rpcPrise = (data: unknown): ConfigMock["rpc"] => ({
  prendre_demande_panier: { data, error: null },
})

beforeEach(() => {
  vi.resetAllMocks()
  m.resoudreAncreCycle.mockResolvedValue({ ok: true, ancre: ANCRE })
})

describe("prendreDemandeExecuteur (#330, RG-83)", () => {
  it("prendre sans demande → demande null, aucun appel à signer_jetons_panier", async () => {
    const { client, rpcs } = creerSupabaseMock({ rpc: rpcPrise(null) })
    const prise = await prendreDemandeExecuteur(client, AUJOURDHUI)
    expect(prise).toEqual({
      demande: null,
      raison: "Aucune demande en attente : arrête-toi sans rien faire d'autre.",
    })
    expect(rpcs.map((r) => r.nom)).toEqual(["prendre_demande_panier"])
    expect(m.chargerListeCoursesCycle).not.toHaveBeenCalled()
  })

  it("prendre : erreur PostgREST → exception non ErreurOutil (masquée par le serveur)", async () => {
    const { client } = creerSupabaseMock({
      rpc: { prendre_demande_panier: { data: null, error: { message: "boom" } } },
    })
    const promesse = prendreDemandeExecuteur(client, AUJOURDHUI)
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })

  it("prendre → articles non cochés du cycle demande.ancre, chacun avec le jeton renvoyé par signer_jetons_panier, clés passées = cleJeton(libellé)", async () => {
    const tomates = ing("Tomates  Cerises", 200, "g")
    const lait = ing("lait", 500, "ml", { categorie: "produits-frais" })
    const deja = ing("Carottes", 3, "piece")
    const sel = ing("Sel", 5, "g", { categorie: "epicerie", fondDePlacard: true })
    const piles = ing("Piles", 4, "piece", { categorie: "autre", source: "manuel", id: "a1", coche: false })
    liste(
      [
        { categorie: "legumes-fruits", ingredients: [tomates, deja] },
        { categorie: "produits-frais", ingredients: [lait] },
        { categorie: "autre", ingredients: [piles] },
      ],
      [sel],
      { [cleAgregation(deja)]: 3 }
    )
    const { client, rpcs } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        signer_jetons_panier: {
          data: { expire_le: EXPIRE_LE, jetons: ["j-tomates", "j-lait", "j-piles", "j-sel"] },
          error: null,
        },
      },
    })

    const prise = await prendreDemandeExecuteur(client, AUJOURDHUI)

    // Liste lue sur le cycle de la demande, pas sur celui du jour (RG-83).
    expect(m.chargerListeCoursesCycle).toHaveBeenCalledWith(client, { ancre: ANCRE, aujourdhui: AUJOURDHUI })
    const signature = rpcs.find((r) => r.nom === "signer_jetons_panier")
    expect(signature?.args).toEqual({
      p_demande: DEMANDE,
      p_cles: ["tomates cerises", "lait", "piles", "sel"],
    })
    expect(prise).toEqual({
      demande: {
        id: DEMANDE,
        ancre: ANCRE,
        cycle: { du: "2026-11-12", au: "2026-11-18", libelle: "Courses du 12 au 18 novembre" },
        expire_le: new Date(EXPIRE_LE * 1000).toISOString(),
        articles: [
          { libelle: "Tomates  Cerises", quantite: "200 g", rayon: "Légumes & Fruits", placard: false, manuel: false, jeton: "j-tomates" },
          { libelle: "lait", quantite: "500 ml", rayon: "Produits frais", placard: false, manuel: false, jeton: "j-lait" },
          { libelle: "Piles", quantite: "4", rayon: "Autre", placard: false, manuel: true, jeton: "j-piles" },
          { libelle: "Sel", quantite: "5 g", rayon: "Épicerie", placard: true, manuel: false, jeton: "j-sel" },
        ],
      },
    })
  })

  it("prendre, cycle changé → rapporter_panier echec avec le motif, demande null", async () => {
    // Le jour de courses a changé : l'ancre de la demande se résout vers un autre cycle.
    m.resoudreAncreCycle.mockResolvedValue({ ok: true, ancre: "2026-11-05" })
    const { client, rpcs } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        rapporter_panier: { data: { statut: "echec", rapport_tardif: false }, error: null },
      },
    })
    const motif = "Le cycle de courses a changé depuis la demande : relance le panier depuis /courses."

    const prise = await prendreDemandeExecuteur(client, AUJOURDHUI)

    expect(prise).toEqual({ demande: null, raison: motif })
    expect(rpcs.map((r) => r.nom)).toEqual(["prendre_demande_panier", "rapporter_panier"])
    expect(rpcs[1].args).toEqual({
      p_demande: DEMANDE,
      p_statut: "echec",
      p_rapport: { ajoutes: [], a_choisir: [], introuvables: [] },
      p_motif: motif,
    })
    expect(m.chargerListeCoursesCycle).not.toHaveBeenCalled()
  })

  it("prendre, ancre hors plage (résolution en échec) → même rapport en échec", async () => {
    m.resoudreAncreCycle.mockResolvedValue({ ok: false, motif: "hors_plage" })
    const { client, rpcs } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        rapporter_panier: { data: { statut: "echec", rapport_tardif: false }, error: null },
      },
    })
    const prise = await prendreDemandeExecuteur(client, AUJOURDHUI)
    expect(prise.demande).toBeNull()
    expect(rpcs.find((r) => r.nom === "rapporter_panier")?.args).toMatchObject({ p_statut: "echec" })
    expect(rpcs.some((r) => r.nom === "signer_jetons_panier")).toBe(false)
  })

  it("prendre, liste vide → rapporter_panier terminee listes vides, demande null", async () => {
    liste([{ categorie: "legumes-fruits", ingredients: [ing("Carottes", 3, "piece")] }], [], {
      [cleAgregation(ing("Carottes", 3, "piece"))]: 3,
    })
    const { client, rpcs } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        rapporter_panier: { data: { statut: "terminee", rapport_tardif: false }, error: null },
      },
    })

    const prise = await prendreDemandeExecuteur(client, AUJOURDHUI)

    expect(prise).toEqual({
      demande: null,
      raison: "Liste de courses vide : rien à ajouter, compte-rendu envoyé.",
    })
    expect(rpcs.map((r) => r.nom)).toEqual(["prendre_demande_panier", "rapporter_panier"])
    expect(rpcs[1].args).toEqual({
      p_demande: DEMANDE,
      p_statut: "terminee",
      p_rapport: { ajoutes: [], a_choisir: [], introuvables: [] },
      p_motif: null,
    })
  })

  it("prendre : signer_jetons_panier lève OMQ05 (demande expirée entre prise et signature) → ErreurOutil OMQ05", async () => {
    liste([{ categorie: "legumes-fruits", ingredients: [ing("Tomates", 2, "piece")] }])
    const { client } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        signer_jetons_panier: { data: null, error: { message: "Demande de panier non en cours", code: "OMQ05" } },
      },
    })
    const promesse = prendreDemandeExecuteur(client, AUJOURDHUI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ05)
  })

  it("prendre : autre erreur de signer_jetons_panier → exception non ErreurOutil", async () => {
    liste([{ categorie: "legumes-fruits", ingredients: [ing("Tomates", 2, "piece")] }])
    const { client } = creerSupabaseMock({
      rpc: {
        ...rpcPrise({ id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }),
        signer_jetons_panier: { data: null, error: { message: "boom", code: "XX000" } },
      },
    })
    const promesse = prendreDemandeExecuteur(client, AUJOURDHUI)
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })
})

describe("cocherArticleDemande (#330, RG-83)", () => {
  it("cocher_article_demande sans demande en cours → ErreurOutil OMQ05, aucune écriture", async () => {
    const { client, rpcs, appels } = creerSupabaseMock({
      rpc: { demande_panier_en_cours: { data: null, error: null } },
    })
    const promesse = cocherArticleDemande(client, { libelle: "lait" }, AUJOURDHUI)
    await expect(promesse).rejects.toBeInstanceOf(ErreurOutil)
    await expect(promesse).rejects.toThrow(MESSAGES_PANIER.OMQ05)
    expect(m.cocherArticle).not.toHaveBeenCalled()
    expect(rpcs.map((r) => r.nom)).toEqual(["demande_panier_en_cours"])
    expect(appels).toEqual([])
  })

  it("cocher_article_demande : erreur PostgREST → exception non ErreurOutil", async () => {
    const { client } = creerSupabaseMock({
      rpc: { demande_panier_en_cours: { data: null, error: { message: "boom" } } },
    })
    const promesse = cocherArticleDemande(client, { libelle: "lait" }, AUJOURDHUI)
    await expect(promesse).rejects.toThrow("boom")
    await expect(promesse).rejects.not.toBeInstanceOf(ErreurOutil)
  })

  it("cocher_article_demande → cocherArticle appelé avec ancre = demande.ancre, jamais celle du jour", async () => {
    m.cocherArticle.mockResolvedValue({ modifie: true, article: { nom: "lait", quantite: "1 L", manuel: false, coche: true } })
    const { client } = creerSupabaseMock({
      rpc: { demande_panier_en_cours: { data: { id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }, error: null } },
    })

    const resultat = await cocherArticleDemande(client, { libelle: "lait", quantite: "1 L" }, AUJOURDHUI)

    // Jamais de `coche: false` : cet outil ne décoche pas.
    expect(m.cocherArticle).toHaveBeenCalledWith(
      client,
      { libelle: "lait", quantite: "1 L", ancre: ANCRE },
      AUJOURDHUI
    )
    expect(resultat).toEqual({ modifie: true, article: { nom: "lait", quantite: "1 L", manuel: false, coche: true } })
  })

  it("cocher_article_demande, homonymes → candidats, rien coché", async () => {
    const candidats = [
      { nom: "Lait", quantite: "1 L", manuel: false, coche: false },
      { nom: "Lait", quantite: "500 mL", manuel: false, coche: false },
    ]
    m.cocherArticle.mockResolvedValue({ modifie: false, candidats })
    const { client, appels } = creerSupabaseMock({
      rpc: { demande_panier_en_cours: { data: { id: DEMANDE, ancre: ANCRE, pris_le: "2026-11-03T11:00:00Z" }, error: null } },
    })

    const resultat = await cocherArticleDemande(client, { libelle: "lait" }, AUJOURDHUI)

    expect(resultat).toEqual({ modifie: false, candidats })
    expect(appels).toEqual([])
  })
})
