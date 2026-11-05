// Vue Cycle (components/planning/vue-cycle.tsx, #352) : premier chargement en
// échec. Règle des 3 états (loading / error / empty) : « Chargement… » ne doit
// pas rester affiché indéfiniment ; un état erreur propose « Réessayer », qui
// relance le chargement initial.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

const m = vi.hoisted(() => ({
  chargerPlanningDistant: vi.fn(),
  genererCycle: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/lib/persistance", () => ({
  chargerLongueurCycle: () => Promise.resolve(7),
  chargerPlanningDistant: m.chargerPlanningDistant,
}));
vi.mock("@/lib/foyer", () => ({ chargerJourCoursesFoyer: () => Promise.resolve(1) }));
vi.mock("@/lib/ancre-cycle", () => ({ resoudreAncreCycle: vi.fn() }));
vi.mock("@/lib/supabase/par-defaut", () => ({ clientParDefaut: vi.fn() }));
vi.mock("@/lib/reglages-data", () => ({ chargerReglages: () => new Promise(() => {}) }));
vi.mock("@/lib/recettes", () => ({ chargerRecettesGerees: () => new Promise(() => {}) }));
vi.mock("@/lib/preferences", () => ({ chargerPreferences: () => new Promise(() => {}) }));
vi.mock("@/lib/sync", () => ({
  definirCycleAffiche: vi.fn(),
  modifierSlotDistant: vi.fn(),
  useGenerationCycle: () => ({ enGeneration: false, genererCycle: m.genererCycle }),
}));

import { VuePlanningCycle } from "@/components/planning/vue-cycle";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.chargerPlanningDistant.mockReset();
  m.genererCycle.mockReset();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rendre() {
  return render(
    <VuePlanningCycle idsModifiables={new Set()} vue="cycle" onChangerVue={() => {}} />
  );
}

describe("VuePlanningCycle : premier chargement en échec", () => {
  it("affiche l'état erreur au lieu de « Chargement… » ; « Réessayer » relance le chargement", async () => {
    m.chargerPlanningDistant.mockRejectedValue(new Error("réseau"));
    rendre();

    expect(await screen.findByText("Impossible de charger le cycle.")).toBeTruthy();
    expect(screen.queryByText("Chargement…")).toBeNull();

    // La lecture réussit au second essai : cycle vide (aucun planning).
    m.chargerPlanningDistant.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Aucun repas planifié sur ce cycle.")).toBeTruthy();
    expect(screen.queryByText("Impossible de charger le cycle.")).toBeNull();
  });
});

describe("VuePlanningCycle : génération du cycle puis relecture en erreur (#357)", () => {
  // Cycle vide affiché, prêt à générer ; renvoie le nombre de lectures du
  // chargement initial (1 ou 2 semaines ISO selon le jour de courses).
  async function afficherCycleVide(): Promise<number> {
    m.chargerPlanningDistant.mockResolvedValue(null);
    rendre();
    await screen.findByText("Aucun repas planifié sur ce cycle.");
    const lectures = m.chargerPlanningDistant.mock.calls.length;
    m.chargerPlanningDistant.mockClear();
    return lectures;
  }

  const sansAvertissement = {
    vegeNonHonore: false,
    mixNonHonore: false,
    saisonNonHonore: false,
  };

  it("relecture ratée après une génération réussie : la vue retente la lecture du cycle", async () => {
    const lectures = await afficherCycleVide();
    m.genererCycle.mockResolvedValue(sansAvertissement);
    // La première lecture de la relecture échoue, les suivantes réussissent.
    m.chargerPlanningDistant.mockRejectedValueOnce(new Error("réseau"));
    m.chargerPlanningDistant.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    // Relecture (échec) + nouvelle lecture de resynchronisation.
    await waitFor(() =>
      expect(m.chargerPlanningDistant).toHaveBeenCalledTimes(lectures * 2)
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Certains jours du cycle n'ont pas pu être chargés. Réessaie."
    );
  });

  it("génération rejetée : toast d'erreur inchangé et cycle relu pour se resynchroniser", async () => {
    const lectures = await afficherCycleVide();
    m.genererCycle.mockRejectedValue(
      new Error(
        "Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie."
      )
    );
    m.chargerPlanningDistant.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    await waitFor(() =>
      expect(m.chargerPlanningDistant).toHaveBeenCalledTimes(lectures)
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie."
    );
  });
});
