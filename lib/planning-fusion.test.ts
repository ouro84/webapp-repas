import { describe, expect, it } from "vitest"
import {
  creneauxModifies,
  fusionnerEditionsLocales,
} from "@/lib/planning-fusion"
import { signaturePlanning } from "@/lib/planning-diff"
import type { Planning, Recette } from "@/types"

function recette(id: string): Recette {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] }
}

/** Planning de base : lundi dîner r1, mardi déjeuner r2, mardi dîner r3. */
function base(): Planning {
  return {
    semaine: "2026-W45",
    jours: [
      { jour: "lundi", diner: recette("r1") },
      { jour: "mardi", dejeuner: recette("r2"), diner: recette("r3") },
    ],
  }
}

function avecJour(
  p: Planning,
  jour: string,
  f: (jp: Planning["jours"][number]) => Planning["jours"][number]
): Planning {
  return { ...p, jours: p.jours.map((jp) => (jp.jour === jour ? f(jp) : jp)) }
}

describe("creneauxModifies", () => {
  it("plannings identiques → aucun créneau", () => {
    expect(creneauxModifies(base(), base()).size).toBe(0)
  })

  it("détecte recette, personnes et restes", () => {
    const autre = avecJour(
      avecJour(
        avecJour(base(), "lundi", (jp) => ({ ...jp, diner: recette("rX") })),
        "mardi",
        (jp) => ({ ...jp, personnes: { dejeuner: 4 } })
      ),
      "mardi",
      (jp) => ({ ...jp, restes: { diner: true } })
    )
    expect([...creneauxModifies(base(), autre)].sort()).toEqual([
      "lundi:diner",
      "mardi:dejeuner",
      "mardi:diner",
    ])
  })

  it("personnes absentes vs 2 explicite n’est pas une modification", () => {
    const explicite = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      personnes: { diner: 2 },
      restes: { diner: false },
    }))
    expect(creneauxModifies(base(), explicite).size).toBe(0)
  })

  it("jour manquant d’un côté : créneaux présents comptés comme modifiés", () => {
    const sansMardi: Planning = { ...base(), jours: [base().jours[0]] }
    expect([...creneauxModifies(base(), sansMardi)].sort()).toEqual([
      "mardi:dejeuner",
      "mardi:diner",
    ])
  })
})

describe("fusionnerEditionsLocales", () => {
  it("aucune édition locale → distant tel quel", () => {
    const distant = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("rD"),
    }))
    const r = fusionnerEditionsLocales(base(), base(), distant)
    expect(r.planning).toEqual(distant)
    expect(r.rejoues).toEqual([])
    expect(r.conflits).toEqual([])
  })

  it("stepper local + autre créneau modifié à distance → les deux", () => {
    const local = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      personnes: { diner: 4 },
    }))
    const distant = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("rD"),
    }))
    const r = fusionnerEditionsLocales(base(), local, distant)
    expect(r.rejoues).toEqual(["lundi:diner"])
    expect(r.conflits).toEqual([])
    const lundi = r.planning.jours.find((jp) => jp.jour === "lundi")
    expect(lundi?.personnes?.diner).toBe(4)
    const mardi = r.planning.jours.find((jp) => jp.jour === "mardi")
    expect(mardi?.dejeuner?.id).toBe("rD")
    // Le distant n’est pas muté.
    expect(distant.jours[0].personnes).toBeUndefined()
  })

  it("même créneau modifié des deux côtés → le distant gagne", () => {
    const local = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      diner: recette("rA"),
    }))
    const distant = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      diner: recette("rB"),
    }))
    const r = fusionnerEditionsLocales(base(), local, distant)
    expect(r.planning.jours[0].diner?.id).toBe("rB")
    expect(r.conflits).toEqual(["lundi:diner"])
    expect(r.rejoues).toEqual([])
    expect(signaturePlanning(r.planning)).toBe(signaturePlanning(distant))
  })

  it("restes marqués localement, rien à distance → conservés", () => {
    const local = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      restes: { diner: true },
    }))
    const r = fusionnerEditionsLocales(base(), local, base())
    expect(r.rejoues).toEqual(["mardi:diner"])
    const mardi = r.planning.jours.find((jp) => jp.jour === "mardi")
    expect(mardi?.restes?.diner).toBe(true)
    expect(mardi?.diner?.id).toBe("r3")
  })

  it("restes démarqués localement → démarqués dans la fusion", () => {
    const confirme = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      restes: { diner: true },
    }))
    const local = base()
    const r = fusionnerEditionsLocales(confirme, local, confirme)
    expect(r.rejoues).toEqual(["mardi:diner"])
    const mardi = r.planning.jours.find((jp) => jp.jour === "mardi")
    expect(mardi?.restes?.diner).not.toBe(true)
  })

  it("créneau vidé à distance et modifié localement → reste vide (conflit)", () => {
    const local = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      personnes: { diner: 3 },
    }))
    const distant = avecJour(base(), "lundi", (jp) => ({
      jour: jp.jour,
    }))
    const r = fusionnerEditionsLocales(base(), local, distant)
    expect(r.planning.jours[0].diner).toBeUndefined()
    expect(r.conflits).toEqual(["lundi:diner"])
    expect(r.rejoues).toEqual([])
  })

  it("créneau vidé localement, intact à distance → vidé dans la fusion", () => {
    const local = avecJour(base(), "lundi", (jp) => ({ jour: jp.jour }))
    const r = fusionnerEditionsLocales(base(), local, base())
    expect(r.planning.jours[0].diner).toBeUndefined()
    expect(r.rejoues).toEqual(["lundi:diner"])
  })

  it("personnes absentes vs 2 explicites : jamais une modification", () => {
    const confirme = base()
    const local = avecJour(base(), "lundi", (jp) => ({
      ...jp,
      personnes: { diner: 2 },
    }))
    const distant = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("rD"),
    }))
    const r = fusionnerEditionsLocales(confirme, local, distant)
    expect(r.rejoues).toEqual([])
    expect(r.conflits).toEqual([])
    expect(r.planning).toEqual(distant)
  })

  it("jour absent du distant, créneau modifié localement → jour recréé à sa place", () => {
    const local = avecJour(base(), "mardi", (jp) => ({
      ...jp,
      personnes: { diner: 5 },
    }))
    const distant: Planning = { ...base(), jours: [base().jours[0]] }
    const confirme = distant
    const r = fusionnerEditionsLocales(confirme, local, distant)
    // mardi:diner modifié localement (≠ confirmé où mardi manque) ; le distant
    // (= confirmé) ne l’a pas touché → rejoué avec le contenu local.
    expect(r.rejoues).toEqual(["mardi:dejeuner", "mardi:diner"])
    expect(r.planning.jours.map((jp) => jp.jour)).toEqual(["lundi", "mardi"])
    expect(r.planning.jours[1].diner?.id).toBe("r3")
    expect(r.planning.jours[1].personnes?.diner).toBe(5)
  })
})
