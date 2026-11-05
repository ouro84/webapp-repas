// Tests de la grille des jours commune aux vues Semaine et Cycle
// (components/planning/grille-jours.tsx, #352).
//
// Les deux paliers (liste mobile, rangées desktop) sont dans le DOM ; jsdom ne
// les masque pas, chaque assertion cible donc explicitement l'un ou l'autre.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GrilleJours, type JourGrille } from "@/components/planning/grille-jours";

afterEach(cleanup);

const PASTILLE = "Aujourd’hui";

// `n` jours consécutifs à partir du lundi 2 novembre 2026.
function jours(n: number): JourGrille[] {
  return Array.from({ length: n }, (_, i) => {
    const dateISO = `2026-11-${String(2 + i).padStart(2, "0")}`;
    return {
      cle: dateISO,
      dateISO,
      slots: [<div key="d">Déjeuner {dateISO}</div>, <div key="n">Dîner {dateISO}</div>],
    };
  });
}

describe("GrilleJours", () => {
  it("pastille « Aujourd’hui » seulement sur le jour égal à aujourdhuiISO (un par palier)", () => {
    const { container } = render(<GrilleJours jours={jours(7)} aujourdhuiISO="2026-11-05" />);
    expect(screen.getAllByText(PASTILLE)).toHaveLength(2);

    const items = Array.from(container.querySelectorAll("ul > li"));
    const marques = items.filter((li) => within(li as HTMLElement).queryByText(PASTILLE));
    expect(marques).toHaveLength(1);
    expect(marques[0].querySelector("h2")?.textContent).toMatch(/^Jeudi 5 nov/);

    const sections = Array.from(container.querySelectorAll("section"));
    const colonnes = sections.filter((s) => within(s as HTMLElement).queryByText(PASTILLE));
    expect(colonnes).toHaveLength(1);
    expect(colonnes[0].querySelector("h2")?.textContent).toMatch(/^Jeu 5/);
  });

  it("aucune pastille si aujourdhuiISO vaut null", () => {
    render(<GrilleJours jours={jours(7)} aujourdhuiISO={null} />);
    expect(screen.queryAllByText(PASTILLE)).toHaveLength(0);
  });

  it("10 jours : 2 rangées desktop de 7 puis 3 sections", () => {
    render(<GrilleJours jours={jours(10)} aujourdhuiISO={null} />);
    const rangees = screen.getAllByTestId("rangee-jours");
    expect(rangees).toHaveLength(2);
    expect(rangees[0].querySelectorAll("section")).toHaveLength(7);
    expect(rangees[1].querySelectorAll("section")).toHaveLength(3);
  });

  it("le libellé du jour précède la pastille dans le DOM (deux paliers)", () => {
    const { container } = render(<GrilleJours jours={jours(7)} aujourdhuiISO="2026-11-05" />);
    const titres = Array.from(container.querySelectorAll("h2")).filter((h) =>
      h.textContent?.includes(PASTILLE)
    );
    expect(titres).toHaveLength(2);
    for (const h2 of titres) {
      // Le texte (donc le nom accessible) commence par le jour, pas par la pastille.
      expect(h2.textContent).not.toMatch(/^Aujourd/);
      const enfants = Array.from(h2.children);
      const indexPastille = enfants.findIndex((e) => e.textContent === PASTILLE);
      expect(indexPastille).toBeGreaterThan(0);
      expect(enfants[0].textContent).toMatch(/^Jeu/);
    }
  });
});
