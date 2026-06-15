// Tests du cœur pur des avertissements de génération (#168) — RG-26/27/28.

import { describe, expect, it } from "vitest";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";

describe("messagesAvertissementGeneration", () => {
  it("aucun compteur → aucun message", () => {
    expect(messagesAvertissementGeneration({})).toEqual([]);
    expect(
      messagesAvertissementGeneration({
        vegeNonHonore: 0,
        mixNonHonore: 0,
        saisonNonHonore: 0,
      })
    ).toEqual([]);
  });

  it("végé non honoré : accord singulier/pluriel (RG-26)", () => {
    expect(messagesAvertissementGeneration({ vegeNonHonore: 1 })).toEqual([
      "1 repas n’a pas pu être végétarien (pas assez de recettes végé).",
    ]);
    expect(messagesAvertissementGeneration({ vegeNonHonore: 3 })[0]).toBe(
      "3 repas n’ont pas pu être végétariens (pas assez de recettes végé)."
    );
  });

  it("légumes non honoré : accord singulier/pluriel (RG-27)", () => {
    expect(messagesAvertissementGeneration({ mixNonHonore: 1 })).toEqual([
      "1 jour n’a pas de repas « légumes » (pas assez de recettes légumes).",
    ]);
    expect(messagesAvertissementGeneration({ mixNonHonore: 2 })[0]).toBe(
      "2 jours n’ont pas de repas « légumes » (pas assez de recettes légumes)."
    );
  });

  it("hors-saison : accord singulier/pluriel (RG-28)", () => {
    expect(messagesAvertissementGeneration({ saisonNonHonore: 1 })).toEqual([
      "1 repas est hors saison (pas assez de recettes de saison).",
    ]);
    expect(messagesAvertissementGeneration({ saisonNonHonore: 9 })[0]).toBe(
      "9 repas sont hors saison (pas assez de recettes de saison)."
    );
  });

  it("plusieurs préférences non honorées : messages cumulés dans l'ordre RG-26 → 27 → 28", () => {
    const messages = messagesAvertissementGeneration({
      vegeNonHonore: 2,
      mixNonHonore: 1,
      saisonNonHonore: 4,
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain("végétariens");
    expect(messages[1]).toContain("« légumes »");
    expect(messages[2]).toContain("hors saison");
  });

  it("compteurs négatifs (anormaux) → ignorés", () => {
    expect(
      messagesAvertissementGeneration({ vegeNonHonore: -1, saisonNonHonore: -5 })
    ).toEqual([]);
  });
});
