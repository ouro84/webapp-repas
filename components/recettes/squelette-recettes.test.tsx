// Squelette de /recettes (#400, RG-09) : une seule annonce « Chargement… »,
// 10 lignes jumelles de `li` de la liste chargée, tout sous aria-hidden.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SqueletteEnteteRecettes, SqueletteListeRecettes } from "./squelette-recettes";

afterEach(cleanup);

describe("SqueletteListeRecettes", () => {
  it("expose une seule zone de chargement qui réserve min-h-dvh", () => {
    const { container } = render(<SqueletteListeRecettes />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Chargement…");
    expect(screen.getByRole("status").className).toContain("min-h-dvh");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("réserve 10 lignes dans une liste bordée bg-surface, toutes sous aria-hidden", () => {
    const { container } = render(<SqueletteListeRecettes />);
    const listes = container.querySelectorAll("ul");
    expect(listes).toHaveLength(1);
    expect(listes[0].className).toContain("bg-surface");
    expect(listes[0].className).toContain("divide-y");
    const lignes = Array.from(container.querySelectorAll("li"));
    expect(lignes).toHaveLength(10);
    for (const ligne of lignes) {
      expect(ligne.className).toContain("min-h-11");
      expect(ligne.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("rend les libellés fixes en vrai texte et aucun contrôle réel", () => {
    const { container } = render(<SqueletteListeRecettes />);
    expect(screen.getByText("Végétariennes seulement")).not.toBeNull();
    expect(container.querySelectorAll("button, a, input, select, label")).toHaveLength(0);
  });

  it("chaque ligne porte le nom, un badge, les deux préférences et trois boutons en blocs", () => {
    const { container } = render(<SqueletteListeRecettes />);
    for (const ligne of Array.from(container.querySelectorAll("li"))) {
      // nom (span.flex-1) + badge + toggle (div) + 3 boutons
      expect(ligne.children).toHaveLength(6);
      expect(ligne.querySelectorAll(".size-8")).toHaveLength(2);
      expect(ligne.querySelectorAll(".h-9")).toHaveLength(3);
    }
  });
});

describe("SqueletteEnteteRecettes", () => {
  it("garde le titre en vrai texte et le bouton en bloc, hors rôle status", () => {
    const { container } = render(<SqueletteEnteteRecettes />);
    expect(container.querySelector("h1")?.textContent).toBe("Mes recettes");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });
});
