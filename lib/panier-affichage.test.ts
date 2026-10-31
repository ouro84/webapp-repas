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

const etat = (derniere: DemandePanier | null, executeur = true): EtatPanier => ({
  executeur,
  derniere,
})

describe("affichagePanier", () => {
  it("sans exécuteur → invisible", () => {
    expect(affichagePanier(etat(null, false), CYCLE, CYCLE)).toEqual({ visible: false })
    expect(affichagePanier(etat(demande(), false), CYCLE, CYCLE)).toEqual({ visible: false })
  })

  it("cycle affiché ≠ cycle courant → invisible", () => {
    expect(affichagePanier(etat(null), AUTRE_CYCLE, CYCLE)).toEqual({ visible: false })
  })

  it("aucune demande → visible, inactif, sans rapport ni échec", () => {
    expect(affichagePanier(etat(null), CYCLE, CYCLE)).toEqual({
      visible: true,
      actif: false,
      lanceA: null,
      echec: null,
      rapport: null,
      tardif: false,
    })
  })

  it("en_attente ou en_cours → actif, lanceA = heure de cree_le à Paris", () => {
    for (const statut of ["en_attente", "en_cours"] as const) {
      const a = affichagePanier(etat(demande({ statut })), CYCLE, CYCLE)
      expect(a).toMatchObject({ visible: true, actif: true, lanceA: "18 h 05" })
    }
  })

  it("demande active d'un autre cycle → actif quand même (RG-83)", () => {
    const a = affichagePanier(etat(demande({ ancre: AUTRE_CYCLE })), CYCLE, CYCLE)
    expect(a).toMatchObject({ visible: true, actif: true, lanceA: "18 h 05", rapport: null, echec: null })
  })

  it("terminee du cycle → rapport et tardif repris", () => {
    const a = affichagePanier(
      etat(demande({ statut: "terminee", rapport: RAPPORT, rapport_tardif: true })),
      CYCLE,
      CYCLE
    )
    expect(a).toMatchObject({ actif: false, lanceA: null, rapport: RAPPORT, tardif: true, echec: null })
  })

  it("rapport d'un autre cycle → rapport null", () => {
    const a = affichagePanier(
      etat(demande({ statut: "terminee", ancre: AUTRE_CYCLE, rapport: RAPPORT, rapport_tardif: true })),
      CYCLE,
      CYCLE
    )
    expect(a).toMatchObject({ rapport: null, tardif: false })
  })

  it("echec du cycle → message ; échec d'un autre cycle → null", () => {
    const echec = demande({ statut: "echec", cause_echec: "non_prise", motif_echec: "Pas pris." })
    expect(affichagePanier(etat(echec), CYCLE, CYCLE)).toMatchObject({
      actif: false,
      echec: "Pas pris.",
      rapport: null,
    })
    expect(affichagePanier(etat({ ...echec, ancre: AUTRE_CYCLE }), CYCLE, CYCLE)).toMatchObject({
      echec: null,
    })
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
  it("injoignable → motif entre parenthèses", () => {
    expect(messageEchec("injoignable", "délai dépassé")).toBe(
      "Ton exécuteur n’a pas répondu (délai dépassé)."
    )
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

  it("motif absent → message générique, quelle que soit la cause", () => {
    for (const cause of ["injoignable", "non_prise", "delai_depasse", "executeur", null] as const) {
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
})
