// Tests unitaires du nombre de personnes par repas — US-07, RG-16/17.
//   - défaut 2, bornes [1;12], conservation, immutabilité (RG-16)
//   - mise à l'échelle ×N/2 et arrondis par type d'unité (RG-17)

import { describe, test, expect } from "vitest";
import {
  arrondirQuantite,
  facteurEchelle,
  modifierPersonnes,
  personnesDuSlot,
  PERSONNES_DEFAUT,
  PERSONNES_MAX,
  PERSONNES_MIN,
} from "@/lib/personnes";
import type { JourPlanning, Planning, Recette, Unite } from "@/types";

function recette(id: string): Recette {
  return { id, nom: id, tempsPreparation: "rapide", ingredients: [] };
}

// Planning minimal : dîner chaque jour, déjeuner le week-end, sans réglage
// de personnes (champ absent → défaut 2).
function planning(): Planning {
  const jours: JourPlanning[] = [
    { jour: "lundi", diner: recette("l") },
    { jour: "mardi", diner: recette("ma") },
    { jour: "mercredi", diner: recette("me") },
    { jour: "jeudi", diner: recette("j") },
    { jour: "vendredi", diner: recette("v") },
    { jour: "samedi", dejeuner: recette("sd"), diner: recette("s") },
    { jour: "dimanche", dejeuner: recette("dd"), diner: recette("d") },
  ];
  return { semaine: "2026-W23", jours };
}

// ---------------------------------------------------------------------------
// RG-16 — valeur par défaut et lecture
// ---------------------------------------------------------------------------
describe("personnesDuSlot — défaut et lecture (RG-16)", () => {
  test("un slot sans réglage vaut le défaut (2)", () => {
    const jp = planning().jours[0]!;
    expect(personnesDuSlot(jp, "diner")).toBe(PERSONNES_DEFAUT);
    expect(PERSONNES_DEFAUT).toBe(2);
  });

  test("lit la valeur réglée du bon slot", () => {
    const jp: JourPlanning = {
      jour: "samedi",
      dejeuner: recette("sd"),
      diner: recette("s"),
      personnes: { dejeuner: 4, diner: 6 },
    };
    expect(personnesDuSlot(jp, "dejeuner")).toBe(4);
    expect(personnesDuSlot(jp, "diner")).toBe(6);
  });

  test("un slot partiellement réglé garde le défaut pour l'autre repas", () => {
    const jp: JourPlanning = {
      jour: "samedi",
      dejeuner: recette("sd"),
      diner: recette("s"),
      personnes: { diner: 5 },
    };
    expect(personnesDuSlot(jp, "dejeuner")).toBe(2);
    expect(personnesDuSlot(jp, "diner")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// RG-16 — modification : bornes, ciblage, immutabilité
// ---------------------------------------------------------------------------
describe("modifierPersonnes — modification (RG-16)", () => {
  test("règle le bon slot sans toucher aux autres", () => {
    const p = planning();
    const resultat = modifierPersonnes(p, "mardi", "diner", 4)!;
    expect(personnesDuSlot(resultat.jours[1]!, "diner")).toBe(4);
    for (let i = 0; i < resultat.jours.length; i++) {
      if (i === 1) continue;
      expect(resultat.jours[i]!.personnes).toBeUndefined();
    }
  });

  test("ne touche pas l'autre repas du même jour", () => {
    const p = planning();
    const resultat = modifierPersonnes(p, "samedi", "diner", 8)!;
    const samedi = resultat.jours.find((jp) => jp.jour === "samedi")!;
    expect(personnesDuSlot(samedi, "diner")).toBe(8);
    expect(personnesDuSlot(samedi, "dejeuner")).toBe(2); // défaut conservé
  });

  test("borne le minimum à 1", () => {
    const resultat = modifierPersonnes(planning(), "lundi", "diner", 0)!;
    expect(personnesDuSlot(resultat.jours[0]!, "diner")).toBe(PERSONNES_MIN);
  });

  test("borne le maximum à 12", () => {
    const resultat = modifierPersonnes(planning(), "lundi", "diner", 99)!;
    expect(personnesDuSlot(resultat.jours[0]!, "diner")).toBe(PERSONNES_MAX);
  });

  test("retourne null pour un slot inexistant (déjeuner en semaine)", () => {
    expect(modifierPersonnes(planning(), "lundi", "dejeuner", 4)).toBeNull();
  });

  test("ne mute jamais le planning d'origine et conserve la semaine", () => {
    const p = planning();
    const instantane = JSON.stringify(p);
    const resultat = modifierPersonnes(p, "jeudi", "diner", 6)!;
    expect(JSON.stringify(p)).toBe(instantane);
    expect(resultat.semaine).toBe(p.semaine);
  });
});

// ---------------------------------------------------------------------------
// RG-17 — facteur d'échelle
// ---------------------------------------------------------------------------
describe("facteurEchelle (RG-17)", () => {
  test("2 personnes = facteur 1 (recette de référence)", () => {
    expect(facteurEchelle(2)).toBe(1);
  });
  test("4 personnes = ×2, 1 personne = ÷2", () => {
    expect(facteurEchelle(4)).toBe(2);
    expect(facteurEchelle(1)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// RG-17 — arrondi par type d'unité
// ---------------------------------------------------------------------------
describe("arrondirQuantite — arrondi par unité (RG-17)", () => {
  test("comptables : entier supérieur (jamais à court)", () => {
    const comptables: Unite[] = [
      "piece", "briquette", "bouteille", "boite", "sachet", "autre",
    ];
    for (const u of comptables) {
      expect(arrondirQuantite(1.1, u)).toBe(2);
      expect(arrondirQuantite(3, u)).toBe(3); // entier exact inchangé
    }
  });

  test("mesures fines (g/ml/cl) : entier le plus proche", () => {
    expect(arrondirQuantite(150.4, "g")).toBe(150);
    expect(arrondirQuantite(150.5, "ml")).toBe(151);
    expect(arrondirQuantite(12.5, "cl")).toBe(13);
  });

  test("grosses mesures (kg/l) : une décimale", () => {
    expect(arrondirQuantite(1.34, "kg")).toBe(1.3);
    expect(arrondirQuantite(0.75, "l")).toBe(0.8);
  });

  test("cuillères (cas/cac) : au demi près", () => {
    expect(arrondirQuantite(2.25, "cas")).toBe(2.5);
    expect(arrondirQuantite(1.1, "cac")).toBe(1);
    expect(arrondirQuantite(0.7, "cas")).toBe(0.5);
  });
});
