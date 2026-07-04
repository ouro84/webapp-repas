// Tests d'intégration de la couche de synchronisation (lib/sync.ts) — #165.
//
// Pourquoi en intégration et pas en pur : la logique critique (last-write-wins /
// dirty-first, file de rejeu hors-ligne, flush avant navigation, purge de
// rétention) est inline dans hydrater()/naviguerVers()/attendreSync() et couplée
// à localStorage + à la couche persistance. On la teste donc « pour de vrai » en
// mockant SEULEMENT les accès distants (lib/persistance) et le client Supabase
// Realtime, avec localStorage jsdom. Chaque test repart d'un module sync neuf
// (vi.resetModules) pour réinitialiser l'état singleton (dejaHydrate, dirty…).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Planning } from "@/types";

// Mocks des accès distants — objet hoisté stable, réinitialisé à chaque test.
const persistance = vi.hoisted(() => ({
  chargerPlanningDistant: vi.fn(),
  chargerCochesDistantes: vi.fn(),
  sauvegarderPlanningDistant: vi.fn(),
  purgerSemainesAvant: vi.fn(),
  chargerFoyerId: vi.fn(),
  cocherArticleDistant: vi.fn(),
  decocherArticleDistant: vi.fn(),
  viderCochesDistantes: vi.fn(),
}));
vi.mock("@/lib/persistance", () => persistance);

// Client Supabase Realtime — stub no-op (les abonnements sont fire-and-forget
// dans hydrater/chargerSemaineDansCache ; on ne teste pas le temps réel ici).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const canal: Record<string, unknown> = {};
    canal.on = () => canal;
    canal.subscribe = () => canal;
    canal.presenceState = () => ({});
    canal.track = async () => {};
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

function recette(id: string) {
  return { id, nom: id, tempsPreparation: "rapide" as const, ingredients: [] };
}
function planning(semaine: string): Planning {
  return { semaine, jours: [{ jour: "lundi", diner: recette("r1") }] };
}

// Recharge un module sync VIERGE (état singleton réinitialisé).
async function chargerSync() {
  vi.resetModules();
  return import("@/lib/sync");
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(persistance)) fn.mockReset();
  persistance.chargerFoyerId.mockResolvedValue("foyer-1");
  persistance.chargerCochesDistantes.mockResolvedValue({});
  persistance.purgerSemainesAvant.mockResolvedValue(undefined);
  persistance.chargerPlanningDistant.mockResolvedValue(null);
  persistance.sauvegarderPlanningDistant.mockResolvedValue("2026-06-15T10:00:00.000Z");
  persistance.viderCochesDistantes.mockResolvedValue(undefined);
  persistance.cocherArticleDistant.mockResolvedValue(undefined);
  persistance.decocherArticleDistant.mockResolvedValue(undefined);
});

describe("hydrater — last-write-wins / dirty-first (RG-23)", () => {
  it("cache vide → hydrate la semaine par défaut depuis la base", async () => {
    const { hydrater } = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const def = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: planning(def),
      updatedAt: "2026-06-15T10:00:00.000Z",
    });

    await hydrater();

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledWith(def);
    expect(JSON.parse(localStorage.getItem("planning_courant")!).semaine).toBe(def);
    expect(localStorage.getItem("semaine_affichee")).toBe(def);
  });

  it("cache local DIRTY → conservé (jamais écrasé) puis poussé, dirty levé au succès", async () => {
    const local = planning("2026-W10");
    localStorage.setItem("planning_courant", JSON.stringify(local));
    localStorage.setItem("planning_dirty", "1");
    localStorage.setItem("planning_courant_maj", "2026-06-10T00:00:00.000Z");
    const { hydrater } = await chargerSync();

    await hydrater();

    // Le local fait foi : pas de pull, semaine affichée = celle du local.
    expect(persistance.chargerPlanningDistant).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("planning_courant")!).semaine).toBe("2026-W10");
    expect(localStorage.getItem("semaine_affichee")).toBe("2026-W10");
    // Push fire-and-forget → on attend, puis dirty levé + horodatage serveur posé.
    await vi.waitFor(() =>
      expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled()
    );
    await vi.waitFor(() => expect(localStorage.getItem("planning_dirty")).toBeNull());
    expect(localStorage.getItem("planning_courant_maj")).toBe("2026-06-15T10:00:00.000Z");
  });

  it("cache local NON HORODATÉ → conservé sans push (legacy / injecté e2e)", async () => {
    const local = planning("2025-W01");
    localStorage.setItem("planning_courant", JSON.stringify(local));
    // ni planning_dirty ni planning_courant_maj
    const { hydrater } = await chargerSync();

    await hydrater();

    expect(localStorage.getItem("semaine_affichee")).toBe("2025-W01");
    expect(JSON.parse(localStorage.getItem("planning_courant")!).semaine).toBe("2025-W01");
    expect(persistance.chargerPlanningDistant).not.toHaveBeenCalled();
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  it("cache local CLEAN horodaté → recharge la semaine par défaut (pas figé sur la semaine parcourue)", async () => {
    const local = planning("2025-W01"); // clairement passée ≠ défaut
    localStorage.setItem("planning_courant", JSON.stringify(local));
    localStorage.setItem("planning_courant_maj", "2025-01-02T00:00:00.000Z");
    // pas de planning_dirty
    const { hydrater } = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const def = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: planning(def),
      updatedAt: "2026-06-15T10:00:00.000Z",
    });

    await hydrater();

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledWith(def);
    expect(localStorage.getItem("semaine_affichee")).toBe(def);
  });
});

describe("file de rejeu hors-ligne (RG-23)", () => {
  it("échec de push → planning_dirty conservé (rejouable)", async () => {
    const local = planning("2026-W10");
    localStorage.setItem("planning_courant", JSON.stringify(local));
    localStorage.setItem("planning_dirty", "1");
    persistance.sauvegarderPlanningDistant.mockRejectedValue(new Error("hors-ligne"));
    const { hydrater } = await chargerSync();

    await hydrater();

    await vi.waitFor(() =>
      expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled()
    );
    // Le push a échoué → dirty NON levé : la prochaine occasion rejouera.
    expect(localStorage.getItem("planning_dirty")).toBe("1");
  });
});

describe("naviguerVers — flush avant navigation (RG-24)", () => {
  it("flushe les écritures en attente PUIS charge la semaine cible", async () => {
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    localStorage.setItem("semaine_affichee", "2026-W10");
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: planning("2026-W12"),
      updatedAt: "2026-06-15T11:00:00.000Z",
    });
    const { naviguerVers } = await chargerSync();

    await naviguerVers("2026-W12");

    expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(); // flush d'abord
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledWith("2026-W12");
    expect(localStorage.getItem("semaine_affichee")).toBe("2026-W12");
    expect(JSON.parse(localStorage.getItem("planning_courant")!).semaine).toBe("2026-W12");
  });

  it("annule la navigation si le flush échoue (hors-ligne) — aucune perte", async () => {
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    localStorage.setItem("semaine_affichee", "2026-W10");
    persistance.sauvegarderPlanningDistant.mockRejectedValue(new Error("hors-ligne"));
    const { naviguerVers } = await chargerSync();

    await naviguerVers("2026-W12");

    // Flush KO → on ne charge pas la cible, on ne change pas la semaine affichée,
    // et le planning local en attente est préservé.
    expect(persistance.chargerPlanningDistant).not.toHaveBeenCalled();
    expect(localStorage.getItem("semaine_affichee")).toBe("2026-W10");
    expect(JSON.parse(localStorage.getItem("planning_courant")!).semaine).toBe("2026-W10");
    expect(localStorage.getItem("planning_dirty")).toBe("1");
  }, 10000);
});

describe("purge de rétention (RG-24)", () => {
  it("purge les semaines au-delà de -12, une seule fois par session", async () => {
    const { hydrater } = await chargerSync();
    const { semaineISO, semaineDecalee } = await import("@/lib/semaines");
    const cutoff = semaineDecalee(semaineISO(new Date()), -12);

    await hydrater();
    await hydrater(); // dejaHydrate → ne re-purge pas

    expect(persistance.purgerSemainesAvant).toHaveBeenCalledTimes(1);
    expect(persistance.purgerSemainesAvant).toHaveBeenCalledWith(cutoff);
  });
});

// Non-régression #257 : les getSnapshot des stores de cycle doivent renvoyer une
// référence STABLE tant que la valeur brute localStorage n'a pas changé. Sinon
// useSyncExternalStore boucle (« Maximum update depth exceeded », React #185) et
// /courses tombe sur son error boundary dès que le cycle est hydraté. Bug vécu :
// lireCycleAffiche re-parsait à chaque appel (contrairement à lireCyclePlanning).
describe("stores de cycle — stabilité du snapshot (#257, anti-boucle React #185)", () => {
  it("useCycleAffiche : ne boucle pas et renvoie une référence stable", async () => {
    const { useCycleAffiche } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    localStorage.setItem(
      "cycle_affiche",
      JSON.stringify({ ancre: "2026-06-29", longueur: 7 })
    );
    // Sans mémoïsation, ce render throwait (re-render infini).
    const { result, rerender } = renderHook(() => useCycleAffiche());
    expect(result.current).toEqual({ ancre: "2026-06-29", longueur: 7 });
    const premier = result.current;
    rerender();
    expect(result.current).toBe(premier); // même référence → pas de boucle
  });

  it("useCyclePlanning : renvoie une référence stable", async () => {
    const { useCyclePlanning } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    localStorage.setItem(
      "cycle_planning",
      JSON.stringify(planning("2026-06-29"))
    );
    const { result, rerender } = renderHook(() => useCyclePlanning());
    expect(result.current?.semaine).toBe("2026-06-29");
    const premier = result.current;
    rerender();
    expect(result.current).toBe(premier);
  });
});
