import { describe, expect, it } from "vitest"
import {
  affichagePanier,
  estActive,
  heureLancement,
  messageEchec,
  resumeRapport,
  type DemandePanier,
  type EtatPanier,
} from "@/lib/panier-affichage"
import { MESSAGES_PANIER } from "@/lib/panier"
import type { RapportPanier } from "@/lib/panier"

const CYCLE = "2026-10-31"
const AUTRE_CYCLE = "2026-10-24"

const RAPPORT: RapportPanier = {
  ajoutes: [{ article: "Lait", produit: "Lait demi-écrémé", marque: "Marque", quantite: 2 }],
  a_choisir: [],
  introuvables: [],
}

function demande(surcharge: Partial<DemandePanier> = {}): DemandePanier {
  return {
    id: "d1",
    ancre: CYCLE,
    statut: "en_attente",
    cause_echec: null,
    motif_echec: null,
    rapport: null,
    rapport_tardif: false,
    cree_le: "2026-10-31T17:05:00Z",
    pris_le: null,
    termine_le: null,
    ...surcharge,
  }
}

/** `active` suit `derniere` quand elle est active, sauf précision (RPC `etat_panier`). */
const etat = (
  derniere: DemandePanier | null,
  options: { executeur?: boolean; active?: DemandePanier | null } = {}
): EtatPanier => ({
  executeur: options.executeur ?? true,
  derniere,
  active: options.active !== undefined ? options.active : estActive(derniere) ? derniere : null,
})

const cycle = (termine = false, ancre = CYCLE) => ({ ancre, termine })

describe("affichagePanier", () => {
  it("sans exécuteur → invisible", () => {
    expect(affichagePanier(etat(null, { executeur: false }), cycle(), false)).toEqual({
      visible: false,
    })
    expect(affichagePanier(etat(demande(), { executeur: false }), cycle(), true)).toEqual({
      visible: false,
    })
  })

  it("aucune demande → visible, bouton « remplir », sans rapport ni échec ni motif", () => {
    expect(affichagePanier(etat(null), cycle(), false)).toEqual({
      visible: true,
      bouton: "remplir",
      motifIndisponible: null,
      actif: false,
      lanceA: null,
      echec: null,
      rapport: null,
      tardif: false,
      termineA: null,
    })
  })

  it("cycle à venir sans demande → bouton « remplir », pas de motif", () => {
    const a = affichagePanier(etat(null), cycle(false, "2026-11-07"), false)
    expect(a).toMatchObject({ visible: true, bouton: "remplir", motifIndisponible: null })
  })

  it("cycle terminé → visible, motif OMQ04, rapport du cycle conservé", () => {
    const a = affichagePanier(
      etat(
        demande({
          ancre: AUTRE_CYCLE,
          statut: "terminee",
          rapport: RAPPORT,
          termine_le: "2026-10-31T17:32:00Z",
        })
      ),
      cycle(true, AUTRE_CYCLE),
      true
    )
    expect(a).toEqual({
      visible: true,
      bouton: "completer",
      motifIndisponible: MESSAGES_PANIER.OMQ04,
      actif: false,
      lanceA: null,
      echec: null,
      rapport: RAPPORT,
      tardif: false,
      termineA: "18 h 32",
    })
  })

  it("cycle terminé sans demande → visible, motif OMQ04 mot pour mot, rien d'autre", () => {
    const a = affichagePanier(etat(null), cycle(true, AUTRE_CYCLE), false)
    expect(a).toMatchObject({
      visible: true,
      bouton: "remplir",
      motifIndisponible:
        "Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir.",
      rapport: null,
      echec: null,
    })
  })

  it("cycle non terminé → pas de motif", () => {
    expect(affichagePanier(etat(null), cycle(false), false)).toMatchObject({
      motifIndisponible: null,
    })
  })

  it("en_attente ou en_cours → actif, lanceA = heure de cree_le à Paris", () => {
    for (const statut of ["en_attente", "en_cours"] as const) {
      const a = affichagePanier(etat(demande({ statut })), cycle(), false)
      expect(a).toMatchObject({ visible: true, actif: true, lanceA: "18 h 05" })
    }
  })

  it("cree_le invalide → lanceA null (pas de ligne d'heure)", () => {
    const a = affichagePanier(etat(demande({ cree_le: "pas une date" })), cycle(), false)
    expect(a).toMatchObject({ actif: true, lanceA: null })
  })

  it("demande active d'un autre cycle → actif, pas de rapport ni d'échec de l'autre cycle (RG-83)", () => {
    // `derniere` est celle du cycle demandé (RPC) : ici, aucune. La demande
    // active, elle, vient d'un autre cycle.
    const enCours = demande({ id: "d2", ancre: AUTRE_CYCLE, statut: "en_cours" })
    const a = affichagePanier(etat(null, { active: enCours }), cycle(), false)
    expect(a).toMatchObject({
      visible: true,
      actif: true,
      lanceA: "18 h 05",
      rapport: null,
      echec: null,
      termineA: null,
    })
  })

  it("demande active d'un autre cycle + rapport du cycle affiché → actif ET rapport du cycle affiché", () => {
    const enCours = demande({ id: "d2", ancre: AUTRE_CYCLE, statut: "en_cours" })
    const terminee = demande({
      statut: "terminee",
      rapport: RAPPORT,
      termine_le: "2026-10-31T17:32:00Z",
    })
    const a = affichagePanier(etat(terminee, { active: enCours }), cycle(), true)
    expect(a).toMatchObject({ actif: true, rapport: RAPPORT, bouton: "completer" })
  })

  it("derniere d'un autre cycle (réponse périmée) → ignorée", () => {
    const perimee = demande({
      statut: "terminee",
      ancre: AUTRE_CYCLE,
      rapport: RAPPORT,
      rapport_tardif: true,
    })
    const a = affichagePanier(etat(perimee), cycle(), true)
    expect(a).toMatchObject({ rapport: null, tardif: false, termineA: null, bouton: "remplir" })
  })

  it("terminee du cycle → rapport, tardif, heure de fin", () => {
    const a = affichagePanier(
      etat(
        demande({
          statut: "terminee",
          rapport: RAPPORT,
          rapport_tardif: true,
          termine_le: "2026-10-31T17:32:00Z",
        })
      ),
      cycle(),
      true
    )
    expect(a).toMatchObject({
      actif: false,
      lanceA: null,
      rapport: RAPPORT,
      tardif: true,
      echec: null,
      termineA: "18 h 32",
    })
  })

  it("terminee + articles cochés → « completer » ; terminee sans coche → « remplir » (tout décocher)", () => {
    const terminee = etat(demande({ statut: "terminee", rapport: RAPPORT }))
    expect(affichagePanier(terminee, cycle(), true)).toMatchObject({ bouton: "completer" })
    expect(affichagePanier(terminee, cycle(), false)).toMatchObject({ bouton: "remplir" })
  })

  it("terminee sans rapport + coches → « completer », rapport null", () => {
    const a = affichagePanier(etat(demande({ statut: "terminee", rapport: null })), cycle(), true)
    expect(a).toMatchObject({ rapport: null, tardif: false, bouton: "completer", echec: null })
  })

  it("echec ou aucune demande, même avec des coches → « remplir »", () => {
    const echec = demande({ statut: "echec", cause_echec: "non_prise", motif_echec: "Pas pris." })
    expect(affichagePanier(etat(echec), cycle(), true)).toMatchObject({ bouton: "remplir" })
    expect(affichagePanier(etat(null), cycle(), true)).toMatchObject({ bouton: "remplir" })
  })

  it("echec du cycle → message ; echec d'un autre cycle → null", () => {
    const echec = demande({ statut: "echec", cause_echec: "non_prise", motif_echec: "Pas pris." })
    expect(affichagePanier(etat(echec), cycle(), false)).toMatchObject({
      actif: false,
      echec: "Pas pris.",
      rapport: null,
    })
    expect(affichagePanier(etat({ ...echec, ancre: AUTRE_CYCLE }), cycle(), false)).toMatchObject({
      echec: null,
    })
  })

  it("echec cause executeur → message « problème signalé » câblé sur la cause", () => {
    const a = affichagePanier(
      etat(demande({ statut: "echec", cause_echec: "executeur", motif_echec: "Session expirée" })),
      cycle(),
      false
    )
    expect(a).toMatchObject({ echec: "Ton exécuteur a signalé un problème : Session expirée" })
  })

  it("echec avec rapport partiel non vide → échec ET rapport (A1)", () => {
    const a = affichagePanier(
      etat(
        demande({
          statut: "echec",
          cause_echec: "executeur",
          motif_echec: "Session expirée",
          rapport: RAPPORT,
          termine_le: "2026-10-31T17:32:00Z",
        })
      ),
      cycle(),
      false
    )
    expect(a).toMatchObject({
      echec: "Ton exécuteur a signalé un problème : Session expirée",
      rapport: RAPPORT,
      bouton: "remplir",
      termineA: "18 h 32",
    })
  })

  it("echec avec rapport aux trois listes vides → pas de rapport", () => {
    const a = affichagePanier(
      etat(
        demande({
          statut: "echec",
          cause_echec: "executeur",
          motif_echec: "Session expirée",
          rapport: { ajoutes: [], a_choisir: [], introuvables: [] },
        })
      ),
      cycle(),
      false
    )
    expect(a).toMatchObject({ rapport: null })
  })
})

describe("estActive", () => {
  it("vrai seulement pour en_attente et en_cours", () => {
    expect(estActive(null)).toBe(false)
    expect(estActive(demande({ statut: "en_attente" }))).toBe(true)
    expect(estActive(demande({ statut: "en_cours" }))).toBe(true)
    expect(estActive(demande({ statut: "terminee" }))).toBe(false)
    expect(estActive(demande({ statut: "echec" }))).toBe(false)
  })
})

describe("messageEchec", () => {
  it("injoignable → message en mots simples, sans le motif technique (C3)", () => {
    for (const motif of ["réponse HTTP 500", "erreur réseau", null]) {
      expect(messageEchec("injoignable", motif)).toBe(
        "Ton exécuteur n’a pas répondu. Vérifie qu’il est allumé, puis réessaie."
      )
    }
  })

  it("non_prise et delai_depasse → motif tel quel", () => {
    expect(messageEchec("non_prise", "Ton exécuteur n’a pas pris la demande.")).toBe(
      "Ton exécuteur n’a pas pris la demande."
    )
    expect(messageEchec("delai_depasse", "Trop long.")).toBe("Trop long.")
  })

  it("executeur → problème signalé", () => {
    expect(messageEchec("executeur", "Session expirée")).toBe(
      "Ton exécuteur a signalé un problème : Session expirée"
    )
  })

  it("motif absent → message générique, sauf injoignable", () => {
    for (const cause of ["non_prise", "delai_depasse", "executeur", null] as const) {
      expect(messageEchec(cause, null)).toBe("Le panier n’a pas pu être constitué.")
    }
  })

  it("cause absente avec motif → motif tel quel", () => {
    expect(messageEchec(null, "Raison")).toBe("Raison")
  })
})

describe("resumeRapport", () => {
  const rapport = (a: number, c: number, i: number): RapportPanier => ({
    ajoutes: Array.from({ length: a }, (_, n) => ({
      article: `a${n}`,
      produit: "p",
      marque: "m",
      quantite: 1,
    })),
    a_choisir: Array.from({ length: c }, (_, n) => ({
      article: `c${n}`,
      raison: "r",
      candidats: [],
    })),
    introuvables: Array.from({ length: i }, (_, n) => ({ article: `i${n}` })),
  })

  it("accorde les pluriels", () => {
    expect(resumeRapport(rapport(30, 5, 1))).toBe("30 ajoutés · 5 à choisir · 1 introuvable")
    expect(resumeRapport(rapport(1, 1, 2))).toBe("1 ajouté · 1 à choisir · 2 introuvables")
    expect(resumeRapport(rapport(0, 0, 0))).toBe("0 ajouté · 0 à choisir · 0 introuvable")
  })
})

describe("heureLancement", () => {
  it("heure d'été et d'hiver à Paris, format HH h MM", () => {
    expect(heureLancement("2026-10-31T17:05:00Z")).toBe("18 h 05")
    expect(heureLancement("2026-12-01T08:09:00Z")).toBe("09 h 09")
  })

  it("date invalide → chaîne vide (B1)", () => {
    expect(heureLancement("pas une date")).toBe("")
    expect(heureLancement("")).toBe("")
  })
})
