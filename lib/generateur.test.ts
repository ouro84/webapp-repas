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
  FENETRE_VARIETE,
  genererPlanning,
  joursSansLegume,
  poidsVariete,
  prefereVegeSlot,
  reposNonSaison,
  recettesUtilisees,
  remplacerRecetteDansPlanning,
  remplacerSlot,
  remplacerSlotManuel,
  slotsVegeNonHonores,
  type HistoriqueVariete,
} from "@/lib/generateur";
import { RECETTES_FIXTURES } from "@/tests/fixtures/recettes";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { saisonDeSemaine } from "@/lib/semaines";
import type {
  Jour,
  Planning,
  Recette,
  ReglagesGeneration,
  TempsPreparation,
} from "@/types";

const RECETTES = RECETTES_FIXTURES;
const RAPIDES_NORMALES = RECETTES.filter((r) => r.tempsPreparation !== "long");
const LONGUES = RECETTES.filter((r) => r.tempsPreparation === "long");

const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
const ORDRE_JOURS: Jour[] = [...JOURS_SEMAINE, "samedi", "dimanche"];

// PRNG déterministe (mulberry32) injecté dans genererPlanning/remplacerSlot pour
// neutraliser l'aléa de RG-03 (#157). Sans seed, la génération pouvait épuiser
// par hasard le vivier « rapide » (13 recettes) et faire échouer par
// intermittence les remplacements sur un dîner de semaine (plafond "rapide") —
// l'assertion `not.toBeNull()` tombait alors ~0,4 % des runs, bloquant la CI
// (job `test` rouge → `migrate-prod` sauté). Avec un seed fixe, ces tests sont
// déterministes : ils passent ou échouent toujours, jamais « occasionnellement ».
function rngSeed(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    const rng = rngSeed(157);
    const planning = genererPlanning(RECETTES_PLUS, undefined, undefined, rng);
    const resultat = remplacerSlot(planning, "mardi", "diner", RECETTES_PLUS, undefined, rng);

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
    const rng = rngSeed(157);
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(RECETTES_PLUS, undefined, undefined, rng);
      const resultat = remplacerSlot(planning, "lundi", "diner", RECETTES_PLUS, undefined, rng);
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
    const rng = rngSeed(157);
    const planning = genererPlanning(RECETTES_PLUS, undefined, undefined, rng);
    const resultat = remplacerSlot(planning, "vendredi", "diner", RECETTES_PLUS, undefined, rng);
    expect(resultat!.semaine).toBe(planning.semaine);
  });

  test("efface le marquage « restes » du slot remplacé (RG-22)", () => {
    const rng = rngSeed(157);
    const base = genererPlanning(RECETTES_PLUS, undefined, undefined, rng);
    // Dîner de mardi marqué restes.
    const planning: Planning = {
      ...base,
      jours: base.jours.map((jp) =>
        jp.jour === "mardi" ? { ...jp, restes: { diner: true } } : jp
      ),
    };
    const resultat = remplacerSlot(planning, "mardi", "diner", RECETTES_PLUS, undefined, rng)!;
    expect(resultat.jours.find((jp) => jp.jour === "mardi")!.restes?.diner).toBe(
      false
    );
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

// ---------------------------------------------------------------------------
// #45 (P09) — réglages de génération personnalisés (plafonds par créneau +
// nombre de personnes par défaut). REGLAGES_DEFAUT = comportement antérieur.
// ---------------------------------------------------------------------------
describe("genererPlanning — réglages personnalisés (#45)", () => {
  const TOUT_LONG: ReglagesGeneration = {
    personnesDefaut: 2,
    plafonds: {
      dejeunerSemaine: "long",
      dinerSemaine: "long",
      dejeunerWeekend: "long",
      dinerWeekend: "long",
    },
  };

  test("un plafond plus PERMISSIF autorise des recettes longues en semaine", () => {
    // 14 recettes "long" distinctes : impossible par défaut (les dîners de
    // semaine exigent "rapide"), possible si tous les créneaux plafonnent "long".
    const longues = synth("long", 14, "l");
    expect(() => genererPlanning(longues)).toThrow();
    const planning = genererPlanning(longues, "2026-W30", TOUT_LONG);
    expect(tousLesRepas(planning)).toHaveLength(14);
  });

  test("un plafond plus RESTRICTIF réduit le vivier éligible", () => {
    // 5 rapides + 9 normales. Par défaut : OK (déjeuners de semaine acceptent
    // "normal"). Avec déjeuner de semaine plafonné "rapide", les 5 rapides ne
    // suffisent plus (5 dîners + 5 déjeuners de semaine = 10 slots "rapide").
    const vivier = [...synth("rapide", 5, "r"), ...synth("normal", 9, "n")];
    expect(() => genererPlanning(vivier)).not.toThrow();
    const restrictif: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      plafonds: { ...REGLAGES_DEFAUT.plafonds, dejeunerSemaine: "rapide" },
    };
    expect(() => genererPlanning(vivier, "2026-W30", restrictif)).toThrow();
  });

  test("les slots générés portent le nombre de personnes par défaut des réglages", () => {
    const reglages: ReglagesGeneration = { ...REGLAGES_DEFAUT, personnesDefaut: 4 };
    const planning = genererPlanning(RECETTES, "2026-W30", reglages);
    for (const jp of planning.jours) {
      expect(jp.personnes?.dejeuner).toBe(4);
      expect(jp.personnes?.diner).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------------
// #86 (P10) PR2 — préférence « privilégier le végétarien » par créneau (RG-26).
// Préférence SOUPLE : biais de sélection, jamais une contrainte qui bloque.
// ---------------------------------------------------------------------------
describe("genererPlanning — préférence végétarienne souple (#86 PR2)", () => {
  // Marque n recettes synthétiques comme végé (ou non).
  function synthVege(
    temps: TempsPreparation,
    n: number,
    prefixe: string,
    vegetarien: boolean
  ): Recette[] {
    return synth(temps, n, prefixe).map((r) => ({ ...r, vegetarien }));
  }

  const TOUS_VEGE: ReglagesGeneration = {
    ...REGLAGES_DEFAUT,
    vegetarienPrefere: {
      dejeunerSemaine: true,
      dinerSemaine: true,
      dejeunerWeekend: true,
      dinerWeekend: true,
    },
  };

  test("biaise vers le végé quand le vivier végé suffit (tous créneaux)", () => {
    // 14 recettes végé (10 rapides + 4 normales, compatibles avec les plafonds
    // par défaut) + des leurres non végé qui ne doivent jamais être choisis.
    const vivier = [
      ...synthVege("rapide", 10, "vr", true),
      ...synthVege("normal", 4, "vn", true),
      ...synthVege("rapide", 5, "xr", false),
    ];
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(vivier, "2026-W30", TOUS_VEGE);
      for (const repas of tousLesRepas(planning)) {
        expect(repas.vegetarien).toBe(true);
      }
      expect(slotsVegeNonHonores(planning, TOUS_VEGE)).toHaveLength(0);
    }
  });

  test("n'échoue jamais et signale les repas non honorés si le vivier végé manque", () => {
    // Aucune recette végé : la génération aboutit (préférence souple), mais les
    // 5 dîners de semaine (créneau privilégié) ne sont pas végé → signalés.
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      vegetarienPrefere: {
        dejeunerSemaine: false,
        dinerSemaine: true,
        dejeunerWeekend: false,
        dinerWeekend: false,
      },
    };
    const vivier = [
      ...synthVege("rapide", 10, "r", false),
      ...synthVege("normal", 4, "n", false),
    ];
    const planning = genererPlanning(vivier, "2026-W30", reglages);
    expect(tousLesRepas(planning)).toHaveLength(14);

    const nonHonores = slotsVegeNonHonores(planning, reglages);
    expect(nonHonores).toHaveLength(5);
    for (const slot of nonHonores) {
      expect(slot.typeRepas).toBe("diner");
      expect(JOURS_SEMAINE).toContain(slot.jour);
    }
  });

  test("remplacerSlot applique le même biais végé (Q4)", () => {
    // Dîner de semaine privilégié végé ; vivier avec assez de végé rapides.
    const reglages: ReglagesGeneration = {
      ...REGLAGES_DEFAUT,
      vegetarienPrefere: {
        dejeunerSemaine: false,
        dinerSemaine: true,
        dejeunerWeekend: false,
        dinerWeekend: false,
      },
    };
    // Marge « rapide » large pour qu'un remplaçant rapide végé reste toujours
    // disponible (RG-04), comme RECETTES_PLUS pour les autres tests.
    const vivier = [
      ...synthVege("rapide", 20, "vr", true),
      ...synthVege("normal", 4, "vn", true),
    ];
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(vivier, "2026-W30", reglages);
      const resultat = remplacerSlot(planning, "lundi", "diner", vivier, reglages);
      expect(resultat).not.toBeNull();
      const nouveau = resultat!.jours.find((jp) => jp.jour === "lundi")!.diner;
      expect(nouveau.vegetarien).toBe(true);
    }
  });

  test("réglages par défaut (sans préférence) : aucun slot signalé non honoré", () => {
    const planning = genererPlanning(RECETTES);
    expect(slotsVegeNonHonores(planning, REGLAGES_DEFAUT)).toHaveLength(0);
  });
});

describe("genererPlanning — mix « ≥1 légume/jour » souple, joint (#49 PR2)", () => {
  // Marque n recettes synthétiques avec un accompagnement donné.
  function synthAccomp(
    temps: TempsPreparation,
    n: number,
    prefixe: string,
    accompagnement: "feculents" | "legumes" | undefined
  ): Recette[] {
    return synth(temps, n, prefixe).map((r) =>
      accompagnement ? { ...r, accompagnement } : r
    );
  }

  const MIX: ReglagesGeneration = {
    ...REGLAGES_DEFAUT,
    mixAccompagnementJour: true,
  };

  // Vivier garantissant un légume par jour sous les plafonds par défaut :
  // 5 rapides-légumes (1 par dîner de semaine) + 2 longs-légumes (week-end),
  // complétés de fillers non-légumes pour la faisabilité (14 distincts).
  const VIVIER_MIX_OK: Recette[] = [
    ...synthAccomp("rapide", 5, "rl", "legumes"),
    ...synthAccomp("long", 2, "ll", "legumes"),
    ...synthAccomp("normal", 5, "nf", "feculents"),
    ...synthAccomp("long", 2, "lf", "feculents"),
  ];

  test("chaque jour reçoit au moins un repas légumes quand le vivier suffit", () => {
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(VIVIER_MIX_OK, "2026-W30", MIX);
      expect(tousLesRepas(planning)).toHaveLength(14);
      for (const jp of planning.jours) {
        const aLegume =
          jp.dejeuner?.accompagnement === "legumes" ||
          jp.diner?.accompagnement === "legumes";
        expect(aLegume, `jour ${jp.jour} sans légume`).toBe(true);
      }
      expect(joursSansLegume(planning, MIX)).toHaveLength(0);
    }
  });

  test("n'échoue jamais et signale les jours non honorés si aucun légume", () => {
    // Aucune recette « légumes » : la génération aboutit (préférence souple),
    // mais les 7 jours sont signalés non honorés.
    const vivier = [
      ...synthAccomp("rapide", 10, "r", "feculents"),
      ...synthAccomp("normal", 4, "n", "feculents"),
    ];
    const planning = genererPlanning(vivier, "2026-W30", MIX);
    expect(tousLesRepas(planning)).toHaveLength(14);
    expect(joursSansLegume(planning, MIX)).toHaveLength(7);
  });

  test("remplacerSlot biaise vers légume si le repas frère ne l'est pas", () => {
    // Marge large de rapides-légumes pour qu'un remplaçant reste disponible.
    const vivier = [
      ...synthAccomp("rapide", 20, "rl", "legumes"),
      ...synthAccomp("normal", 4, "nf", "feculents"),
    ];
    for (let i = 0; i < 25; i++) {
      const planning = genererPlanning(vivier, "2026-W30", MIX);
      const resultat = remplacerSlot(planning, "lundi", "diner", vivier, MIX);
      expect(resultat).not.toBeNull();
      const lundi = resultat!.jours.find((jp) => jp.jour === "lundi")!;
      const aLegume =
        lundi.dejeuner?.accompagnement === "legumes" ||
        lundi.diner?.accompagnement === "legumes";
      expect(aLegume).toBe(true);
    }
  });

  test("préférence inactive (défaut) : aucun jour signalé", () => {
    const planning = genererPlanning(RECETTES);
    expect(joursSansLegume(planning, REGLAGES_DEFAUT)).toHaveLength(0);
  });
});

describe("genererPlanning — saisonnalité, filtre dur à dégradation (#23 PR2)", () => {
  // Semaine d'été (mi-juillet) et sa saison, dérivée par la logique calendaire.
  const SEMAINE_ETE = "2026-W28";
  const SAISON_ETE = saisonDeSemaine(SEMAINE_ETE);
  const SAISON_AUTRE = SAISON_ETE === "ete" ? "hiver" : "ete";

  function synthSaison(
    temps: TempsPreparation,
    n: number,
    prefixe: string,
    saisons: ("ete" | "automne" | "hiver" | "printemps")[]
  ): Recette[] {
    return synth(temps, n, prefixe).map((r) => ({ ...r, saisons }));
  }

  // Saisonnalité ON (défaut) ; OFF explicite pour le test de non-filtrage.
  const SAISON_OFF: ReglagesGeneration = { ...REGLAGES_DEFAUT, saisonnalite: false };

  test("ne propose que des recettes de saison quand le vivier suffit", () => {
    const vivier = [
      ...synthSaison("rapide", 10, "re", [SAISON_ETE]),
      ...synthSaison("normal", 4, "ne", [SAISON_ETE]),
      ...synthSaison("rapide", 5, "rx", [SAISON_AUTRE]), // leurres hors saison
    ];
    for (let i = 0; i < 20; i++) {
      const planning = genererPlanning(vivier, SEMAINE_ETE, REGLAGES_DEFAUT);
      for (const repas of tousLesRepas(planning)) {
        expect(repas.saisons).toContain(SAISON_ETE);
      }
      expect(reposNonSaison(planning, REGLAGES_DEFAUT)).toHaveLength(0);
    }
  });

  test("dégradation gracieuse : complète hors-saison et le signale", () => {
    // 5 recettes de saison seulement, le reste hors saison ; toutes rapides pour
    // garantir la faisabilité temporelle. La génération aboutit (14 repas) et
    // 9 repas sont hors-saison.
    const vivier = [
      ...synthSaison("rapide", 5, "re", [SAISON_ETE]),
      ...synthSaison("rapide", 9, "rx", [SAISON_AUTRE]),
    ];
    const planning = genererPlanning(vivier, SEMAINE_ETE, REGLAGES_DEFAUT);
    expect(tousLesRepas(planning)).toHaveLength(14);
    expect(reposNonSaison(planning, REGLAGES_DEFAUT)).toHaveLength(9);
  });

  test("saisonnalité désactivée : aucun filtre ni signalement", () => {
    const vivier = [
      ...synthSaison("rapide", 10, "rx", [SAISON_AUTRE]),
      ...synthSaison("normal", 4, "nx", [SAISON_AUTRE]),
    ];
    const planning = genererPlanning(vivier, SEMAINE_ETE, SAISON_OFF);
    expect(tousLesRepas(planning)).toHaveLength(14);
    expect(reposNonSaison(planning, SAISON_OFF)).toHaveLength(0);
  });

  test("recettes sans saison = toute l'année (pas de régression)", () => {
    // RECETTES (fixtures) n'ont pas de saisons → de saison partout, même avec
    // la saisonnalité ON par défaut.
    const planning = genererPlanning(RECETTES, SEMAINE_ETE, REGLAGES_DEFAUT);
    expect(reposNonSaison(planning, REGLAGES_DEFAUT)).toHaveLength(0);
  });

  test("remplacerSlot filtre aussi par saison", () => {
    const vivier = [
      ...synthSaison("rapide", 20, "re", [SAISON_ETE]),
      ...synthSaison("rapide", 5, "rx", [SAISON_AUTRE]),
    ];
    for (let i = 0; i < 20; i++) {
      const planning = genererPlanning(vivier, SEMAINE_ETE, REGLAGES_DEFAUT);
      const resultat = remplacerSlot(planning, "lundi", "diner", vivier, REGLAGES_DEFAUT);
      expect(resultat).not.toBeNull();
      const remplacante = resultat!.jours.find((jp) => jp.jour === "lundi")!.diner;
      expect(remplacante.saisons).toContain(SAISON_ETE);
    }
  });
});

describe("prefereVegeSlot — mappe créneau → préférence (#86 PR2)", () => {
  const reglages: ReglagesGeneration = {
    ...REGLAGES_DEFAUT,
    vegetarienPrefere: {
      dejeunerSemaine: false,
      dinerSemaine: true,
      dejeunerWeekend: false,
      dinerWeekend: true,
    },
  };

  test("dîner de semaine et dîner de week-end sont privilégiés", () => {
    expect(prefereVegeSlot("mardi", "diner", reglages)).toBe(true);
    expect(prefereVegeSlot("samedi", "diner", reglages)).toBe(true);
  });

  test("déjeuners et créneaux non cochés ne le sont pas", () => {
    expect(prefereVegeSlot("mardi", "dejeuner", reglages)).toBe(false);
    expect(prefereVegeSlot("dimanche", "dejeuner", reglages)).toBe(false);
  });

  test("réglages sans préférence : toujours false", () => {
    expect(prefereVegeSlot("mardi", "diner", REGLAGES_DEFAUT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #218 — mémoire de variété (anti-répétition inter-semaines). Biais SOUPLE et
// DÉGRESSIF : les recettes servies récemment sont défavorisées dans le tirage,
// jamais bloquées (la génération aboutit toujours, RG-49/50/51).
// ---------------------------------------------------------------------------
describe("poidsVariete — pénalité dégressive (#218, RG-49/50/51)", () => {
  const r = (id: string): Recette => ({
    id,
    nom: id,
    tempsPreparation: "rapide",
    ingredients: [],
  });

  test("recette hors historique : poids plein (1)", () => {
    expect(poidsVariete(r("x"), new Map())).toBe(1);
  });

  test("dégressif : plus une recette est récente, plus elle est pénalisée (RG-51)", () => {
    // ancien = nombre de semaines écoulées depuis la dernière apparition.
    const poids = (ancien: number) =>
      poidsVariete(r("x"), new Map([["x", ancien]]));
    // 1 sem < 2 sem < ... < FENETRE sem < hors-fenêtre (poids plein).
    for (let a = 1; a < FENETRE_VARIETE; a++) {
      expect(poids(a)).toBeLessThan(poids(a + 1));
    }
    expect(poids(FENETRE_VARIETE)).toBeLessThan(1);
  });

  test("hors de la fenêtre (ancien > FENETRE) : poids plein (1)", () => {
    expect(poidsVariete(r("x"), new Map([["x", FENETRE_VARIETE + 1]]))).toBe(1);
  });

  test("poids toujours strictement positif dans la fenêtre (jamais bloquant, RG-49)", () => {
    for (let a = 1; a <= FENETRE_VARIETE; a++) {
      expect(poidsVariete(r("x"), new Map([["x", a]]))).toBeGreaterThan(0);
    }
  });
});

describe("genererPlanning — mémoire de variété (#218, RG-49/50)", () => {
  // Vivier de 30 recettes rapides (éligibles partout) : 15 « vues la semaine
  // dernière » (ancien = 1, fortement pénalisées) + 15 « fraîches ».
  const VIVIER_VARIETE = synth("rapide", 30, "v");
  const RECENTES = new Set(VIVIER_VARIETE.slice(0, 15).map((r) => r.id));
  const HISTORIQUE_RECENT: HistoriqueVariete = new Map(
    [...RECENTES].map((id) => [id, 1])
  );

  test("historique vide (défaut) : comportement inchangé, 14 repas", () => {
    const planning = genererPlanning(VIVIER_VARIETE, "2026-W30");
    expect(tousLesRepas(planning)).toHaveLength(14);
  });

  test("défavorise nettement les recettes vues récemment (biais souple)", () => {
    // Sans biais, les recettes récentes (50 % du vivier) apparaîtraient ~50 % du
    // temps. Avec la pénalité dégressive, leur part doit chuter bien en dessous.
    // Tirage seedé → résultat déterministe (pas de flake, cf. #157).
    const rng = rngSeed(218);
    let recent = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const planning = genererPlanning(
        VIVIER_VARIETE,
        "2026-W30",
        undefined,
        rng,
        HISTORIQUE_RECENT
      );
      for (const repas of tousLesRepas(planning)) {
        total++;
        if (RECENTES.has(repas.id)) recent++;
      }
    }
    // Référence non biaisée = 0,5. On exige une sous-représentation franche.
    expect(recent / total).toBeLessThan(0.4);
  });

  test("n'échoue jamais même si TOUTES les recettes sont récentes (repli, RG-50)", () => {
    const toutRecent: HistoriqueVariete = new Map(
      VIVIER_VARIETE.map((r) => [r.id, 1])
    );
    const rng = rngSeed(218);
    const planning = genererPlanning(
      VIVIER_VARIETE,
      "2026-W30",
      undefined,
      rng,
      toutRecent
    );
    expect(tousLesRepas(planning)).toHaveLength(14);
  });
});

describe("analyserVivier — réglages personnalisés (#45)", () => {
  test("plafonds tout 'long' : seul le total compte (14), pas de palier rapide/normal", () => {
    const toutLong: ReglagesGeneration = {
      personnesDefaut: 2,
      plafonds: {
        dejeunerSemaine: "long",
        dinerSemaine: "long",
        dejeunerWeekend: "long",
        dinerWeekend: "long",
      },
    };
    const longues = synth("long", 14, "l");
    // Insuffisant par défaut (0 rapide/normal), suffisant si tout plafonne "long".
    expect(analyserVivier(longues).suffisant).toBe(false);
    expect(analyserVivier(longues, toutLong).suffisant).toBe(true);
  });
});
