// Page Réglages (app/reglages/page.tsx, #400) : squelette de chargement.
//
// Les intitulés des cinq cartes restent en vrai texte, rendus une seule fois ;
// seuls les contrôles passent en squelette tant que les réglages ne sont pas
// lus. Tout ce qui suit le `h1` est une ZoneChargement (un seul `role="status"`,
// contenu masqué aux lecteurs d'écran, donc requêtes par texte ou `hidden`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  chargerReglages: vi.fn(),
  chargerRecettes: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/lib/reglages-data", () => ({
  chargerReglages: m.chargerReglages,
  sauvegarderReglages: vi.fn(),
}));
vi.mock("@/lib/recettes", () => ({ chargerRecettes: m.chargerRecettes }));

import PageReglages from "@/app/reglages/page";
import { REGLAGES_DEFAUT } from "@/lib/reglages";

const TITRES = [
  "Temps de préparation maximum",
  "Privilégier les repas végétariens",
  "Équilibre des accompagnements",
  "Recettes de saison",
  "Nombre de personnes par défaut",
];

beforeEach(() => {
  m.chargerReglages.mockReset();
  m.chargerRecettes.mockReset();
});

afterEach(cleanup);

describe("/reglages — chargement", () => {
  it("garde les titres réels, un seul status, et aucun contrôle réel", () => {
    m.chargerReglages.mockReturnValue(new Promise(() => {}));
    m.chargerRecettes.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PageReglages />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Chargement…")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Réglages de génération");
    // Zone sous le h1 masquée aux lecteurs d'écran : requêtes par texte.
    for (const titre of TITRES) expect(screen.getAllByText(titre)).toHaveLength(1);
    expect(container.querySelector("h2#section-personnes")?.textContent).toBe(TITRES[4]);

    expect(screen.queryAllByRole("switch", { hidden: true })).toHaveLength(0);
    expect(screen.queryAllByRole("radio", { hidden: true })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { hidden: true })).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("réserve la hauteur de la rangée de boutons pendant le chargement (CLS)", () => {
    m.chargerReglages.mockReturnValue(new Promise(() => {}));
    m.chargerRecettes.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PageReglages />);

    // Mobile : Réinitialiser (42 px, bordure) + gap-2 + Enregistrer (40 px) = 90 px ;
    // dès sm, une rangée de 42 px.
    const reserve = container.querySelector('[data-testid="reserve-boutons-reglages"]');
    expect(reserve).not.toBeNull();
    expect(reserve!.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["h-[90px]", "sm:h-[42px]", "invisible"])
    );
    expect(reserve!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("remplace le squelette par les contrôles une fois les réglages lus", async () => {
    m.chargerReglages.mockResolvedValue(REGLAGES_DEFAUT);
    m.chargerRecettes.mockResolvedValue([]);
    render(<PageReglages />);

    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(screen.queryByText("Chargement…")).toBeNull();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(4);
    // Rien à enregistrer juste après la lecture (RG-25, enregistrement explicite).
    expect(
      (screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(document.querySelector('[data-testid="reserve-boutons-reglages"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Réinitialiser" })).toBeTruthy();
    expect(screen.getByText("2 pers.")).toBeTruthy();
    for (const titre of TITRES) expect(screen.getAllByText(titre)).toHaveLength(1);
  });

  it("affiche l’erreur à la place du squelette si la lecture échoue", async () => {
    m.chargerReglages.mockRejectedValue(new Error("Lecture impossible."));
    m.chargerRecettes.mockResolvedValue([]);
    render(<PageReglages />);

    expect((await screen.findByRole("alert")).textContent).toBe("Lecture impossible.");
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryByText("Chargement…")).toBeNull();
    expect(screen.queryByText(TITRES[0])).toBeNull();
  });
});
