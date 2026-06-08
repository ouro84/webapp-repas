// Tests unitaires du générateur de planning — RG-01 à RG-04
// (SPECS_FONCTIONNELLES.md section 6) + structure du planning (section 5.5).
//
// Données : les fixtures de tests/fixtures/recettes.ts (15 recettes —
// 7 rapides, 5 normales, 3 longues), parfois étendues ou filtrées en
// sous-ensembles pour rendre certains comportements déterministes malgré
// l'aléatoire (RG-03). Découplé de data/recettes.json (issue #29) : le vrai
// dataset peut évoluer librement sans casser ces tests.
//
// Modèle d'éligibilité (RG-01, modèle C) : dîner de semaine = "rapide" ;
// déjeuner de semaine = "rapide"/"normal" ; week-end (déj + dîn) = tout.
// 14 slots au total (déjeuner + dîner chaque jour).

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
import type { Jour, Planning, Recette, TempsPreparation } from "@/types";

const RECETTES = RECETTES_FIXTURES;
const RAPIDES_NORMALES = RECETTES.filter((r) => r.tempsPreparation !== "long");
const LONGUES = RECETTES.filter((r) => r.tempsPreparation === "long");

const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
const ORDRE_JOURS: Jour[] = [...JOURS_SEMAINE, "samedi", "dimanche"];

// Fabrique n recettes synthétiques d'un temps donné (id/nom uniques).
function synth(temps: TempsPreparation, n: number, prefixe: string): Recette[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefixe}-${i}`,
    nom: `${prefixe}${i}`,
    tempsPreparation: temps,
    ingredients: [],
  }));
}

// Vivier élargi : 15 fixtures + marge synthétique rapide/normal. Avec 14 slots,
// les fixtures seules ne laissent qu'une recette libre — pour tester les
// remplacements (qui exigent un candidat éligible disponible), on garantit du
// « rab », notamment en "rapide" (les dîners de semaine en consomment 5).
const RECETTES_PLUS: Recette[] = [
  ...RECETTES,
  ...synth("rapide", 6, "rab-rapide"),
  ...synth("normal", 4, "rab-normal"),
];

// Tous les repas d'un planning, tous slots confondus.
function tousLesRepas(planning: Planning): Recette[] {
  return planning.jours.flatMap((jp) =>
    jp.dejeuner ? [jp.dejeuner, jp.diner] : [jp.diner]
  );
}

// Dîners du lundi au vendredi.
function dinersDeSemaine(planning: Planning): Recette[] {
  return planning.jours
    .filter((jp) => JOURS_SEMAINE.includes(jp.jour))
    .map((jp) => jp.diner);
}

// Déjeuners du lundi au vendredi (désormais présents chaque jour).
function dejeunersDeSemaine(planning: Planning): Recette[] {
  return planning.jours
    .filter((jp) => JOURS_SEMAINE.includes(jp.jour))
    .map((jp) => jp.dejeuner!)
    .filter(Boolean);
}

// Ids des repas du week-end (déjeuner + dîner du samedi et du dimanche).
function idsWeekend(planning: Planning): string[] {
  return planning.jours
    .filter((jp) => jp.jour === "samedi" || jp.jour === "dimanche")
    .flatMap((jp) => [jp.dejeuner!.id, jp.diner.id]);
}

// ---------------------------------------------------------------------------
// Section 5.5 — composition du planning : 7 jours lundi → dimanche,
// un déjeuner ET un dîner chaque jour (14 repas).
// ---------------------------------------------------------------------------
describe("genererPlanning — structure du planning (section 5.5)", () => {
  test("produit 7 jours dans l'ordre lundi → dimanche", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.jours.map((jp) => jp.jour)).toEqual(ORDRE_JOURS);
  });

  test("sert un déjeuner ET un dîner chaque jour (14 repas)", () => {
    const planning = genererPlanning(RECETTES);
    for (const jp of planning.jours) {
      expect(jp.dejeuner).toBeDefined();
      expect(jp.diner).toBeDefined();
    }
    expect(tousLesRepas(planning)).toHaveLength(14);
  });

  test("identifie la semaine au format ISO AAAA-Wnn", () => {
    const planning = genererPlanning(RECETTES);
    expect(planning.semaine).toMatch(/^\d{4}-W\d{2}$/);
  });

  test("génère pour la semaine cible fournie (US-11)", () => {
    const planning = genererPlanning(RECETTES, "2026-W30");
    expect(planning.semaine).toBe("2026-W30");
  });
});

// ---------------------------------------------------------------------------
// RG-01 — Éligibilité par slot (jour × type de repas, modèle C).
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-01 éligibilité par slot", () => {
  test("ne sert QUE des recettes 'rapide' aux dîners de semaine", () => {
    // L'aléatoire (RG-03) impose de répéter : 25 générations.
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      for (const diner of dinersDeSemaine(planning)) {
        expect(diner.tempsPreparation).toBe("rapide");
      }
    }
  });

  test("ne sert jamais de recette longue au déjeuner de semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES);
      for (const dejeuner of dejeunersDeSemaine(planning)) {
        expect(dejeuner.tempsPreparation).not.toBe("long");
      }
    }
  });

  test("sert les recettes longues le week-end quand le vivier l'impose", () => {
    // Vivier de 14 recettes pour 14 slots : 11 rapides/normales + les 3 longues.
    // Les 10 slots de semaine consomment 10 rapides/normales ; les 3 longues
    // ne peuvent finir que sur les 4 slots du week-end — et le planning aboutit.
    const vivier = [...RAPIDES_NORMALES.slice(0, 11), ...LONGUES];
    const planning = genererPlanning(vivier);

    const ids = idsWeekend(planning);
    for (const longue of LONGUES) {
      expect(ids).toContain(longue.id);
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
      expect(new Set(ids).size).toBe(repas.length); // 14 repas, 14 ids distincts
    }
  });
});

// ---------------------------------------------------------------------------
// RG-03 — Sélection aléatoire : parmi les recettes éligibles, le choix
// est aléatoire à chaque génération.
// ---------------------------------------------------------------------------
describe("genererPlanning — RG-03 sélection aléatoire", () => {
  test("produit des plannings différents d'une génération à l'autre", () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 30; i++) {
      signatures.add(
        tousLesRepas(genererPlanning(RECETTES)).map((r) => r.id).join("|")
      );
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Garde-fou du générateur : si le vivier ne permet pas de remplir les
// 14 slots en respectant RG-01 et RG-02, la génération échoue explicitement
// (l'UI affiche alors l'état erreur, RG-09).
// ---------------------------------------------------------------------------
describe("genererPlanning — vivier insuffisant", () => {
  test("échoue explicitement avec moins de recettes que de slots (14)", () => {
    expect(() => genererPlanning(RAPIDES_NORMALES.slice(0, 4))).toThrow();
  });

  test("échoue quand les dîners de semaine manquent de recettes rapides", () => {
    // 14 recettes au total, mais seulement 4 rapides : impossible de remplir
    // les 5 dîners de semaine (réservés au "rapide"), même avec des normales
    // et des longues en abondance.
    const vivier = [
      ...synth("rapide", 4, "r"),
      ...synth("normal", 7, "n"),
      ...synth("long", 3, "l"),
    ];
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
    const planning = genererPlanning(RECETTES_PLUS);
    const resultat = remplacerSlot(planning, "mardi", "diner", RECETTES_PLUS);

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

  test("dîner de semaine : ne propose QUE des recettes 'rapide'", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES_PLUS);
      const resultat = remplacerSlot(planning, "lundi", "diner", RECETTES_PLUS);
      expect(resultat).not.toBeNull();
      const nouveau = resultat!.jours.find((jp) => jp.jour === "lundi")!.diner;
      expect(nouveau.tempsPreparation).toBe("rapide");
    }
  });

  test("déjeuner de semaine : remplaçable, jamais par une recette longue", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES_PLUS);
      const resultat = remplacerSlot(planning, "lundi", "dejeuner", RECETTES_PLUS);
      expect(resultat).not.toBeNull();
      const nouveau = resultat!.jours.find((jp) => jp.jour === "lundi")!.dejeuner!;
      expect(nouveau.tempsPreparation).not.toBe("long");
    }
  });

  test("ne choisit jamais une recette déjà servie ailleurs dans la semaine", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES_PLUS);
      const resultat = remplacerSlot(planning, "samedi", "dejeuner", RECETTES_PLUS);
      expect(resultat).not.toBeNull();

      const cible = planning.jours.find((jp) => jp.jour === "samedi")!.dejeuner!;
      const nouveau = resultat!.jours.find((jp) => jp.jour === "samedi")!.dejeuner!;
      const idsAutresSlots = tousLesRepas(planning)
        .map((r) => r.id)
        .filter((id) => id !== cible.id);
      expect(idsAutresSlots).not.toContain(nouveau.id);
    }
  });

  test("retourne null quand toutes les recettes éligibles sont déjà utilisées", () => {
    // Vivier de 14 recettes = exactement les 14 slots : aucun remplaçant.
    const vivier = [...RAPIDES_NORMALES.slice(0, 11), ...LONGUES];
    const planning = genererPlanning(vivier);
    expect(remplacerSlot(planning, "dimanche", "dejeuner", vivier)).toBeNull();
  });

  test("retourne null pour un slot absent du planning (jour sans ce repas)", () => {
    // Planning forgé sans déjeuner le lundi (cas d'un planning antérieur).
    const planning = genererPlanning(RECETTES_PLUS);
    const sansDejeunerLundi: Planning = {
      ...planning,
      jours: planning.jours.map((jp) =>
        jp.jour === "lundi" ? { jour: jp.jour, diner: jp.diner } : jp
      ),
    };
    expect(
      remplacerSlot(sansDejeunerLundi, "lundi", "dejeuner", RECETTES_PLUS)
    ).toBeNull();
  });

  test("ne modifie jamais le planning d'origine", () => {
    const planning = genererPlanning(RECETTES_PLUS);
    const instantane = JSON.stringify(planning);
    remplacerSlot(planning, "jeudi", "diner", RECETTES_PLUS);
    expect(JSON.stringify(planning)).toBe(instantane);
  });

  test("conserve l'identifiant de semaine du planning d'origine", () => {
    const planning = genererPlanning(RECETTES_PLUS);
    const resultat = remplacerSlot(planning, "vendredi", "diner", RECETTES_PLUS);
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

  test("by-passe RG-01 : une recette « long » est permise au déjeuner de semaine", () => {
    const planning = genererPlanning(RECETTES);
    const longue = LONGUES[0]!;
    const resultat = remplacerSlotManuel(planning, "lundi", "dejeuner", longue);

    expect(
      resultat!.jours.find((jp) => jp.jour === "lundi")!.dejeuner!.id
    ).toBe(longue.id);
  });

  test("by-passe RG-02 : le doublon est permis dans le planning", () => {
    const planning = genererPlanning(RECETTES);
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

  test("retourne null pour un slot absent du planning (jour sans ce repas)", () => {
    const planning = genererPlanning(RECETTES);
    const sansDejeunerLundi: Planning = {
      ...planning,
      jours: planning.jours.map((jp) =>
        jp.jour === "lundi" ? { jour: jp.jour, diner: jp.diner } : jp
      ),
    };
    expect(
      remplacerSlotManuel(sansDejeunerLundi, "lundi", "dejeuner", RAPIDES_NORMALES[0]!)
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
  test("retourne les ids de tous les slots (14)", () => {
    const planning = genererPlanning(RECETTES);
    const ids = recettesUtilisees(planning);

    // 14 slots, tous distincts (RG-02 respectée par la génération).
    expect(ids.size).toBe(14);
    for (const repas of tousLesRepas(planning)) {
      expect(ids.has(repas.id)).toBe(true);
    }
  });

  test("un doublon issu d'une sélection manuelle ne produit qu'un seul id", () => {
    const planning = genererPlanning(RECETTES);
    const dejaServie = planning.jours.find((jp) => jp.jour === "lundi")!.diner;
    const avecDoublon = remplacerSlotManuel(planning, "mardi", "diner", dejaServie)!;

    expect(recettesUtilisees(avecDoublon).size).toBe(13); // 14 slots, 13 recettes
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
// 14 slots distincts, dont 10 rapide/normal (slots de semaine) dont 5 rapide
// (dîners de semaine).
// ---------------------------------------------------------------------------
describe("analyserVivier — alerte vivier insuffisant (#2)", () => {
  function recettesOf(rapide: number, normal: number, longues: number): Recette[] {
    return [
      ...synth("rapide", rapide, "r"),
      ...synth("normal", normal, "n"),
      ...synth("long", longues, "l"),
    ];
  }

  test("suffisant : 14 recettes dont 10 rapides/normales dont 5 rapides", () => {
    const a = analyserVivier(recettesOf(5, 5, 4)); // 14 total, r/n=10, rapide=5
    expect(a.suffisant).toBe(true);
    expect(a.message).toBeNull();
  });

  test("insuffisant : total < 14", () => {
    const a = analyserVivier(recettesOf(13, 0, 0)); // 13 recettes
    expect(a.suffisant).toBe(false);
    expect(a.message).toMatch(/au moins 14/);
  });

  test("insuffisant : pas assez de rapides/normales (< 10)", () => {
    const a = analyserVivier(recettesOf(5, 0, 9)); // 14 total, r/n=5, rapide=5
    expect(a.suffisant).toBe(false);
    expect(a.rapideNormal).toBe(5);
  });

  test("insuffisant : pas assez de rapides (< 5)", () => {
    const a = analyserVivier(recettesOf(4, 10, 0)); // 14 total, r/n=14, rapide=4
    expect(a.suffisant).toBe(false);
    expect(a.rapide).toBe(4);
  });

  test("vivier vide", () => {
    const a = analyserVivier([]);
    expect(a.suffisant).toBe(false);
    expect(a.total).toBe(0);
  });
});
