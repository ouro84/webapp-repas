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

// A7 (#352) : passer d'une période remplie à une vide (ou l'inverse) démonte
// l'en-tête et monte l'état vide ; le navigateur est remonté ailleurs. Le focus
// clavier doit rester sur la flèche cliquée (même direction, même unité).
describe("NavigateurPeriode : focus conservé au remontage", () => {
  function cliquerAuClavier(nom: string) {
    const bouton = screen.getByRole("button", { name: nom });
    bouton.focus();
    fireEvent.click(bouton);
  }

  it("le nouveau navigateur reprend le focus sur la flèche de même direction", () => {
    const premier = render(<NavigateurPeriode unite="cycle" {...base} />);
    cliquerAuClavier("Cycle suivant");
    premier.unmount(); // focus perdu : retombe sur <body>
    expect(document.activeElement).toBe(document.body);
    render(<NavigateurPeriode unite="cycle" {...base} />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Cycle suivant");
  });

  it("idem vers l'arrière, et une seule fois", () => {
    const premier = render(<NavigateurPeriode unite="semaine" {...base} />);
    cliquerAuClavier("Semaine précédente");
    premier.unmount();
    const second = render(<NavigateurPeriode unite="semaine" {...base} />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Semaine précédente");
    (document.activeElement as HTMLElement).blur();
    second.unmount();
    render(<NavigateurPeriode unite="semaine" {...base} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("aucune reprise si le focus a quitté la flèche avant le remontage", async () => {
    const premier = render(
      <>
        <NavigateurPeriode unite="cycle" {...base} />
        <button type="button">Ailleurs</button>
      </>
    );
    cliquerAuClavier("Cycle suivant");
    screen.getByRole("button", { name: "Ailleurs" }).focus();
    // Deux gestes sont séparés par au moins une microtâche (vérification du blur).
    await Promise.resolve();
    premier.unmount();
    render(<NavigateurPeriode unite="cycle" {...base} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("aucune reprise pour une autre unité", () => {
    const premier = render(<NavigateurPeriode unite="cycle" {...base} />);
    cliquerAuClavier("Cycle suivant");
    premier.unmount();
    render(<NavigateurPeriode unite="semaine" {...base} />);
    expect(document.activeElement).toBe(document.body);
  });

  // Safari (macOS, iOS) et Firefox macOS ne focalisent pas un bouton au clic :
  // aucun `blur` ne viendrait effacer l'attente, et le prochain navigateur de
  // même unité volerait le focus au chargement de la page.
  it("clic sans focus : aucune reprise au remontage", () => {
    const premier = render(<NavigateurPeriode unite="semaine" {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Semaine suivante" }));
    expect(document.activeElement).toBe(document.body);
    premier.unmount();
    render(<NavigateurPeriode unite="semaine" {...base} />);
    expect(document.activeElement).toBe(document.body);
  });

  // Flèche désactivée à une borne : le focus retombe sur <body> sans `blur`.
  // Quitter la page (démontage sans remontage dans le même rendu) efface
  // l'attente : le retour sur la page ne vole pas le focus.
  it("démontage sans remontage immédiat (changement de page) : l'attente est effacée", async () => {
    const premier = render(<NavigateurPeriode unite="semaine" {...base} />);
    cliquerAuClavier("Semaine suivante");
    premier.rerender(<NavigateurPeriode unite="semaine" {...base} peutAvancer={false} />);
    premier.unmount();
    await Promise.resolve(); // la page suivante se monte plus tard
    render(<NavigateurPeriode unite="semaine" {...base} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("aucun vol de focus si un autre élément l'a déjà", () => {
    const premier = render(<NavigateurPeriode unite="cycle" {...base} />);
    cliquerAuClavier("Cycle suivant");
    premier.unmount();
    const autre = document.createElement("input");
    document.body.appendChild(autre);
    autre.focus();
    render(<NavigateurPeriode unite="cycle" {...base} />);
    expect(document.activeElement).toBe(autre);
    autre.remove();
  });
});
