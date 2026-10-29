// Tests de la logique calendaire — lib/semaines.ts (US-11, RG-21).
// Dates explicites pour des assertions déterministes (indépendantes du jour
// où la suite tourne).

import { describe, expect, it } from "vitest";
import {
  aujourdhuiParis,
  decalageEntre,
  formaterSemaine,
  libelleRelatif,
  saisonDeSemaine,
  semaineDecalee,
  semaineISO,
  semaineParDefaut,
  semainesSelectionnables,
} from "@/lib/semaines";

// Repères : le 1er juin 2026 est un lundi → semaine ISO 2026-W23
// (cohérent avec l'exemple des SPECS et formaterSemaine).
const LUNDI_1ER_JUIN = new Date(2026, 5, 1);
const SAMEDI_6_JUIN = new Date(2026, 5, 6);
const DIMANCHE_7_JUIN = new Date(2026, 5, 7);

describe("semaineISO", () => {
  it("calcule l'identifiant ISO d'une date", () => {
    expect(semaineISO(LUNDI_1ER_JUIN)).toBe("2026-W23");
  });

  it("gère le bord d'année (année ISO du jeudi)", () => {
    // Le 1er janvier 2027 est un vendredi → appartient à la semaine 53 de 2026.
    expect(semaineISO(new Date(2027, 0, 1))).toBe("2026-W53");
  });
});

describe("formaterSemaine", () => {
  it("rend une date lisible en français", () => {
    expect(formaterSemaine("2026-W23")).toBe("Semaine du 1 juin 2026");
  });

  it("affiche brut un format inattendu", () => {
    expect(formaterSemaine("pas-une-semaine")).toBe("Semaine pas-une-semaine");
  });

  it("est l'inverse de semaineISO pour un lundi", () => {
    expect(formaterSemaine(semaineISO(LUNDI_1ER_JUIN))).toBe(
      "Semaine du 1 juin 2026"
    );
  });
});

describe("semainesSelectionnables", () => {
  it("renvoie la semaine courante + N futures (offsets 0..N)", () => {
    const options = semainesSelectionnables(LUNDI_1ER_JUIN, 6);
    expect(options).toHaveLength(7);
    expect(options.map((o) => o.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(options[0]!.semaine).toBe("2026-W23");
    expect(options[1]!.semaine).toBe("2026-W24");
    expect(options[6]!.semaine).toBe("2026-W29");
  });

  it("respecte le nombre de semaines futures demandé", () => {
    expect(semainesSelectionnables(LUNDI_1ER_JUIN, 2)).toHaveLength(3);
  });
});

describe("libelleRelatif", () => {
  it("nomme les offsets proches et numérote au-delà (passé et futur)", () => {
    expect(libelleRelatif(0)).toBe("Cette semaine");
    expect(libelleRelatif(1)).toBe("Semaine prochaine");
    expect(libelleRelatif(3)).toBe("Dans 3 semaines");
    expect(libelleRelatif(-1)).toBe("Semaine dernière");
    expect(libelleRelatif(-4)).toBe("Il y a 4 semaines");
  });
});

describe("decalageEntre", () => {
  it("compte les semaines de a vers b (signé)", () => {
    expect(decalageEntre("2026-W23", "2026-W23")).toBe(0);
    expect(decalageEntre("2026-W23", "2026-W26")).toBe(3);
    expect(decalageEntre("2026-W23", "2026-W20")).toBe(-3);
    expect(decalageEntre("2026-W53", "2027-W01")).toBe(1);
  });
});

describe("semaineDecalee (#5)", () => {
  it("avance et recule de N semaines", () => {
    expect(semaineDecalee("2026-W23", 0)).toBe("2026-W23");
    expect(semaineDecalee("2026-W23", 1)).toBe("2026-W24");
    expect(semaineDecalee("2026-W23", -12)).toBe("2026-W11");
  });

  it("franchit les bords d'année", () => {
    // 2026 compte 53 semaines ISO → W53 + 1 = première semaine 2027.
    expect(semaineDecalee("2026-W53", 1)).toBe("2027-W01");
    expect(semaineDecalee("2027-W01", -1)).toBe("2026-W53");
  });

  // Round-trip semaineDecalee(s, 0) === s = semaineISO(lundiDeSemaine(s)) :
  // garde-fou du référentiel calendaire (#171). Verrouille la cohérence
  // lundiDeSemaine (local) ↔ semaineISO (getters locaux) : un passage erroné en
  // UTC casserait cette identité sur certaines semaines / fuseaux.
  it("round-trip exact sur des semaines variées et aux bords d'année (#171)", () => {
    for (const s of [
      "2025-W01", "2025-W52", "2026-W01", "2026-W23", "2026-W53",
      "2027-W01", "2028-W09", "2030-W52",
    ]) {
      expect(semaineDecalee(s, 0)).toBe(s);
    }
  });
});

describe("saisonDeSemaine (#23, RG-02)", () => {
  it("dérive la saison du jeudi de la semaine", () => {
    // 2026-W23 = semaine du lundi 1er juin → jeudi 4 juin → été.
    expect(saisonDeSemaine("2026-W23")).toBe("ete");
    // Semaine de fin décembre → hiver.
    expect(saisonDeSemaine(semaineISO(new Date(2026, 11, 15)))).toBe("hiver");
    // Mi-octobre → automne.
    expect(saisonDeSemaine(semaineISO(new Date(2026, 9, 15)))).toBe("automne");
    // Mi-avril → printemps.
    expect(saisonDeSemaine(semaineISO(new Date(2026, 3, 15)))).toBe("printemps");
  });
});

describe("semaineParDefaut (RG-21)", () => {
  it("en semaine, propose la semaine courante", () => {
    expect(semaineParDefaut(LUNDI_1ER_JUIN)).toBe("2026-W23");
  });

  it("le samedi, propose la semaine prochaine", () => {
    expect(semaineParDefaut(SAMEDI_6_JUIN)).toBe("2026-W24");
  });

  it("le dimanche, propose la semaine prochaine", () => {
    expect(semaineParDefaut(DIMANCHE_7_JUIN)).toBe("2026-W24");
  });
});

describe("aujourdhuiParis (jumeau /courses : date du foyer, pas UTC du serveur)", () => {
  it("vendredi 23h30 UTC = samedi 00h30 à Paris (heure d’hiver) → samedi", () => {
    const d = aujourdhuiParis(new Date("2026-10-30T23:30:00Z"))
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()]).toEqual([2026, 9, 31, 6])
  })

  it("heure d'hiver : samedi 23h30 UTC = dimanche 00h30 à Paris", () => {
    const d = aujourdhuiParis(new Date("2026-10-31T23:30:00Z"))
    expect([d.getMonth(), d.getDate()]).toEqual([10, 1])
  })

  it("en journée, même jour qu'à Paris", () => {
    const d = aujourdhuiParis(new Date("2026-10-29T10:00:00Z"))
    expect([d.getMonth(), d.getDate()]).toEqual([9, 29])
  })
})
