// Squelette de /courses (#400, RG-09) : une seule annonce « Chargement… »,
// textes fixes réels (titre, « Fond de placard »), 15 lignes de liste
// (5 + 3 + 4 en catégories, 3 en fond de placard), tout sous aria-hidden.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { EcranChargement } from "@/components/ui/ecran-chargement";
import { SqueletteCourses } from "./squelette-courses";

afterEach(cleanup);

function rendre() {
  return render(
    <EcranChargement>
      <SqueletteCourses />
    </EcranChargement>
  );
}

describe("SqueletteCourses", () => {
  it("expose une seule zone de chargement", () => {
    rendre();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Chargement…");
  });

  it("rend le titre et « Fond de placard » en vrai texte", () => {
    const { container } = rendre();
    expect(container.querySelector("h1")?.textContent).toBe("Liste de courses");
    expect(within(screen.getByRole("status")).getByText("Fond de placard")).not.toBeNull();
  });

  it("réserve 15 lignes (5 + 3 + 4 + 3 de fond de placard), toutes sous aria-hidden", () => {
    const { container } = rendre();
    const lignes = Array.from(container.querySelectorAll("li"));
    expect(lignes).toHaveLength(15);
    for (const ligne of lignes) {
      expect(ligne.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    const parListe = Array.from(container.querySelectorAll("ul")).map((ul) => ul.children.length);
    expect(parListe).toEqual([5, 3, 4, 3]);
  });

  it("reprend l’imbrication de l’état chargé : li > div min-h-11, pas de label", () => {
    const { container } = rendre();
    expect(container.querySelectorAll("label")).toHaveLength(0);
    for (const ligne of Array.from(container.querySelectorAll("li"))) {
      expect(ligne.children).toHaveLength(1);
      expect(ligne.firstElementChild?.tagName).toBe("DIV");
      expect(ligne.firstElementChild?.className).toContain("min-h-11");
    }
  });

  it("fond de placard : blocs en teinte placard (lisible sur accent-50, clair et sombre)", () => {
    const { container } = rendre();
    const placard = within(screen.getByRole("status")).getByText("Fond de placard").closest("section");
    expect(placard).not.toBeNull();
    const blocs = Array.from(placard!.querySelectorAll('[class~="motion-safe:animate-pulse"]'));
    expect(blocs.length).toBeGreaterThan(0);
    for (const bloc of blocs) {
      expect(bloc.className.split(/\s+/)).toContain("bg-squelette-placard");
    }
    // Hors placard, aucune teinte placard.
    expect(container.querySelectorAll(".bg-squelette-placard")).toHaveLength(blocs.length);
  });

  it("ne rend aucun bouton ni lien réel (les contrôles sont des blocs)", () => {
    const { container } = rendre();
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
  });
});
