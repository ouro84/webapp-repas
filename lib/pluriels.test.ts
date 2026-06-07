// Tests de l'accord en nombre des libellés de courses — US-08, RG-18 (#33).

import { describe, test, expect } from "vitest";
import { accorderNom, accorderLibelleUnite } from "@/lib/pluriels";
import type { Ingredient, Unite } from "@/types";

// Ingrédient minimal : seuls nom/quantite/unite comptent pour l'accord.
function ing(nom: string, quantite: number, unite: Unite = "piece"): Ingredient {
  return { nom, quantite, unite, categorie: "legumes-fruits", fondDePlacard: false };
}

describe("accorderNom — unité piece, règle régulière (US-08)", () => {
  test("singulier sous 2, pluriel à partir de 2", () => {
    expect(accorderNom(ing("courgette", 1))).toBe("courgette");
    expect(accorderNom(ing("courgette", 3))).toBe("courgettes");
    expect(accorderNom(ing("oignon", 2))).toBe("oignons");
  });

  test("phrase adjectivale : tête + adjectif s'accordent", () => {
    expect(accorderNom(ing("poivron jaune", 3))).toBe("poivrons jaunes");
    expect(accorderNom(ing("pain tranché", 2))).toBe("pains tranchés");
  });

  test("composé avec connecteur : seule la tête s'accorde", () => {
    // « de » arrête l'accord — le complément reste invariable.
    expect(accorderNom(ing("blanc de poulet", 3))).toBe("blancs de poulet");
    expect(accorderNom(ing("magret de canard", 2))).toBe("magrets de canard");
    expect(accorderNom(ing("blanc de poulet", 1))).toBe("blanc de poulet");
  });
});

describe("accorderNom — table d'exceptions (RG-18)", () => {
  test("formes stockées au pluriel : singulier reconstruit", () => {
    expect(accorderNom(ing("carottes", 1))).toBe("carotte");
    expect(accorderNom(ing("carottes", 4))).toBe("carottes");
    expect(accorderNom(ing("œufs", 1))).toBe("œuf");
    expect(accorderNom(ing("œufs", 6))).toBe("œufs");
    expect(accorderNom(ing("poireaux", 1))).toBe("poireau");
  });

  test("composés irréguliers et trait d'union", () => {
    expect(accorderNom(ing("escalopes de dinde", 1))).toBe("escalope de dinde");
    expect(accorderNom(ing("steaks hachés", 3))).toBe("steaks hachés");
    expect(accorderNom(ing("steaks hachés", 1))).toBe("steak haché");
    expect(accorderNom(ing("chou-fleur", 2))).toBe("choux-fleurs");
  });

  test("annotation entre parenthèses", () => {
    expect(accorderNom(ing("jambon blanc (tranche)", 3))).toBe(
      "jambon blanc (tranches)"
    );
  });

  test("invariants : marques, variétés, masses à la pièce", () => {
    expect(accorderNom(ing("croustibat", 4))).toBe("croustibat");
    expect(accorderNom(ing("osso bucco de veau", 3))).toBe("osso bucco de veau");
    expect(accorderNom(ing("maïs", 2))).toBe("maïs");
    expect(accorderNom(ing("laitue iceberg", 2))).toBe("laitues iceberg");
  });
});

describe("accorderNom — noms de masse jamais accordés (RG-18)", () => {
  test("les unités mesurées renvoient le nom inchangé même si quantité ≥ 2", () => {
    expect(accorderNom(ing("beurre", 200, "g"))).toBe("beurre");
    expect(accorderNom(ing("farine", 4, "cas"))).toBe("farine");
    expect(accorderNom(ing("lait", 500, "ml"))).toBe("lait");
  });
});

describe("accorderLibelleUnite — accord du conteneur (RG-18)", () => {
  test("le libellé conteneur s'accorde, pas en dessous de 2", () => {
    expect(accorderLibelleUnite("sachet", "sachet", 1)).toBe("sachet");
    expect(accorderLibelleUnite("sachet", "sachet", 2)).toBe("sachets");
    expect(accorderLibelleUnite("boîte", "boite", 3)).toBe("boîtes");
  });

  test("les libellés de mesure restent invariables", () => {
    expect(accorderLibelleUnite("g", "g", 200)).toBe("g");
    expect(accorderLibelleUnite("c.à.s", "cas", 4)).toBe("c.à.s");
  });
});
