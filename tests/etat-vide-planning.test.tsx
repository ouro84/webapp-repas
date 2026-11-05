// Tests de l'état vide partagé de /planning (components/planning/etat-vide-planning.tsx, #352).
//
// Pendant un rechargement (navigation entre cycles), seul le corps (aperçu +
// message + bouton) est estompé et marqué `aria-busy` : titre, bascule et
// navigateur restent nets, comme l'en-tête du cycle rempli.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EtatVidePlanning } from "@/components/planning/etat-vide-planning";

afterEach(cleanup);

function rendre(chargement?: boolean) {
  return render(
    <EtatVidePlanning
      titre="Mon planning du cycle"
      vue="cycle"
      onChangerVue={() => {}}
      navigateur={<div role="group" aria-label="Naviguer entre les cycles" />}
      enAttente={false}
      message="Aucun repas planifié sur ce cycle."
      libelleBouton="Générer mon cycle"
      libelleAttente="Génération…"
      onGenerer={() => {}}
      generationEnCours={false}
      chargement={chargement}
    />
  );
}

// Vrai si l'élément ou un de ses ancêtres porte la classe.
function dansClasse(el: Element, classe: string): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.classList.contains(classe)) return true;
  }
  return false;
}

describe("EtatVidePlanning : chargement", () => {
  it("estompe seulement le corps, marqué aria-busy", () => {
    rendre(true);
    const message = screen.getByText("Aucun repas planifié sur ce cycle.");
    const bouton = screen.getByRole("button", { name: "Générer mon cycle" });
    const corps = message.closest("[aria-busy]") as HTMLElement;
    expect(corps).not.toBeNull();
    expect(corps.getAttribute("aria-busy")).toBe("true");
    expect(corps.contains(bouton)).toBe(true);
    expect(dansClasse(message, "opacity-50")).toBe(true);

    for (const net of [
      screen.getByRole("heading", { name: "Mon planning du cycle" }),
      screen.getByRole("group", { name: "Naviguer entre les cycles" }),
      screen.getByRole("group", { name: "Vue du planning" }),
    ]) {
      expect(dansClasse(net, "opacity-50")).toBe(false);
      expect(corps.contains(net)).toBe(false);
    }
  });

  it("hors chargement : rien d'estompé, aria-busy faux", () => {
    rendre(false);
    const message = screen.getByText("Aucun repas planifié sur ce cycle.");
    expect(dansClasse(message, "opacity-50")).toBe(false);
    expect(message.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
  });
});

// Le corps est un item flex d'une colonne centrée : sans `w-full`, il prend la
// largeur de son contenu et rétrécit l'aperçu (`w-full max-w-lg`, ~512 → 460 px
// dès `sm`), y compris dans l'état vide de la semaine (#352, revue).
describe("EtatVidePlanning : largeur", () => {
  it("le corps occupe toute la largeur, l'aperçu garde son max-w-lg", () => {
    rendre(false);
    const corps = screen
      .getByText("Aucun repas planifié sur ce cycle.")
      .closest("[aria-busy]") as HTMLElement;
    expect(corps.classList.contains("w-full")).toBe(true);
  });
});
