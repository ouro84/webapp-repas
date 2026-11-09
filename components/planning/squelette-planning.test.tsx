// Squelette de la vue Semaine de /planning (#400, RG-09) : une seule annonce
// « Chargement… », textes fixes réels (« Déjeuner », « Dîner », légende, titre
// s'il est connu), blocs masqués aux lecteurs d'écran.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SquelettePlanning } from "./squelette-planning";

afterEach(cleanup);

describe("SquelettePlanning", () => {
  it("expose une seule zone de chargement", () => {
    render(<SquelettePlanning titre="Mon planning de la semaine" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Chargement…");
  });

  it("rend « Déjeuner » et « Dîner » en vrai texte, 7 jours × grilles mobile et desktop", () => {
    render(<SquelettePlanning titre="Mon planning de la semaine" />);
    expect(screen.getAllByText("Déjeuner")).toHaveLength(14);
    expect(screen.getAllByText("Dîner")).toHaveLength(14);
  });

  it("titre connu → h1 réel (masqué aux lecteurs d’écran comme tout le squelette)", () => {
    render(<SquelettePlanning titre="Mon planning de la semaine" />);
    const titre = screen.getByRole("heading", { level: 1, hidden: true });
    expect(titre.textContent).toBe("Mon planning de la semaine");
    expect(titre.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("titre inconnu (repli Suspense) → aucun h1, une barre à la place", () => {
    render(<SquelettePlanning titre={null} />);
    expect(screen.queryByRole("heading", { level: 1, hidden: true })).toBeNull();
  });

  it("affiche la légende réelle des badges", () => {
    render(<SquelettePlanning titre={null} />);
    expect(screen.getByText("Végétarien")).not.toBeNull();
  });
});
