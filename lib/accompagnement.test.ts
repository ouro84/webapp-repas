// Tests de l'heuristique d'accompagnement (#49, P11).
//
// On teste la RÈGLE (priorité féculent > légume > null) et sa robustesse aux
// accents / pluriels — pas le contenu précis du dataset (cf.
// tests/recettes-dataset.test.ts pour la couverture sur les vraies recettes).

import { describe, expect, it } from "vitest";
import { suggererAccompagnement } from "@/lib/accompagnement";
import type { Ingredient } from "@/types";

// Fabrique d'ingrédient minimal (l'heuristique ne lit que le nom).
function ing(nom: string): Ingredient {
  return { nom, quantite: 1, unite: "piece", categorie: "autre", fondDePlacard: false };
}

describe("suggererAccompagnement", () => {
  it("retourne 'feculents' si un féculent est présent", () => {
    expect(suggererAccompagnement([ing("Riz basmati"), ing("Poulet")])).toBe("feculents");
    expect(suggererAccompagnement([ing("Pâtes"), ing("Crème")])).toBe("feculents");
    expect(suggererAccompagnement([ing("Pommes de terre")])).toBe("feculents");
    expect(suggererAccompagnement([ing("Fusilli"), ing("Pesto")])).toBe("feculents");
  });

  it("retourne 'legumes' si pas de féculent mais au moins un légume", () => {
    expect(suggererAccompagnement([ing("Poulet"), ing("Haricots verts")])).toBe("legumes");
    expect(suggererAccompagnement([ing("Brocolis"), ing("Saumon")])).toBe("legumes");
    expect(suggererAccompagnement([ing("Ratatouille")])).toBe("legumes");
  });

  it("le féculent l'emporte sur le légume (riz + tomates → feculents)", () => {
    expect(
      suggererAccompagnement([ing("Riz"), ing("Tomates"), ing("Poulet")])
    ).toBe("feculents");
  });

  it("retourne null pour un plat non caractérisé", () => {
    expect(suggererAccompagnement([ing("Œufs"), ing("Fromage")])).toBeNull();
    expect(suggererAccompagnement([ing("Steak haché")])).toBeNull();
    expect(suggererAccompagnement([])).toBeNull();
  });

  it("est robuste aux accents et aux pluriels", () => {
    expect(suggererAccompagnement([ing("ÉPINARDS")])).toBe("legumes");
    expect(suggererAccompagnement([ing("Pâtes complètes")])).toBe("feculents");
    expect(suggererAccompagnement([ing("Petits pois")])).toBe("legumes");
    expect(suggererAccompagnement([ing("Carottes")])).toBe("legumes");
  });

  it("ne confond pas un légume sec (féculent) avec un légume vert", () => {
    // Lentilles / haricots blancs = légumineuses sèches → féculents.
    expect(suggererAccompagnement([ing("Lentilles"), ing("Saucisse")])).toBe("feculents");
    expect(suggererAccompagnement([ing("Haricots blancs")])).toBe("feculents");
  });
});
