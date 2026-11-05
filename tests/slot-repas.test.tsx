// Tests de la carte de slot (components/planning/slot-repas.tsx, #352).
//
// La carte occupe toute la hauteur de sa cellule de grille, ancre badges +
// actions + stepper en bas (rangées alignées d'une colonne à l'autre) et garde
// les mêmes libellés d'actions sur mobile et desktop. Noms accessibles inchangés
// (une quinzaine d'e2e les ciblent).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SlotRepas } from "@/components/planning/slot-repas";
import type { Recette } from "@/types";

afterEach(cleanup);

const recette: Recette = {
  id: "r1",
  nom: "Gratin de courgettes aux lardons fumés et fromage râpé",
  tempsPreparation: "normal",
  ingredients: [],
} as unknown as Recette;

function rendre(
  surcharge: Partial<React.ComponentProps<typeof SlotRepas>> = {}
) {
  return render(
    <SlotRepas
      libelle="Déjeuner"
      jourLabel="Lundi"
      recette={recette}
      indisponible={false}
      personnes={2}
      onChanger={vi.fn()}
      onSelectionner={vi.fn()}
      onChangerPersonnes={vi.fn()}
      onVoir={vi.fn()}
      restes={false}
      onChangerRestes={vi.fn()}
      {...surcharge}
    />
  );
}

describe("SlotRepas : gabarit unique (#352)", () => {
  it("la racine occupe toute la hauteur de la cellule", () => {
    const { container } = rendre();
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("h-full");
    expect(racine.className).toContain("flex-col");
  });

  it("Changer porte un libellé réservé au desktop (hidden lg:inline)", () => {
    rendre();
    const bouton = screen.getByRole("button", { name: "Changer le déjeuner de lundi" });
    const libelle = Array.from(bouton.querySelectorAll("span")).find(
      (s) => s.textContent === "Changer"
    );
    expect(libelle).toBeDefined();
    expect(libelle!.className).toContain("hidden");
    expect(libelle!.className).toContain("lg:inline");
  });

  it("Sélectionner et Restes gardent leur libellé à lg (pas de lg:hidden)", () => {
    rendre();
    const selectionner = screen.getByRole("button", { name: "Sélectionner le déjeuner de lundi" });
    const restes = screen.getByRole("button", { name: "Marquer le déjeuner de lundi en restes" });
    for (const [bouton, texte] of [
      [selectionner, "Sélectionner"],
      [restes, "Restes"],
    ] as const) {
      expect(bouton.textContent).toContain(texte);
      expect(bouton.querySelector(".lg\:hidden")).toBeNull();
    }
  });

  it("le bouton du nom porte title = nom et line-clamp-3", () => {
    rendre();
    const nom = screen.getByRole("button", { name: `Voir la recette : ${recette.nom}` });
    expect(nom.getAttribute("title")).toBe(recette.nom);
    expect(nom.className).toContain("line-clamp-3");
  });

  it("les actions s'empilent à lg et le bloc bas est ancré (mt-auto)", () => {
    rendre();
    const actions = screen.getByRole("button", { name: "Changer le déjeuner de lundi" })
      .parentElement as HTMLElement;
    expect(actions.className).toContain("lg:flex-col");
    expect(actions.className).toContain("lg:items-start");
    const blocBas = actions.parentElement as HTMLElement;
    expect(blocBas.className).toContain("mt-auto");
    // Le stepper vit dans le même bloc ancré.
    expect(blocBas.textContent).toContain("2 pers.");
  });

  it("l'alerte « Pas de recette disponible » est dans le bloc ancré", () => {
    rendre({ indisponible: true });
    const alerte = screen.getByRole("alert");
    expect((alerte.parentElement as HTMLElement).className).toContain("mt-auto");
  });

  it("accentue : bordure brand-600 épaisse ; sinon bordure normale", () => {
    const { container, rerender } = rendre({ accentue: true });
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("border-2");
    expect(racine.className).toContain("border-brand-600");
    rerender(
      <SlotRepas
        libelle="Déjeuner"
        jourLabel="Lundi"
        recette={recette}
        indisponible={false}
        personnes={2}
        onChanger={vi.fn()}
        onSelectionner={vi.fn()}
        onChangerPersonnes={vi.fn()}
        onVoir={vi.fn()}
        restes={false}
        onChangerRestes={vi.fn()}
      />
    );
    expect((container.firstElementChild as HTMLElement).className).not.toContain(
      "border-brand-600"
    );
  });

  it("variante restes : h-full et accentue", () => {
    const { container } = rendre({ restes: true, accentue: true });
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("h-full");
    expect(racine.className).toContain("border-brand-600");
    const cuisiner = screen.getByRole("button", { name: "Cuisiner le déjeuner de lundi" });
    expect((cuisiner.parentElement as HTMLElement).className).toContain("mt-auto");
  });

  it("variante sans recette : h-full et accentue", () => {
    const { container } = rendre({ recette: undefined, accentue: true });
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("h-full");
    expect(racine.className).toContain("border-brand-600");
  });
});
