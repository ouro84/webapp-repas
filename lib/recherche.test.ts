// Tests unitaires de la recherche de recettes — sélecteur US-06.
// Le filtrage doit être insensible à la casse et aux accents : en magasin
// ou en cuisine, on tape vite et sans ponctuation.

import { describe, test, expect } from "vitest";
import { filtrerRecettes } from "@/lib/recherche";
import type { Recette } from "@/types";

// La recherche ne regarde que le nom : le reste est sans importance ici.
function recette(nom: string): Recette {
  return { id: nom, nom, tempsPreparation: "rapide", ingredients: [] };
}

const RECETTES = [
  recette("Pâtes au saumon"),
  recette("Pâtes pesto"),
  recette("Salade César"),
  recette("Gratin de courgettes"),
];

describe("filtrerRecettes — recherche du sélecteur (US-06)", () => {
  test("requête vide ou espaces → liste complète, ordre préservé", () => {
    expect(filtrerRecettes(RECETTES, "")).toEqual(RECETTES);
    expect(filtrerRecettes(RECETTES, "   ")).toEqual(RECETTES);
  });

  test("filtre par sous-chaîne du nom", () => {
    expect(filtrerRecettes(RECETTES, "pesto").map((r) => r.nom)).toEqual([
      "Pâtes pesto",
    ]);
  });

  test("insensible à la casse", () => {
    expect(filtrerRecettes(RECETTES, "SALADE").map((r) => r.nom)).toEqual([
      "Salade César",
    ]);
  });

  test("insensible aux accents, dans les deux sens", () => {
    // Requête sans accent ↔ nom accentué…
    expect(filtrerRecettes(RECETTES, "pates").map((r) => r.nom)).toEqual([
      "Pâtes au saumon",
      "Pâtes pesto",
    ]);
    // …et requête accentuée ↔ même résultat.
    expect(filtrerRecettes(RECETTES, "pâtes")).toEqual(
      filtrerRecettes(RECETTES, "pates")
    );
    expect(filtrerRecettes(RECETTES, "cesar").map((r) => r.nom)).toEqual([
      "Salade César",
    ]);
  });

  test("espaces superflus neutralisés", () => {
    expect(filtrerRecettes(RECETTES, "  gratin  ").map((r) => r.nom)).toEqual([
      "Gratin de courgettes",
    ]);
  });

  test("aucune correspondance → liste vide (état vide du sélecteur)", () => {
    expect(filtrerRecettes(RECETTES, "bouillabaisse")).toEqual([]);
  });
});
