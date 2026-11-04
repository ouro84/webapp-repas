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
  sauvegarderCycleDistant: vi.fn(),
  basculerCocheArticleManuelDistant: vi.fn(),
  viderCochesArticlesManuelsDistantes: vi.fn(),
  creerArticleManuelDistant: vi.fn(),
}));
vi.mock("@/lib/persistance", () => persistance);

// Rappels `postgres_changes` enregistrés par les abonnements : un test peut
// ainsi rejouer un événement Realtime (ex. l'écho d'une écriture).
type RappelRealtime = { filtre: { table?: string }; rappel: (payload: unknown) => void };
const realtime = vi.hoisted(() => ({ rappels: [] as RappelRealtime[] }));

// Client Supabase Realtime — stub (les abonnements sont fire-and-forget dans
// hydrater/chargerSemaineDansCache) ; les rappels sont seulement mémorisés.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const canal: Record<string, unknown> = {};
    canal.on = (_type: string, filtre: RappelRealtime["filtre"], rappel: RappelRealtime["rappel"]) => {
      realtime.rappels.push({ filtre, rappel });
      return canal;
    };
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
  realtime.rappels.length = 0;
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
  persistance.sauvegarderCycleDistant.mockResolvedValue({
    "2026-W44": "2026-10-29T12:00:00.000Z",
    "2026-W45": "2026-10-29T12:00:00.000Z",
  });
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

describe("appliquerGenerationCycle — écriture atomique sauvegarder_cycle (#304)", () => {
  const semaines = [
    { semaine: "2026-W44", jours: [jourPlanningSimple("lundi", { id: "r1", nom: "R1" })] },
    { semaine: "2026-W45", jours: [jourPlanningSimple("mardi", { id: "r2", nom: "R2" })] },
  ];

  beforeEach(() => {
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-10-29", longueur: 7 }));
  });

  it("un seul appel sauvegarder_cycle, ni sauvegarder_slots ni purge client", async () => {
    const { appliquerGenerationCycle } = await chargerSync();

    await appliquerGenerationCycle("2026-10-29", semaines);

    expect(persistance.sauvegarderCycleDistant).toHaveBeenCalledTimes(1);
    expect(persistance.sauvegarderCycleDistant).toHaveBeenCalledWith("2026-10-29", semaines);
    expect(persistance.sauvegarderSlotsDistant).not.toHaveBeenCalled();
    expect(persistance.viderCochesDistantes).not.toHaveBeenCalled();
  });

  it("vide les coches locales du cycle après succès (RG-13)", async () => {
    localStorage.setItem("courses_cochees", JSON.stringify({ "tomate|piece": 2 }));
    localStorage.setItem("courses_dirty", "1");
    const { appliquerGenerationCycle } = await chargerSync();

    await appliquerGenerationCycle("2026-10-29", semaines);

    expect(localStorage.getItem("courses_cochees")).toBeNull();
    expect(localStorage.getItem("courses_dirty")).toBeNull();
  });

  it("échec RPC : rejette et laisse les coches locales intactes", async () => {
    const coches = JSON.stringify({ "tomate|piece": 2 });
    localStorage.setItem("courses_cochees", coches);
    persistance.sauvegarderCycleDistant.mockRejectedValue(
      new Error("Sauvegarde du cycle impossible : boom")
    );
    const { appliquerGenerationCycle } = await chargerSync();

    await expect(appliquerGenerationCycle("2026-10-29", semaines)).rejects.toThrow(
      "Sauvegarde du cycle impossible : boom"
    );
    expect(localStorage.getItem("courses_cochees")).toBe(coches);
  });
});

describe("coche posée pendant l'hydratation d'un cycle (/courses)", () => {
  // Régression : `chargerCycleDansCache` levait un drapeau d'hydratation pendant
  // TOUT le chargement (planning, coches, articles manuels) et
  // `surChangementCoches` ignorait toute écriture de coche tant qu'il était levé.
  // Une coche faite pendant ce temps (ex. pendant la lecture des articles
  // manuels) restait locale, jamais marquée dirty ni poussée — puis l'hydratation
  // suivante l'écrasait par la base vide : coche perdue.
  it("marque la coche dirty et la pousse sous l'ancre du cycle", async () => {
    let libererArticles!: (v: unknown[]) => void;
    persistance.chargerArticlesManuelsDistants.mockReturnValue(
      new Promise((r) => {
        libererArticles = r;
      })
    );
    const { useSyncCourses } = await chargerSync();
    const { storeCoches } = await import("@/lib/stockage");
    const { renderHook, waitFor } = await import("@testing-library/react");

    renderHook(() => useSyncCourses("2026-07-13"));
    // Hydratation arrivée jusqu'aux articles manuels (coches distantes lues).
    await waitFor(() => expect(persistance.chargerArticlesManuelsDistants).toHaveBeenCalled());

    // L'utilisateur coche un article PENDANT la lecture des articles manuels.
    storeCoches.ecrire(JSON.stringify({ "agneau|g": 300 }));
    expect(localStorage.getItem("courses_dirty")).toBe("1");

    libererArticles([]);
    await waitFor(
      () =>
        expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(
          "2026-07-13",
          "agneau|g",
          300
        ),
      { timeout: 3000 }
    );
  });
});

describe("changement de cycle : les coches de l'ancien cycle ne fuient pas", () => {
  it("une coche posée avant l'arrivée des coches distantes ne pousse que la nouvelle coche", async () => {
    // Cycle précédent affiché, avec une coche déjà synchronisée.
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-07-06", longueur: 7 }));
    localStorage.setItem("courses_cochees", JSON.stringify({ "lait|l": 1 }));
    let libererCoches!: (v: Record<string, number>) => void;
    persistance.chargerCochesDistantes.mockReturnValue(
      new Promise((r) => {
        libererCoches = r;
      })
    );
    const { useSyncCourses } = await chargerSync();
    const { storeCoches } = await import("@/lib/stockage");
    const { renderHook, waitFor } = await import("@testing-library/react");

    renderHook(() => useSyncCourses("2026-07-13"));
    await waitFor(() => expect(persistance.chargerCochesDistantes).toHaveBeenCalledWith("2026-07-13"));

    // L'ancien blob a été retiré dès le changement d'ancre.
    expect(localStorage.getItem("courses_cochees")).toBeNull();
    // Coche sur le NOUVEAU cycle pendant la lecture des coches distantes.
    storeCoches.ecrire(JSON.stringify({ "pain|piece": 2 }));
    libererCoches({});

    await waitFor(
      () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith("2026-07-13", "pain|piece", 2),
      { timeout: 3000 }
    );
    expect(persistance.cocherArticleDistant).not.toHaveBeenCalledWith("2026-07-13", "lait|l", 1);
  });
});

describe("coche d'un article manuel : clics rapides et échos Realtime", () => {
  // Régression (e2e « cocher puis tout décocher un article manuel ») : chaque
  // clic lançait son UPDATE sans attendre le précédent, et l'écho Realtime de
  // chaque écriture était appliqué tel quel. L'écho d'une écriture dépassée
  // redécochait l'article à l'écran, et deux UPDATE validés dans le désordre
  // laissaient en base l'inverse du dernier geste.
  const ANCRE = "2026-07-13";

  function differe() {
    let resoudre!: () => void;
    let rejeter!: (erreur: Error) => void;
    const promesse = new Promise<void>((r, j) => {
      resoudre = r;
      rejeter = j;
    });
    return { promesse, resoudre, rejeter };
  }

  async function preparer() {
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([
      {
        id: "a1",
        libelle: "Sacs poubelle",
        quantite: null,
        unite: null,
        categorie: "autre",
        fondDePlacard: false,
        coche: false,
      },
    ]);
    const sync = await chargerSync();
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses(ANCRE));
    const { result } = renderHook(() => sync.useArticlesManuels());
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() =>
      expect(realtime.rappels.some((r) => r.filtre.table === "article_manuel")).toBe(true)
    );
    const coche = () => result.current[0].coche;
    const echo = (valeur: boolean) =>
      act(() => {
        const abonnement = realtime.rappels.find((r) => r.filtre.table === "article_manuel")!;
        abonnement.rappel({
          eventType: "UPDATE",
          new: {
            id: "a1",
            foyer_id: "foyer-1",
            ancre: ANCRE,
            libelle: "Sacs poubelle",
            categorie: "autre",
            fond_de_placard: false,
            coche: valeur,
          },
          old: {},
        });
      });
    return { sync, waitFor, act, coche, echo };
  }

  it("l'écho Realtime d'une écriture dépassée ne redécoche pas l'article", async () => {
    persistance.basculerCocheArticleManuelDistant.mockReturnValue(new Promise(() => {}));
    const { sync, act, coche, echo } = await preparer();

    act(() => {
      void sync.basculerCocheArticleManuel("a1"); // coché
      void sync.basculerCocheArticleManuel("a1"); // décoché
      void sync.basculerCocheArticleManuel("a1"); // coché
    });
    echo(false); // écho du 2e clic, arrivé après le 3e

    expect(coche()).toBe(true);
  });

  it("des clics rapides n'envoient qu'une écriture à la fois, et la dernière valeur gagne", async () => {
    const ecritures: ReturnType<typeof differe>[] = [];
    persistance.basculerCocheArticleManuelDistant.mockImplementation(() => {
      const d = differe();
      ecritures.push(d);
      return d.promesse;
    });
    const { sync, waitFor, act, coche } = await preparer();

    act(() => {
      void sync.basculerCocheArticleManuel("a1"); // coché
      void sync.basculerCocheArticleManuel("a1"); // décoché
    });
    expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenCalledTimes(1);
    expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenLastCalledWith("a1", true);

    ecritures[0].resoudre();
    await waitFor(() =>
      expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenCalledTimes(2)
    );
    expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenLastCalledWith("a1", false);
    ecritures[1].resoudre();
    await act(async () => {});
    expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenCalledTimes(2);
    expect(coche()).toBe(false);
  });

  it("« Tout décocher » pendant une coche en vol finit décoché en base", async () => {
    const premiere = differe();
    persistance.basculerCocheArticleManuelDistant
      .mockReturnValueOnce(premiere.promesse)
      .mockResolvedValue(undefined);
    persistance.viderCochesArticlesManuelsDistantes.mockResolvedValue([]);
    const { sync, waitFor, act, coche } = await preparer();

    act(() => {
      void sync.basculerCocheArticleManuel("a1"); // coché, écriture en vol
    });
    await act(async () => {
      await sync.viderCochesArticlesManuels();
    });
    premiere.resoudre(); // l'UPDATE « coché » est validé APRÈS le décochage global

    await waitFor(() =>
      expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenLastCalledWith("a1", false)
    );
    expect(coche()).toBe(false);
  });

  it("une coche posée pendant « Tout décocher » en vol n'est écrite qu'après lui", async () => {
    const vidage = differe();
    persistance.viderCochesArticlesManuelsDistantes.mockReturnValue(vidage.promesse.then(() => []));
    persistance.basculerCocheArticleManuelDistant.mockResolvedValue(undefined);
    const { sync, waitFor, act } = await preparer();

    act(() => {
      void sync.viderCochesArticlesManuels();
      void sync.basculerCocheArticleManuel("a1"); // coché juste après
    });
    expect(persistance.basculerCocheArticleManuelDistant).not.toHaveBeenCalled();

    vidage.resoudre();
    await waitFor(() =>
      expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenCalledWith("a1", true)
    );
  });

  it("échec d'écriture : la coche revient au dernier état confirmé et l'erreur remonte", async () => {
    persistance.basculerCocheArticleManuelDistant.mockRejectedValue(new Error("réseau"));
    const { sync, act, coche } = await preparer();

    let erreur: unknown;
    await act(async () => {
      await sync.basculerCocheArticleManuel("a1").catch((e: unknown) => {
        erreur = e;
      });
    });

    expect(erreur).toBeInstanceOf(Error);
    expect(coche()).toBe(false);
  });
});

describe("articles manuels : lecture du cycle concurrente d'une saisie", () => {
  // Régression (e2e « cocher puis tout décocher un article manuel ») : la
  // lecture des articles manuels lancée par le chargement de /courses pouvait
  // revenir APRÈS un ajout ou une coche de l'utilisateur, et remplaçait tout
  // le store par son instantané périmé : coche effacée, ou article ajouté qui
  // disparaissait. Même schéma que la coche perdue de #339, côté articles.
  const ANCRE = "2026-07-13";
  const SACS = {
    id: "a1",
    libelle: "Sacs poubelle",
    quantite: null,
    unite: null,
    categorie: "autre" as const,
    fondDePlacard: false,
    coche: false,
  };

  async function demarrerLecturePendante() {
    let libererLecture!: (liste: (typeof SACS)[]) => void;
    persistance.chargerArticlesManuelsDistants.mockReturnValueOnce(
      new Promise((r) => {
        libererLecture = r;
      })
    );
    persistance.creerArticleManuelDistant.mockResolvedValue(SACS);
    persistance.basculerCocheArticleManuelDistant.mockReturnValue(new Promise(() => {}));
    const sync = await chargerSync();
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses(ANCRE));
    const { result } = renderHook(() => sync.useArticlesManuels());
    await waitFor(() => expect(persistance.chargerArticlesManuelsDistants).toHaveBeenCalled());
    await act(async () => {
      await sync.ajouterArticleManuel({
        libelle: "Sacs poubelle",
        quantite: null,
        unite: null,
        categorie: "autre",
        fondDePlacard: false,
      });
    });
    return { sync, result, waitFor, act, libererLecture };
  }

  it("une coche posée pendant la lecture n'est pas écrasée par son résultat", async () => {
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([SACS]);
    const { sync, result, waitFor, act, libererLecture } = await demarrerLecturePendante();

    act(() => {
      void sync.basculerCocheArticleManuel("a1"); // coché, écriture en vol
    });
    await act(async () => {
      libererLecture([SACS]); // instantané lu avant la coche
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].coche).toBe(true);
  });

  it("un article ajouté pendant une lecture qui ne le contient pas reste affiché", async () => {
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([SACS]);
    const { result, act, libererLecture } = await demarrerLecturePendante();

    await act(async () => {
      libererLecture([]); // lecture partie avant l'insertion
    });
    await act(async () => {});

    expect(result.current.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("articles manuels : ajout déjà rapporté par la lecture du cycle", () => {
  // Régression : une lecture partie juste après l'insertion rapporte déjà
  // l'article ; `ajouterArticleManuel` l'ajoutait une seconde fois (même id,
  // même clé React) et la case affichée ne suivait plus l'état du store.
  it("n'ajoute pas un second exemplaire d'un article déjà présent", async () => {
    const sacs = {
      id: "a1",
      libelle: "Sacs poubelle",
      quantite: null,
      unite: null,
      categorie: "autre" as const,
      fondDePlacard: false,
      coche: false,
    };
    let libererCreation!: (article: typeof sacs) => void;
    persistance.creerArticleManuelDistant.mockReturnValue(
      new Promise((r) => {
        libererCreation = r;
      })
    );
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([sacs]);
    const sync = await chargerSync();
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses("2026-07-13"));
    const { result } = renderHook(() => sync.useArticlesManuels());
    await waitFor(() => expect(result.current).toHaveLength(1)); // lecture : déjà là

    await act(async () => {
      const ajout = sync.ajouterArticleManuel({
        libelle: "Sacs poubelle",
        quantite: null,
        unite: null,
        categorie: "autre",
        fondDePlacard: false,
      });
      libererCreation(sacs);
      await ajout;
    });

    expect(result.current.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("articles manuels : ordre des échos Realtime (horloge serveur updated_at)", () => {
  // Régression : le temps réel ne garantit pas l'ordre de livraison. L'écho
  // INSERT de la création (coche false) arrivait APRÈS l'écho de la coche, une
  // fois l'écriture terminée, et redécochait l'article. Un écho n'est appliqué
  // que s'il est strictement plus récent que l'état connu.
  const ANCRE = "2026-07-13";
  const T_CREATION = "2026-07-13T10:00:00.000+00:00";
  const T_COCHE = "2026-07-13T10:00:01.000+00:00";
  const T_AUTRE_MEMBRE = "2026-07-13T10:00:05.000+00:00";

  async function preparer() {
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([
      {
        id: "a1",
        libelle: "Sacs poubelle",
        quantite: null,
        unite: null,
        categorie: "autre",
        fondDePlacard: false,
        coche: false,
        majLe: T_CREATION,
      },
    ]);
    const sync = await chargerSync();
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses(ANCRE));
    const { result } = renderHook(() => sync.useArticlesManuels());
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() =>
      expect(realtime.rappels.some((r) => r.filtre.table === "article_manuel")).toBe(true)
    );
    const echo = (eventType: "INSERT" | "UPDATE", coche: boolean, updatedAt: string) =>
      act(() => {
        realtime.rappels
          .find((r) => r.filtre.table === "article_manuel")!
          .rappel({
            eventType,
            new: {
              id: "a1",
              foyer_id: "foyer-1",
              ancre: ANCRE,
              libelle: "Sacs poubelle",
              categorie: "autre",
              fond_de_placard: false,
              coche,
              updated_at: updatedAt,
            },
            old: {},
          });
      });
    return { sync, result, act, echo };
  }

  it("l'écho INSERT tardif de la création ne redécoche pas un article coché depuis", async () => {
    persistance.basculerCocheArticleManuelDistant.mockResolvedValue(T_COCHE);
    const { sync, result, act, echo } = await preparer();

    await act(async () => {
      await sync.basculerCocheArticleManuel("a1"); // écriture terminée
    });
    echo("INSERT", false, T_CREATION); // livré après coup

    expect(result.current[0].coche).toBe(true);
  });

  it("l'écho d'une coche antérieure ne contredit pas « Tout décocher »", async () => {
    persistance.basculerCocheArticleManuelDistant.mockResolvedValue(T_COCHE);
    persistance.viderCochesArticlesManuelsDistantes.mockResolvedValue([
      { id: "a1", majLe: "2026-07-13T10:00:02.000+00:00" },
    ]);
    const { sync, result, act, echo } = await preparer();

    await act(async () => {
      await sync.basculerCocheArticleManuel("a1");
      await sync.viderCochesArticlesManuels();
    });
    echo("UPDATE", true, T_COCHE); // écho de la coche, livré après le décochage

    expect(result.current[0].coche).toBe(false);
  });

  it("un changement plus récent d'un autre membre est appliqué", async () => {
    const { result, echo } = await preparer();

    echo("UPDATE", true, T_AUTRE_MEMBRE);

    expect(result.current[0].coche).toBe(true);
  });
});
