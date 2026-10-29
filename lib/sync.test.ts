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
import type { JourPlanning, Planning } from "@/types";

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
  chargerLongueurCycle: vi.fn(),
  chargerArticlesManuelsDistants: vi.fn(),
  purgerCyclesAvant: vi.fn(),
  sauvegarderSlotsDistant: vi.fn(),
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
  persistance.chargerLongueurCycle.mockResolvedValue(7);
  persistance.chargerArticlesManuelsDistants.mockResolvedValue([]);
  persistance.purgerCyclesAvant.mockResolvedValue(undefined);
  persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T12:00:00.000Z");
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

describe("allerAuCycle — relais one-shot par query param (#279)", () => {
  it("flushe les écritures en attente PUIS charge l'ancre cible, écrase le cycle affiché", async () => {
    localStorage.setItem(
      "cycle_affiche",
      JSON.stringify({ ancre: "2026-06-29", longueur: 7 })
    );
    persistance.chargerLongueurCycle.mockResolvedValue(9);
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { allerAuCycle } = await chargerSync();

    await allerAuCycle("2026-07-13");

    expect(persistance.chargerLongueurCycle).toHaveBeenCalledWith("2026-07-13");
    expect(JSON.parse(localStorage.getItem("cycle_affiche")!)).toEqual({
      ancre: "2026-07-13",
      longueur: 9,
    });
  });

  it("flushe le planning dirty avant de basculer d'ancre", async () => {
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    persistance.chargerLongueurCycle.mockResolvedValue(7);
    const { allerAuCycle } = await chargerSync();

    await allerAuCycle("2026-07-13");

    expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(); // flush d'abord
  });
});

function jourPlanningSimple(
  jour: "lundi" | "mardi",
  diner: { id: string; nom: string }
): JourPlanning {
  return {
    jour,
    diner: { ...diner, tempsPreparation: "rapide", ingredients: [] },
  } as JourPlanning;
}

describe("modifierSlotDistant — édition ponctuelle découplée de storePlanning (suite #279)", () => {
  it("persiste UNIQUEMENT le jour fourni, sans toucher storePlanning si semaine ≠ affichée", async () => {
    localStorage.setItem("semaine_affichee", "2026-W10"); // autre semaine que celle éditée
    const { modifierSlotDistant } = await chargerSync();

    await modifierSlotDistant("2026-W12", jourPlanningSimple("lundi", { id: "r1", nom: "R1" }));

    expect(persistance.sauvegarderSlotsDistant).toHaveBeenCalledWith(
      "2026-W12",
      [jourPlanningSimple("lundi", { id: "r1", nom: "R1" })]
    );
    expect(localStorage.getItem("planning_courant")).toBeNull(); // storePlanning intact
  });

  it("met à jour storePlanning ET planning_courant_maj si la semaine éditée EST l'affichée", async () => {
    localStorage.setItem("semaine_affichee", "2026-W12");
    localStorage.setItem(
      "planning_courant",
      JSON.stringify({
        semaine: "2026-W12",
        jours: [
          { jour: "lundi", diner: { id: "vieux", nom: "Vieux", tempsPreparation: "rapide", ingredients: [] } },
        ],
      })
    );
    persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T15:00:00.000Z");
    const { modifierSlotDistant } = await chargerSync();

    await modifierSlotDistant("2026-W12", jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }));

    const local = JSON.parse(localStorage.getItem("planning_courant")!);
    expect(local.jours[0].diner.id).toBe("nouveau");
    expect(localStorage.getItem("planning_courant_maj")).toBe("2026-07-16T15:00:00.000Z");
  });

  it("patche storePlanning SANS planifier de push sauvegarder_planning (pas de double écriture, #301)", async () => {
    const { semaineParDefaut } = await import("@/lib/semaines");
    const semaine = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine, jours: [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })] },
      updatedAt: "2026-07-16T10:00:00.000Z",
    });
    persistance.sauvegarderSlotsDistant.mockResolvedValue("2026-07-16T15:00:00.000Z");
    const { useSync, modifierSlotDistant } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSync()); // abonne planifierPush à storePlanning
    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));
    await vi.waitFor(() => expect(localStorage.getItem("planning_courant")).not.toBeNull());

    await modifierSlotDistant(semaine, jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }));

    expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].diner.id).toBe("nouveau");
    expect(localStorage.getItem("planning_courant_maj")).toBe("2026-07-16T15:00:00.000Z"); // anti-écho US-21
    expect(localStorage.getItem("planning_dirty")).toBeNull();
    await new Promise((r) => setTimeout(r, 900)); // > DELAI_DEBOUNCE_MS (800)
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  it("ne coupe pas la garde d'une relecture en cours (garde réentrante, revue #301)", async () => {
    const { semaineParDefaut } = await import("@/lib/semaines");
    const semaine = semaineParDefaut();
    // Cache propre et horodaté → hydrater relance chargerSemaineDansCache, qui
    // pose la garde pendant toute sa lecture distante (laissée en suspens).
    localStorage.setItem("semaine_affichee", semaine);
    localStorage.setItem(
      "planning_courant",
      JSON.stringify({ semaine, jours: [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })] })
    );
    localStorage.setItem("planning_courant_maj", "2026-07-16T09:00:00.000Z");
    let resoudreLecture!: (v: unknown) => void;
    persistance.chargerPlanningDistant.mockReturnValue(new Promise((r) => (resoudreLecture = r)));
    const { useSync, modifierSlotDistant } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useSync());
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalled());

    await modifierSlotDistant(semaine, jourPlanningSimple("lundi", { id: "cycle", nom: "Cycle" }));
    resoudreLecture({
      planning: { semaine, jours: [jourPlanningSimple("lundi", { id: "distant", nom: "Distant" })] },
      updatedAt: "2026-07-16T16:00:00.000Z",
    });
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].diner.id).toBe("distant")
    );

    // chargerSemaineDansCache efface planning_dirty après coup, mais un push
    // armé sans garde partirait quand même → on observe l'écriture elle-même.
    await new Promise((r) => setTimeout(r, 900)); // > DELAI_DEBOUNCE_MS (800)
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });
});

describe("useSyncCourses — ancre forcée court-circuite le défaut du jour (#279)", () => {
  it("sans ancre forcée : hydrate le défaut du jour (comportement inchangé)", async () => {
    persistance.chargerFoyerId.mockResolvedValue("foyer-1");
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { useSyncCourses } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");

    renderHook(() => useSyncCourses());
    await new Promise((r) => setTimeout(r, 0)); // laisse l'effet async se dérouler

    expect(localStorage.getItem("cycle_affiche")).not.toBeNull();
  });

  it("avec ancre forcée : bascule directement sur cette ancre, sans passer par le défaut du jour", async () => {
    persistance.chargerLongueurCycle.mockResolvedValue(7);
    persistance.chargerPlanningDistant.mockResolvedValue(null);
    const { useSyncCourses } = await chargerSync();
    const { renderHook } = await import("@testing-library/react");

    renderHook(() => useSyncCourses("2026-07-13"));
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(localStorage.getItem("cycle_affiche")!).ancre).toBe("2026-07-13");
  });
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
