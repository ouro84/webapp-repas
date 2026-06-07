// Tests unitaires du générateur de planning — RG-01 à RG-04
// (SPECS_FONCTIONNELLES.md section 6) + structure du planning (section 5.5).
//
// Données : les fixtures de tests/fixtures/recettes.ts (15 recettes —
// 12 rapides/normales, 3 longues), parfois filtrées en sous-ensembles
// pour rendre certains comportements déterministes malgré l'aléatoire (RG-03).
// Découplé de data/recettes.json (issue #29) : le vrai dataset peut évoluer
// librement sans casser ces tests.

import { describe, test, expect } from "vitest";
import {
  analyserVivier,
  genererPlanning,
  recettesUtilisees,
  remplacerRecetteDansPlanning,
  remplacerSlot,
  remplacerSlotManuel,
} from "@/lib/generateur";
import { RECETTES_FIXTURES } from "@/tests/fixtures/recettes";
import type { Jour, Planning, Recette } from "@/types";

const RECETTES = RECETTES_FIXTURES;
const RAPIDES_NORMALES = RECETTES.filter((r) => r.tempsPreparation !== "long");
const LONGUES = RECETTES.filter((r) => r.tempsPreparation === "long");

const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
const ORDRE_JOURS: Jour[] = [...JOURS_SEMAINE, "samedi", "dimanche"];

// Tous les repas d'un planning, tous slots confondus.
function tousLesRepas(planning: Planning): Recette[] {
  return planning.jours.flatMap((jp) =>
    jp.dejeuner ? [jp.dejeuner, jp.diner] : [jp.diner]
  );
}

// Dîners du lundi au vendredi uniquement.
function dinersDeSemaine(planning: Planning): Recette[] {
  return planning.jours
    .filter((jp) => JOURS_SEMAINE.includes(jp.jour))
    .map((jp) => jp.diner);
}

// ---------------------------------------------------------------------------
// Section 5.5 — composition du planning : 7 jours lundi → dimanche,
// un dîner chaque jour, un déjeuner uniquement le samedi et le dimanche.
// ---------------------------------------------------------------------------
describe("genererPlanning — structure du planning (section 5.5)", () => {
  test("produit 7 jours dans l'ordre lundi → dimanche", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.jours.map((jp) => jp.jour)).toEqual(ORDRE_JOURS);
  });

  test("sert un dîner chaque jour et un déjeuner uniquement le week-end", () => {
    const planning = genererPlanning(RECETTES);
    for (const jp of planning.jours) {
      expect(jp.diner).toBeDefined();
      if (jp.jour === "samedi" || jp.jour === "dimanche") {
        expect(jp.dejeuner).toBeDefined();
      } else {
        expect(jp.dejeuner).toBeUndefined();
      }
    }
  });

  test("identifie la semaine au format ISO AAAA-Wnn", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.semaine).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// RG-01 — Éligibilité par jour : lundi → vendredi, seules les recettes
// "rapide" ou "normal" sont éligibles ; le week-end, toutes le sont.
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-01 éligibilité par jour", () => {
  test("ne sert jamais de recette longue un soir de semaine", () => {
    // L'aléatoire (RG-03) impose de répéter : 25 générations sur le vivier complet.
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      for (const diner of dinersDeSemaine(planning)) {
        expect(diner.tempsPreparation).not.toBe("long");
      }
    }
  });

  test("sert les recettes longues le week-end quand le vivier l'impose", () => {
    // Vivier de 9 recettes pour 9 slots : 6 rapides/normales + les 3 longues.
    // Les 5 dîners de semaine consomment 5 rapides/normales : les 3 longues
    // ne peuvent finir que sur les 4 slots du week-end — et le planning
    // doit quand même aboutir.
    const vivier = [...RAPIDES_NORMALES.slice(0, 6), ...LONGUES];
    const planning = genererPlanning(vivier);

    const idsWeekend = planning.jours
      .filter((jp) => jp.jour === "samedi" || jp.jour === "dimanche")
      .flatMap((jp) => [jp.dejeuner!.id, jp.diner.id]);
    for (const longue of LONGUES) {
      expect(idsWeekend).toContain(longue.id);
    }
  });
});

// ---------------------------------------------------------------------------
// RG-02 — Pas de répétition : une recette n'apparaît qu'une seule fois
// dans la semaine, quel que soit le slot (déjeuner ou dîner).
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-02 pas de répétition dans la semaine", () => {
  test("n'utilise jamais deux fois la même recette dans un planning", () => {
    for (let i = 0; i < 25; i++) {
      const repas = tousLesRepas(genererPlanning(RECETTES));
      const ids = repas.map((r) => r.id);
      expect(new Set(ids).size).toBe(repas.length); // 9 repas, 9 ids distincts
    }
  });
});

// ---------------------------------------------------------------------------
// RG-03 — Sélection aléatoire : parmi les recettes éligibles, le choix
// est aléatoire à chaque génération.
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-03 sélection aléatoire", () => {
  test("produit des plannings différents d'une génération à l'autre", () => {
    // 30 générations sur 15 recettes : la probabilité d'obtenir 30 fois
    // exactement la même semaine est nulle en pratique.
    const signatures = new Set<string>();
    for (let i = 0; i < 30; i++) {
      signatures.add(tousLesRepas(genererPlanning(RECETTES)).map((r) => r.id).join("|"));
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Garde-fou du générateur : si le vivier ne permet pas de remplir les
// 9 slots en respectant RG-01 et RG-02, la génération échoue explicitement
// (l'UI affiche alors l'état erreur, RG-09).
// ---------------------------------------------------------------------------
describe("genererPlanning — vivier insuffisant", () => {
  test("échoue explicitement avec moins de recettes que de slots", () => {
    expect(() => genererPlanning(RAPIDES_NORMALES.slice(0, 4))).toThrow();
  });

  test("échoue quand les dîners de semaine manquent de recettes rapides ou normales", () => {
    // 4 rapides/normales pour 5 dîners de semaine : impossible, même si
    // les recettes longues abondent pour le week-end.
    const vivier = [...RAPIDES_NORMALES.slice(0, 4), ...LONGUES];
    expect(() => genererPlanning(vivier)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RG-04 — Remplacement individuel : la nouvelle recette respecte RG-01
// et RG-02 ; s'il n'existe aucune recette éligible disponible, l'appel
// retourne null (l'UI affiche « Pas de recette disponible »).
// ---------------------------------------------------------------------------
describe("remplacerSlot — RG-04 remplacement individuel", () => {
  test("remplace le slot ciblé par une recette différente sans toucher aux autres", () => {
    const planning = genererPlanning(RECETTES);
    const resultat = remplacerSlot(planning, "mardi", "diner", RECETTES);

    expect(resultat).not.toBeNull();
    const avantMardi = planning.jours.find((jp) => jp.jour === "mardi")!.diner;
    const apresMardi = resultat!.jours.find((jp) => jp.jour === "mardi")!.diner;
    expect(apresMardi.id).not.toBe(avantMardi.id);

    // Tous les autres slots sont strictement inchangés.
    for (const jp of resultat!.jours) {
      if (jp.jour === "mardi") continue;
      const original = planning.jours.find((o) => o.jour === jp.jour)!;
      expect(jp.diner.id).toBe(original.diner.id);
      expect(jp.dejeuner?.id).toBe(original.dejeuner?.id);
    }
  });

  test("respecte l'éligibilité du jour : jamais de recette longue un soir de semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      const resultat = remplacerSlot(planning, "lundi", "diner", RECETTES);
      expect(resultat).not.toBeNull();
      const nouveau = resultat!.jours.find((jp) => jp.jour === "lundi")!.diner;
      expect(nouveau.tempsPreparation).not.toBe("long");
    }
  });

  test("ne choisit jamais une recette déjà servie ailleurs dans la semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      const resultat = remplacerSlot(planning, "samedi", "dejeuner", RECETTES);
      expect(resultat).not.toBeNull();

      const nouveau = resultat!.jours.find((jp) => jp.jour === "samedi")!.dejeuner!;
      const idsAutresSlots = tousLesRepas(planning)
        .map((r) => r.id)
        .filter((id) => id !== planning.jours.find((jp) => jp.jour === "samedi")!.dejeuner!.id);
      expect(idsAutresSlots).not.toContain(nouveau.id);
    }
  });

  test("retourne null quand toutes les recettes éligibles sont déjà utilisées", () => {
    // Vivier de 9 recettes = exactement les 9 slots : aucun remplaçant possible.
    const vivier = [...RAPIDES_NORMALES.slice(0, 6), ...LONGUES];
    const planning = genererPlanning(vivier);
    expect(remplacerSlot(planning, "dimanche", "dejeuner", vivier)).toBeNull();
  });

  test("retourne null pour un slot qui n'existe pas (déjeuner en semaine)", () => {
    const planning = genererPlanning(RECETTES);
    expect(remplacerSlot(planning, "lundi", "dejeuner", RECETTES)).toBeNull();
  });

  test("ne modifie jamais le planning d'origine", () => {
    const planning = genererPlanning(RECETTES);
    const instantane = JSON.stringify(planning);
    remplacerSlot(planning, "jeudi", "diner", RECETTES);
    expect(JSON.stringify(planning)).toBe(instantane);
  });

  test("conserve l'identifiant de semaine du planning d'origine", () => {
    const planning = genererPlanning(RECETTES);
    const resultat = remplacerSlot(planning, "vendredi", "diner", RECETTES);
    expect(resultat!.semaine).toBe(planning.semaine);
  });
});

// ---------------------------------------------------------------------------
// RG-15 — sélection manuelle d'une recette (US-06) : remplace le slot visé
// par la recette CHOISIE, by-passe RG-01 (temps) et RG-02 (unicité).
// ---------------------------------------------------------------------------
describe("remplacerSlotManuel — RG-15 sélection manuelle (US-06)", () => {
  test("remplace le slot visé par la recette choisie, sans toucher aux autres", () => {
    const planning = genererPlanning(RECETTES);
    const choisie = RAPIDES_NORMALES[0]!;
    const resultat = remplacerSlotManuel(planning, "mercredi", "diner", choisie);

    expect(resultat).not.toBeNull();
    expect(resultat!.jours.find((jp) => jp.jour === "mercredi")!.diner.id).toBe(
      choisie.id
    );
    for (const jp of resultat!.jours) {
      if (jp.jour === "mercredi") continue;
      const original = planning.jours.find((o) => o.jour === jp.jour)!;
      expect(jp.diner.id).toBe(original.diner.id);
      expect(jp.dejeuner?.id).toBe(original.dejeuner?.id);
    }
  });

  test("by-passe RG-01 : une recette « long » est permise un soir de semaine", () => {
    const planning = genererPlanning(RECETTES);
    const longue = LONGUES[0]!;
    const resultat = remplacerSlotManuel(planning, "mardi", "diner", longue);

    expect(resultat!.jours.find((jp) => jp.jour === "mardi")!.diner.id).toBe(
      longue.id
    );
  });

  test("by-passe RG-02 : le doublon est permis dans le planning", () => {
    const planning = genererPlanning(RECETTES);
    // La recette déjà servie au dîner de lundi est posée aussi le jeudi.
    const dejaServie = planning.jours.find((jp) => jp.jour === "lundi")!.diner;
    const resultat = remplacerSlotManuel(planning, "jeudi", "diner", dejaServie);

    const repas = tousLesRepas(resultat!);
    expect(repas.filter((r) => r.id === dejaServie.id)).toHaveLength(2);
  });

  test("fonctionne aussi sur un déjeuner de week-end", () => {
    const planning = genererPlanning(RECETTES);
    const choisie = LONGUES[1]!;
    const resultat = remplacerSlotManuel(planning, "dimanche", "dejeuner", choisie);

    expect(
      resultat!.jours.find((jp) => jp.jour === "dimanche")!.dejeuner!.id
    ).toBe(choisie.id);
  });

  test("retourne null pour un slot qui n'existe pas (déjeuner en semaine)", () => {
    const planning = genererPlanning(RECETTES);
    expect(
      remplacerSlotManuel(planning, "lundi", "dejeuner", RAPIDES_NORMALES[0]!)
    ).toBeNull();
  });

  test("ne modifie jamais le planning d'origine et conserve la semaine", () => {
    const planning = genererPlanning(RECETTES);
    const instantane = JSON.stringify(planning);
    const resultat = remplacerSlotManuel(
      planning,
      "vendredi",
      "diner",
      LONGUES[0]!
    );
    expect(JSON.stringify(planning)).toBe(instantane);
    expect(resultat!.semaine).toBe(planning.semaine);
  });
});

// ---------------------------------------------------------------------------
// recettesUtilisees — alimente le badge « déjà au planning » du sélecteur.
// ---------------------------------------------------------------------------
describe("recettesUtilisees — ids des recettes du planning (US-06)", () => {
  test("retourne les ids de tous les slots, déjeuners de week-end compris", () => {
    const planning = genererPlanning(RECETTES);
    const ids = recettesUtilisees(planning);

    // 9 slots, tous distincts (RG-02 respectée par la génération).
    expect(ids.size).toBe(9);
    for (const repas of tousLesRepas(planning)) {
      expect(ids.has(repas.id)).toBe(true);
    }
  });

  test("un doublon issu d'une sélection manuelle ne produit qu'un seul id", () => {
    const planning = genererPlanning(RECETTES);
    const dejaServie = planning.jours.find((jp) => jp.jour === "lundi")!.diner;
    const avecDoublon = remplacerSlotManuel(planning, "mardi", "diner", dejaServie)!;

    expect(recettesUtilisees(avecDoublon).size).toBe(8); // 9 slots, 8 recettes
  });
});

// ---------------------------------------------------------------------------
// remplacerRecetteDansPlanning — réinjection d'une recette éditée (#2, RG-03).
// ---------------------------------------------------------------------------
describe("remplacerRecetteDansPlanning — RG-03 (#2)", () => {
  test("met à jour tous les slots référençant la recette éditée", () => {
    const planning = genererPlanning(RECETTES);
    const cible = planning.jours[0]!.diner;
    const editee: Recette = {
      ...cible,
      nom: `${cible.nom} (modifiée)`,
      ingredients: [
        { nom: "test", quantite: 1, unite: "piece", categorie: "autre", fondDePlacard: false },
      ],
    };

    const maj = remplacerRecetteDansPlanning(planning, editee)!;
    expect(maj).not.toBeNull();
    expect(maj.jours[0]!.diner.nom).toBe(`${cible.nom} (modifiée)`);
    expect(maj.jours[0]!.diner.ingredients).toHaveLength(1);
  });

  test("retourne null si la recette n'est pas au planning", () => {
    const planning = genererPlanning(RECETTES);
    const absente: Recette = {
      id: "id-inexistant",
      nom: "Absente",
      tempsPreparation: "rapide",
      ingredients: [],
    };
    expect(remplacerRecetteDansPlanning(planning, absente)).toBeNull();
  });

  test("préserve le nombre de personnes du slot et n'altère pas l'original", () => {
    const base = genererPlanning(RECETTES);
    const cible = base.jours[0]!.diner;
    // Slot lundi réglé à 4 personnes.
    const planning: Planning = {
      ...base,
      jours: base.jours.map((jp, i) =>
        i === 0 ? { ...jp, personnes: { diner: 4 } } : jp
      ),
    };
    const instantane = JSON.stringify(planning);

    const editee: Recette = { ...cible, nom: "Éditée" };
    const maj = remplacerRecetteDansPlanning(planning, editee)!;

    expect(maj.jours[0]!.personnes).toEqual({ diner: 4 }); // personnes conservé
    expect(maj.jours[0]!.diner.nom).toBe("Éditée");
    expect(JSON.stringify(planning)).toBe(instantane); // original non muté
  });
});

// ---------------------------------------------------------------------------
// analyserVivier — viabilité du vivier pour générer une semaine (#2 PR3).
// 9 slots distincts dont 5 dîners de semaine en rapide/normal.
// ---------------------------------------------------------------------------
describe("analyserVivier — alerte vivier insuffisant (#2)", () => {
  function recettesOf(rapideNormal: number, longues: number): Recette[] {
    const r: Recette[] = [];
    for (let i = 0; i < rapideNormal; i++)
      r.push({ id: `rn-${i}`, nom: `rn${i}`, tempsPreparation: "rapide", ingredients: [] });
    for (let i = 0; i < longues; i++)
      r.push({ id: `l-${i}`, nom: `l${i}`, tempsPreparation: "long", ingredients: [] });
    return r;
  }

  test("suffisant : 9 recettes dont 5 rapides/normales", () => {
    const a = analyserVivier(recettesOf(5, 4));
    expect(a.suffisant).toBe(true);
    expect(a.message).toBeNull();
  });

  test("insuffisant : total < 9", () => {
    const a = analyserVivier(recettesOf(8, 0)); // 8 recettes
    expect(a.suffisant).toBe(false);
    expect(a.message).toMatch(/au moins 9/);
  });

  test("insuffisant : pas assez de rapides/normales (< 5)", () => {
    const a = analyserVivier(recettesOf(4, 6)); // 10 total mais 4 r/n
    expect(a.suffisant).toBe(false);
    expect(a.rapideNormal).toBe(4);
  });

  test("vivier vide", () => {
    const a = analyserVivier([]);
    expect(a.suffisant).toBe(false);
    expect(a.total).toBe(0);
  });
});
