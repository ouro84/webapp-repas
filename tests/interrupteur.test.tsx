// Tests du composant Interrupteur partagé (components/ui/interrupteur.tsx, #204).
//
// Le bug d'origine : deux switches bespoke divergeaient et l'un (onboarding)
// rendait un curseur désynchronisé de la piste (position arbitraire + mauvais
// token de couleur). Ces tests verrouillent l'invariant « piste et curseur
// s'accordent toujours sur l'état » + le contrat d'accessibilité, pour empêcher
// le retour de cette classe de bug.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Interrupteur } from "@/components/ui/interrupteur";

afterEach(cleanup);

describe("Interrupteur", () => {
  it("expose role=switch et reflète l'état via aria-checked", () => {
    const { rerender } = render(
      <Interrupteur actif={false} onChange={() => {}} label="Foyer végétarien" />
    );
    const sw = screen.getByRole("switch", { name: "Foyer végétarien" });
    expect(sw.getAttribute("aria-checked")).toBe("false");

    rerender(
      <Interrupteur actif onChange={() => {}} label="Foyer végétarien" />
    );
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("appelle onChange avec la valeur inverse au clic", () => {
    const onChange = vi.fn();
    render(<Interrupteur actif={false} onChange={onChange} label="X" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);

    cleanup();
    const onChange2 = vi.fn();
    render(<Interrupteur actif onChange={onChange2} label="X" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange2).toHaveBeenCalledWith(false);
  });

  // Cœur de la non-régression #204 : la position du curseur ET la couleur de la
  // piste doivent rester COHÉRENTES avec l'état (le bug montrait un curseur à
  // droite sur une piste « off », et une valeur de translation arbitraire).
  it("synchronise curseur et piste sur l'état OFF", () => {
    render(<Interrupteur actif={false} onChange={() => {}} label="X" />);
    const sw = screen.getByRole("switch");
    const curseur = sw.querySelector("span");
    expect(sw.className).toContain("bg-brand-200"); // piste off
    expect(sw.className).not.toContain("bg-primary");
    expect(curseur?.className).toContain("translate-x-0.5"); // curseur à gauche
    // Garde-fou anti-retour de la valeur arbitraire fautive.
    expect(curseur?.className).not.toContain("translate-x-[1.375rem]");
  });

  it("synchronise curseur et piste sur l'état ON", () => {
    render(<Interrupteur actif onChange={() => {}} label="X" />);
    const sw = screen.getByRole("switch");
    const curseur = sw.querySelector("span");
    expect(sw.className).toContain("bg-primary"); // piste on
    expect(curseur?.className).toContain("translate-x-5"); // curseur à droite (canonique)
    expect(curseur?.className).not.toContain("translate-x-[1.375rem]");
    // Token dark-mode correct (le bug utilisait bg-white en dur).
    expect(curseur?.className).toContain("bg-surface");
    expect(curseur?.className).not.toContain("bg-white");
  });

  it("supporte un libellé indirect via libelleId (aria-labelledby)", () => {
    render(
      <>
        <span id="lbl-test">Saisonnalité</span>
        <Interrupteur actif onChange={() => {}} libelleId="lbl-test" />
      </>
    );
    // getByRole résout le nom accessible depuis l'élément référencé.
    expect(screen.getByRole("switch", { name: "Saisonnalité" })).toBeTruthy();
  });
});
