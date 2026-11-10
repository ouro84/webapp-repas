// Squelette de la page /ce-soir (#400, RG-09, RG-89) : une seule annonce
// « Chargement… », intitulés fixes de ContenuRecette en vrai texte, 6 cases
// d'ingrédients, 3 étapes. Les blocs sont masqués aux lecteurs d'écran.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { CLASSES_TITRE_SECTION_CUISINE } from "@/components/planning/contenu-recette";
import { EcranChargement } from "@/components/ui/ecran-chargement";
import { SqueletteCeSoir } from "./squelette-ce-soir";

afterEach(cleanup);

function rendre() {
  return render(
    <EcranChargement espacement="px-4 py-6 md:py-10">
      <SqueletteCeSoir />
    </EcranChargement>
  );
}

describe("SqueletteCeSoir", () => {
  it("expose une seule zone de chargement", () => {
    rendre();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Chargement…");
  });

  it("rend les intitulés fixes de ContenuRecette en vrai texte", () => {
    rendre();
    const zone = screen.getByRole("status");
    expect(within(zone).getByText("Ingrédients")).not.toBeNull();
    expect(within(zone).getByText("Préparation")).not.toBeNull();
  });

  it("titres de section aux classes exactes de ContenuRecette variante cuisine", () => {
    rendre();
    const zone = screen.getByRole("status");
    expect(within(zone).getByText("Ingrédients").className).toBe(CLASSES_TITRE_SECTION_CUISINE);
    expect(within(zone).getByText("Préparation").className).toBe(CLASSES_TITRE_SECTION_CUISINE);
  });

  it("lignes d’ingrédients en li > div (jumelles de li > label de l’état chargé)", () => {
    const { container } = rendre();
    const lignes = container.querySelectorAll('ul > li > div.flex.min-h-11[class~="py-2.5"]');
    expect(lignes).toHaveLength(6);
    expect(container.querySelectorAll("ul > li.min-h-11")).toHaveLength(0);
  });

  it("réserve 6 lignes d’ingrédients (case size-4) et 3 étapes (pastille size-8)", () => {
    const { container } = rendre();
    expect(container.querySelectorAll("ul > li .size-4")).toHaveLength(6);
    expect(container.querySelectorAll("ol > li .size-8")).toHaveLength(3);
  });

  it("masque tous les blocs aux lecteurs d’écran", () => {
    const { container } = rendre();
    const masque = container.querySelector('[aria-hidden="true"]');
    expect(masque).not.toBeNull();
    expect(masque?.querySelector("h1")).not.toBeNull();
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBeGreaterThan(0);
    lis.forEach((li) => expect(li.closest('[aria-hidden="true"]')).not.toBeNull());
  });
});
