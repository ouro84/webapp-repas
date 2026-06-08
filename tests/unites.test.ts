// Tests du formatage quantité + unité (lib/unites.ts), partagé entre la liste
// de courses (US-03) et la fiche de recette (US-10).

import { describe, expect, it } from "vitest";
import { formaterQuantite } from "@/lib/unites";
import type { Ingredient, Unite } from "@/types";

// Fabrique un ingrédient minimal — seuls quantite et unite comptent ici.
function ing(quantite: number, unite: Unite): Ingredient {
  return {
    nom: "test",
    quantite,
    unite,
    categorie: "epicerie",
    fondDePlacard: false,
  };
}

describe("formaterQuantite", () => {
  it("affiche la quantité suivie du libellé d'unité mesurée", () => {
    expect(formaterQuantite(ing(400, "g"))).toBe("400 g");
    expect(formaterQuantite(ing(20, "cl"))).toBe("20 cl");
    expect(formaterQuantite(ing(2, "cas"))).toBe("2 c.à.s");
  });

  it("n'affiche que le nombre pour les pièces et l'unité « autre »", () => {
    expect(formaterQuantite(ing(3, "piece"))).toBe("3");
    expect(formaterQuantite(ing(5, "autre"))).toBe("5");
  });

  it("accorde le libellé des unités conteneur selon la quantité (#33)", () => {
    expect(formaterQuantite(ing(1, "sachet"))).toBe("1 sachet");
    expect(formaterQuantite(ing(2, "sachet"))).toBe("2 sachets");
    expect(formaterQuantite(ing(2, "boite"))).toBe("2 boîtes");
  });

  it("n'accorde pas les unités mesurées (c.à.s reste invariable)", () => {
    expect(formaterQuantite(ing(3, "cas"))).toBe("3 c.à.s");
  });
});
