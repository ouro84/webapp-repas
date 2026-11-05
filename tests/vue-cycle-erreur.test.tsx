// Vue Cycle (components/planning/vue-cycle.tsx, #352) : premier chargement en
// échec. Règle des 3 états (loading / error / empty) : « Chargement… » ne doit
// pas rester affiché indéfiniment ; un état erreur propose « Réessayer », qui
// relance le chargement initial.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const m = vi.hoisted(() => ({
  chargerPlanningDistant: vi.fn(),
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
  useGenerationCycle: () => ({ enGeneration: false, genererCycle: vi.fn() }),
}));

import { VuePlanningCycle } from "@/components/planning/vue-cycle";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.chargerPlanningDistant.mockReset();
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
