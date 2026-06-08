// Tests unitaires — réglages de génération (#45, P09), cœur pur lib/reglages.ts.

import { describe, test, expect } from "vitest";
import {
  ORDRE_TEMPS,
  rangTemps,
  tempsAuPlafond,
  REGLAGES_DEFAUT,
  validerReglages,
  dbReglagesToDomain,
  reglagesToDb,
} from "@/lib/reglages";
import type { DbReglages, ReglagesGeneration } from "@/types";

describe("ordre des temps", () => {
  test("rapide < normal < long", () => {
    expect(ORDRE_TEMPS).toEqual(["rapide", "normal", "long"]);
    expect(rangTemps("rapide")).toBe(0);
    expect(rangTemps("normal")).toBe(1);
    expect(rangTemps("long")).toBe(2);
  });
});

describe("tempsAuPlafond — éligibilité ≤ plafond", () => {
  test("rapide n'autorise que rapide", () => {
    expect(tempsAuPlafond("rapide")).toEqual(["rapide"]);
  });
  test("normal autorise rapide + normal", () => {
    expect(tempsAuPlafond("normal")).toEqual(["rapide", "normal"]);
  });
  test("long autorise tout", () => {
    expect(tempsAuPlafond("long")).toEqual(["rapide", "normal", "long"]);
  });
});

describe("REGLAGES_DEFAUT — reproduit le comportement antérieur", () => {
  test("dîner semaine rapide, déjeuner semaine normal, week-end long, 2 personnes", () => {
    expect(REGLAGES_DEFAUT).toEqual({
      personnesDefaut: 2,
      plafonds: {
        dejeunerSemaine: "normal",
        dinerSemaine: "rapide",
        dejeunerWeekend: "long",
        dinerWeekend: "long",
      },
    });
  });
});

describe("validerReglages", () => {
  const valide: ReglagesGeneration = {
    personnesDefaut: 4,
    plafonds: {
      dejeunerSemaine: "long",
      dinerSemaine: "normal",
      dejeunerWeekend: "rapide",
      dinerWeekend: "long",
    },
  };

  test("accepte et normalise des réglages valides", () => {
    expect(validerReglages(valide)).toEqual(valide);
  });

  test("refuse un plafond hors enum", () => {
    expect(
      validerReglages({
        ...valide,
        plafonds: { ...valide.plafonds, dinerSemaine: "express" },
      })
    ).toBeNull();
  });

  test("refuse un nombre de personnes hors bornes", () => {
    expect(validerReglages({ ...valide, personnesDefaut: 0 })).toBeNull();
    expect(validerReglages({ ...valide, personnesDefaut: 13 })).toBeNull();
  });

  test("refuse un nombre de personnes non entier", () => {
    expect(validerReglages({ ...valide, personnesDefaut: 2.5 })).toBeNull();
  });

  test("refuse une forme invalide", () => {
    expect(validerReglages(null)).toBeNull();
    expect(validerReglages({ personnesDefaut: 2 })).toBeNull(); // plafonds manquants
  });
});

describe("adaptateurs DB ↔ domaine", () => {
  const db: DbReglages = {
    personnes_defaut: 3,
    max_dejeuner_semaine: "normal",
    max_diner_semaine: "rapide",
    max_dejeuner_weekend: "long",
    max_diner_weekend: "long",
  };

  test("dbReglagesToDomain mappe les colonnes", () => {
    expect(dbReglagesToDomain(db)).toEqual({
      personnesDefaut: 3,
      plafonds: {
        dejeunerSemaine: "normal",
        dinerSemaine: "rapide",
        dejeunerWeekend: "long",
        dinerWeekend: "long",
      },
    });
  });

  test("aller-retour domaine → DB → domaine est l'identité", () => {
    const domaine = dbReglagesToDomain(db);
    expect(dbReglagesToDomain(reglagesToDb(domaine))).toEqual(domaine);
  });
});
