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
      expect(bouton.querySelector('[class~="lg:hidden"]')).toBeNull();
    }
  });

  it("le bouton du nom porte title = nom et line-clamp-3", () => {
    rendre();
    const nom = screen.getByRole("button", { name: `Voir la recette : ${recette.nom}` });
    expect(nom.getAttribute("title")).toBe(recette.nom);
    const classes = nom.className.split(/\s+/);
    expect(classes).toContain("line-clamp-3");
    // line-clamp pose son propre display (-webkit-box) : toute classe display
    // concurrente (block, flex…) est émise après et l'annule, le nom ne serait
    // plus tronqué.
    const displaysConcurrents = classes.filter((c) =>
      /^(block|inline|inline-block|inline-flex|flex|grid|inline-grid|contents|table|flow-root)$/.test(c)
    );
    expect(displaysConcurrents).toEqual([]);
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

  // Colonne desktop de ~100 px de contenu à 1024 (#352, e2e planning-grille) :
  // le stepper « − 2 pers. + » (≈ 112 px) et le chip « Sélectionner » débordaient.
  it("à lg, le stepper tient en colonne étroite : unité « pers. » en sr-only, boutons non rétrécis", () => {
    rendre();
    const valeur = screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite");
    // Nom annoncé inchangé (« 2 pers. ») : l'unité reste dans l'arbre d'accessibilité.
    expect(valeur.textContent).toBe("2 pers.");
    const unite = Array.from(valeur.querySelectorAll("span")).find(
      (s) => s.textContent === " pers."
    );
    expect(unite).toBeDefined();
    expect(unite!.className.split(/\s+/)).toContain("lg:sr-only");
    expect(valeur.className).toContain("lg:min-w-0");
    for (const nom of ["Moins de personnes pour le déjeuner de lundi", "Plus de personnes pour le déjeuner de lundi"]) {
      expect(screen.getByRole("button", { name: nom }).className.split(/\s+/)).toContain("shrink-0");
    }
  });

  it("à lg, les chips d'action resserrent leur padding horizontal", () => {
    rendre();
    for (const nom of [
      "Changer le déjeuner de lundi",
      "Sélectionner le déjeuner de lundi",
      "Marquer le déjeuner de lundi en restes",
    ]) {
      expect(screen.getByRole("button", { name: nom }).className.split(/\s+/)).toContain("lg:px-1.5");
    }
  });

  it("l'alerte « Pas de recette disponible » est dans le bloc ancré", () => {
    rendre({ indisponible: true });
    const alerte = screen.getByRole("alert");
    expect((alerte.parentElement as HTMLElement).className).toContain("mt-auto");
  });

  // Q19 (#352) : en mobile seule la carte du jour (`li`) est bordée ; l'accent
  // des cartes de repas n'agit qu'à `lg` (colonne du jour en desktop). Sinon la
  // carte du jour contiendrait deux cartes elles aussi bordées (trois cadres).
  const classes = (el: Element) => (el as HTMLElement).className.split(/\s+/);
  function attendreAccentDesktopSeul(el: Element, couleurBase: string) {
    const c = classes(el);
    expect(c).toEqual(expect.arrayContaining(["border", "p-3", couleurBase]));
    expect(c).toEqual(
      expect.arrayContaining(["lg:border-2", "lg:border-brand-600", "lg:p-[11px]"])
    );
    // Aucune classe d'accent sans préfixe : rien ne change sous `lg`.
    expect(c).not.toContain("border-2");
    expect(c).not.toContain("border-brand-600");
    expect(c).not.toContain("p-[11px]");
  }

  it("accentue : bordure brand-600 épaisse à lg seulement ; sinon bordure normale", () => {
    const { container, rerender } = rendre({ accentue: true });
    attendreAccentDesktopSeul(container.firstElementChild!, "border-brand-100");
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
    const racine = container.firstElementChild!;
    expect((racine as HTMLElement).className).not.toContain("border-brand-600");
    expect(classes(racine)).toEqual(expect.arrayContaining(["border", "p-3", "border-brand-100"]));
  });

  it("variante restes : h-full et accentue (lg seulement)", () => {
    const { container } = rendre({ restes: true, accentue: true });
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("h-full");
    attendreAccentDesktopSeul(racine, "border-brand-200");
    const cuisiner = screen.getByRole("button", { name: "Cuisiner le déjeuner de lundi" });
    expect((cuisiner.parentElement as HTMLElement).className).toContain("mt-auto");
  });

  it("variante sans recette : h-full et accentue (lg seulement)", () => {
    const { container } = rendre({ recette: undefined, accentue: true });
    const racine = container.firstElementChild as HTMLElement;
    expect(racine.className).toContain("h-full");
    attendreAccentDesktopSeul(racine, "border-brand-100");
  });
});
