// Tests du navigateur de période partagé (components/planning/navigateur-periode.tsx, #352).
//
// Un seul composant sert la vue Semaine, la vue Cycle et /courses : ces tests
// verrouillent son contrat d'accessibilité (groupe nommé, flèches nommées,
// bloc central aria-live) et ses états (bornes, désactivation).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavigateurPeriode } from "@/components/planning/navigateur-periode";

afterEach(cleanup);

const base = {
  libelle: "Ce cycle",
  dates: "du 5 au 14 novembre",
  courante: true,
  peutReculer: true,
  peutAvancer: true,
  onPrecedente: () => {},
  onSuivante: () => {},
};

describe("NavigateurPeriode", () => {
  it("unité cycle : groupe nommé, libellé, dates et flèches", () => {
    render(<NavigateurPeriode unite="cycle" {...base} />);
    const groupe = screen.getByRole("group", { name: "Naviguer entre les cycles" });
    expect(groupe.textContent).toContain("Ce cycle");
    expect(groupe.textContent).toContain("du 5 au 14 novembre");
    expect(screen.getByRole("button", { name: "Cycle précédent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cycle suivant" })).toBeTruthy();
  });

  it("bloc central en aria-live, data-courante posé seulement si courante", () => {
    const { container, rerender } = render(<NavigateurPeriode unite="cycle" {...base} />);
    expect(container.querySelector("[aria-live='polite']")).toBeTruthy();
    expect(container.querySelector("[data-courante]")).toBeTruthy();
    rerender(<NavigateurPeriode unite="cycle" {...base} courante={false} />);
    expect(container.querySelector("[data-courante]")).toBeNull();
  });

  it("peutReculer=false désactive la flèche précédente ; la suivante appelle onSuivante", () => {
    const onSuivante = vi.fn();
    render(
      <NavigateurPeriode unite="cycle" {...base} peutReculer={false} onSuivante={onSuivante} />,
    );
    expect(
      (screen.getByRole("button", { name: "Cycle précédent" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cycle suivant" }));
    expect(onSuivante).toHaveBeenCalledTimes(1);
  });

  it("unité semaine : groupe et flèches de semaine", () => {
    render(<NavigateurPeriode unite="semaine" {...base} libelle="Cette semaine" />);
    expect(screen.getByRole("group", { name: "Naviguer entre les semaines" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Semaine précédente" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Semaine suivante" })).toBeTruthy();
  });

  it("disabled désactive les deux flèches", () => {
    render(<NavigateurPeriode unite="semaine" {...base} disabled />);
    expect(
      (screen.getByRole("button", { name: "Semaine précédente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Semaine suivante" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("NavigateurPeriode : texte brut", () => {
  it("sépare le libellé et les dates par une espace", () => {
    render(<NavigateurPeriode unite="cycle" {...base} />);
    const groupe = screen.getByRole("group", { name: "Naviguer entre les cycles" });
    expect(groupe.textContent).toBe("Ce cycle du 5 au 14 novembre");
  });
});
