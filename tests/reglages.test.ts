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
  auMoinsUnCreneauActif,
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

describe("tempsAuPlafond — « Aucun » (#217, RG-44)", () => {
  test("aucun n'autorise aucun temps (créneau non généré)", () => {
    expect(tempsAuPlafond("aucun")).toEqual([]);
  });
});

describe("auMoinsUnCreneauActif (#217, RG-47)", () => {
  test("vrai si au moins un créneau a un plafond de temps", () => {
    expect(
      auMoinsUnCreneauActif({
        dejeunerSemaine: "aucun",
        dinerSemaine: "aucun",
        dejeunerWeekend: "aucun",
        dinerWeekend: "rapide",
      })
    ).toBe(true);
  });

  test("faux si les 4 créneaux sont à « Aucun »", () => {
    expect(
      auMoinsUnCreneauActif({
        dejeunerSemaine: "aucun",
        dinerSemaine: "aucun",
        dejeunerWeekend: "aucun",
        dinerWeekend: "aucun",
      })
    ).toBe(false);
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

  test("normalise la préférence végé (#86 PR2) quand elle est présente", () => {
    const avecVege = validerReglages({
      ...valide,
      vegetarienPrefere: { dejeunerSemaine: true, dinerSemaine: false },
    });
    // Les créneaux absents ou non booléens sont ramenés à false.
    expect(avecVege?.vegetarienPrefere).toEqual({
      dejeunerSemaine: true,
      dinerSemaine: false,
      dejeunerWeekend: false,
      dinerWeekend: false,
    });
  });

  test("absente, la préférence végé n'est pas ajoutée (pas de régression)", () => {
    expect(validerReglages(valide)?.vegetarienPrefere).toBeUndefined();
  });

  test("mix accompagnement (#49 PR2) : présent posé, absent ignoré", () => {
    expect(
      validerReglages({ ...valide, mixAccompagnementJour: true })
        ?.mixAccompagnementJour
    ).toBe(true);
    // Absent → non posé (pas de régression).
    expect(validerReglages(valide)?.mixAccompagnementJour).toBeUndefined();
  });

  test("saisonnalité (#23 PR2) : présent posé (même false), absent ignoré", () => {
    expect(
      validerReglages({ ...valide, saisonnalite: false })?.saisonnalite
    ).toBe(false);
    // Absent → non posé (l'absence vaut ON par défaut côté générateur).
    expect(validerReglages(valide)?.saisonnalite).toBeUndefined();
  });

  test("refuse un plafond hors enum", () => {
    expect(
      validerReglages({
        ...valide,
        plafonds: { ...valide.plafonds, dinerSemaine: "express" },
      })
    ).toBeNull();
  });

  test("accepte « aucun » comme plafond (#217, RG-44)", () => {
    expect(
      validerReglages({
        ...valide,
        plafonds: { ...valide.plafonds, dinerSemaine: "aucun" },
      })
    ).toEqual({
      ...valide,
      plafonds: { ...valide.plafonds, dinerSemaine: "aucun" },
    });
  });

  test("refuse une config où les 4 créneaux sont « aucun » (#217, RG-47)", () => {
    expect(
      validerReglages({
        ...valide,
        plafonds: {
          dejeunerSemaine: "aucun",
          dinerSemaine: "aucun",
          dejeunerWeekend: "aucun",
          dinerWeekend: "aucun",
        },
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
    user_id: "u1",
    personnes_defaut: 3,
    max_dejeuner_semaine: "normal",
    max_diner_semaine: "rapide",
    max_dejeuner_weekend: "long",
    max_diner_weekend: "long",
    vege_dejeuner_semaine: true,
    vege_diner_semaine: false,
    vege_dejeuner_weekend: false,
    vege_diner_weekend: true,
    mix_accompagnement_jour: true,
    saisonnalite: false,
    updated_at: "2026-06-01T00:00:00Z",
  };

  test("dbReglagesToDomain mappe les colonnes (plafonds + végé + mix + saison)", () => {
    expect(dbReglagesToDomain(db)).toEqual({
      personnesDefaut: 3,
      plafonds: {
        dejeunerSemaine: "normal",
        dinerSemaine: "rapide",
        dejeunerWeekend: "long",
        dinerWeekend: "long",
      },
      vegetarienPrefere: {
        dejeunerSemaine: true,
        dinerSemaine: false,
        dejeunerWeekend: false,
        dinerWeekend: true,
      },
      mixAccompagnementJour: true,
      saisonnalite: false,
    });
  });

  test("aller-retour domaine → DB → domaine est l'identité", () => {
    const domaine = dbReglagesToDomain(db);
    expect(dbReglagesToDomain(reglagesToDb(domaine))).toEqual(domaine);
  });
});
