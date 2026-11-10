// /courses (app/courses/page.tsx) : premier accès sans cycle en cache, lecture
// du cycle en échec (#402). Règle des 3 états (RG-09) : le squelette
// « Chargement… » ne doit pas rester affiché indéfiniment ; un état erreur
// propose « Réessayer », qui relance le chargement. Jumeau de la vue Cycle
// (tests/vue-cycle-erreur.test.tsx). La vraie couche lib/sync tourne : seuls
// les accès distants sont simulés.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ chargerPlanningDistant: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/persistance", () => ({
  chargerPlanningDistant: m.chargerPlanningDistant,
  chargerLongueurCycle: () => Promise.resolve(7),
  chargerCochesDistantes: () => Promise.resolve({}),
  chargerEtatCochesDistant: () => Promise.resolve({}),
  chargerArticlesManuelsDistants: () => Promise.resolve([]),
  chargerFoyerId: () => Promise.resolve("foyer-1"),
  purgerCyclesAvant: () => Promise.resolve(),
  purgerSemainesAvant: () => Promise.resolve(),
}));
vi.mock("@/lib/foyer", () => ({ chargerJourCoursesFoyer: () => Promise.resolve(1) }));
vi.mock("@/lib/reglages-data", () => ({ chargerReglages: () => new Promise(() => {}) }));
// Temps réel et présence : canaux inertes.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const canal: Record<string, unknown> = {};
    canal.on = () => canal;
    canal.subscribe = () => canal;
    canal.presenceState = () => ({});
    canal.track = async () => {};
    canal.untrack = async () => {};
    canal.topic = "";
    return {
      channel: () => canal,
      removeChannel: async () => {},
      getChannels: () => [],
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
      realtime: { setAuth: () => {} },
    };
  },
}));

import PageCourses from "@/app/courses/page";
import { arreterSync } from "@/lib/sync";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.chargerPlanningDistant.mockReset();
});

afterEach(async () => {
  cleanup();
  await arreterSync();
  vi.restoreAllMocks();
});

describe("/courses : premier chargement du cycle en échec (#402)", () => {
  it("affiche l'état erreur au lieu du squelette ; « Réessayer » relance le chargement", async () => {
    m.chargerPlanningDistant.mockRejectedValue(new Error("réseau"));
    render(<PageCourses />);

    expect(await screen.findByText("Impossible de charger la liste de courses.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryByText("Chargement…")).toBeNull();

    // Second essai réussi : cycle sans planning → état vide.
    m.chargerPlanningDistant.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Aucun repas planifié sur ce cycle")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("Impossible de charger la liste de courses.")).toBeNull()
    );
  });
});
