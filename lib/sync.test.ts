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

  it("semaine voulue (lien /planning?semaine=, #336) → hydrate CETTE semaine, pas la défaut", async () => {
    const { hydrater } = await chargerSync();
    const { semaineDecalee, semaineParDefaut } = await import("@/lib/semaines");
    const voulue = semaineDecalee(semaineParDefaut(), -1);
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: planning(voulue),
      updatedAt: "2026-06-15T10:00:00.000Z",
    });

    await hydrater(voulue);

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledWith(voulue);
    expect(localStorage.getItem("semaine_affichee")).toBe(voulue);
  });

  it("déjà hydraté + semaine voulue → navigue vers elle (nav SPA depuis /ce-soir)", async () => {
    const { hydrater } = await chargerSync();
    const { semaineDecalee, semaineParDefaut } = await import("@/lib/semaines");
    await hydrater();
    const voulue = semaineDecalee(semaineParDefaut(), -1);

    await hydrater(voulue);

    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(voulue));
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

// Alerte US-21 (#352) : l'écho Realtime de NOTRE écriture peut arriver AVANT la
// réponse HTTP de la RPC, donc avant que `planning_courant_maj` ne porte son
// `updated_at`. Il ne doit alors ni relire la base (ce qui écraserait les
// éditions faites pendant l'écriture) ni déclencher l'alerte ; un vrai
// changement distant reçu pendant l'écriture reste traité, à sa fin.
describe("alerte US-21 : écho reçu pendant une écriture en vol (#352)", () => {
  const T1 = "2026-06-15T10:00:01.000Z";
  const T2 = "2026-06-15T10:00:02.000Z";
  const T_DISTANT = "2026-06-15T10:05:00.000Z";

  function rappelPlanning(): RappelRealtime | undefined {
    return realtime.rappels.find((r) => r.filtre.table === "planning");
  }
  function evenement(semaine: string, majISO: string): void {
    rappelPlanning()!.rappel({
      eventType: "UPDATE",
      new: { foyer_id: "foyer-1", semaine, updated_at: majISO },
      old: {},
    });
  }
  function avecPersonnes(semaine: string, diner: number): Planning {
    return {
      semaine,
      jours: [{ jour: "lundi", diner: recette("r1"), personnes: { diner } }],
    };
  }
  function differe<T>(): { promesse: Promise<T>; resoudre: (v: T) => void } {
    let resoudre!: (v: T) => void;
    const promesse = new Promise<T>((r) => (resoudre = r));
    return { promesse, resoudre };
  }
  // Monte /planning (useSync + alerte) sur la semaine par défaut.
  async function monterPlanning() {
    const sync = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const { storePlanning } = await import("@/lib/stockage");
    const { renderHook } = await import("@testing-library/react");
    const semaine = semaineParDefaut();
    const vue = renderHook(() => sync.useSync());
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));
    await vi.waitFor(() => expect(rappelPlanning()).toBeDefined());
    return { sync, semaine, alerte, storePlanning, vue };
  }
  // Semaine affichée en cache, horodatée (hors hydratation pour garder les tests courts).
  function poserSemaineAffichee(semaine: string, jours: JourPlanning[], maj: string): void {
    localStorage.setItem("planning_courant", JSON.stringify({ semaine, jours }));
    localStorage.setItem("planning_courant_maj", maj);
  }
  function joursLocaux(): JourPlanning[] {
    return (JSON.parse(localStorage.getItem("planning_courant")!) as Planning).jours;
  }
  function canauxPlanning(): number {
    return realtime.rappels.filter((r) => r.filtre.table === "planning").length;
  }

  it("push en vol : l'écho de ce push ne relit pas la base, les éditions faites pendant le push sont gardées", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(1); // hydratation
    const push1 = differe<string>();
    const push2 = differe<string>();
    persistance.sauvegarderPlanningDistant
      .mockImplementationOnce(() => push1.promesse)
      .mockImplementationOnce(() => push2.promesse);
    // La base, relue, rendrait l'état du 1er push (1 personne).
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: avecPersonnes(semaine, 1),
      updatedAt: T1,
    });

    storePlanning.ecrire(JSON.stringify(avecPersonnes(semaine, 1)));
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    // Clic du stepper pendant le push, puis écho du 1er push avant sa réponse.
    storePlanning.ecrire(JSON.stringify(avecPersonnes(semaine, 3)));
    evenement(semaine, T1);
    await new Promise((r) => setTimeout(r, 50));

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(1); // pas de relecture
    expect(alerte.result.current).toBe(false);
    expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].personnes.diner).toBe(3);

    push1.resoudre(T1);
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalledTimes(2));
    evenement(semaine, T2); // écho du 2e push, encore avant sa réponse
    push2.resoudre(T2);
    await vi.waitFor(() => expect(localStorage.getItem("planning_dirty")).toBeNull());
    await new Promise((r) => setTimeout(r, 50));

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(1);
    expect(alerte.result.current).toBe(false);
    expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].personnes.diner).toBe(3);
  });

  it("push en vol : un changement distant plus récent que le push est traité à sa fin (alerte)", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const push = differe<string>();
    persistance.sauvegarderPlanningDistant.mockImplementationOnce(() => push.promesse);
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine, jours: [{ jour: "lundi", diner: recette("autre-membre") }] },
      updatedAt: T_DISTANT,
    });

    storePlanning.ecrire(JSON.stringify(avecPersonnes(semaine, 1)));
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    evenement(semaine, T_DISTANT);
    push.resoudre(T1);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].diner.id).toBe("autre-membre");
  });

  it("modifierSlotDistant en vol (vue Cycle) : son écho ne relit pas la base ni n'alerte (jumeau)", async () => {
    const { sync, semaine, alerte } = await monterPlanning();
    // Semaine affichée chargée en cache (hors hydratation pour garder le test court).
    localStorage.setItem(
      "planning_courant",
      JSON.stringify({ semaine, jours: [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })] })
    );
    localStorage.setItem("planning_courant_maj", "2026-06-15T09:00:00.000Z");
    const ecriture = differe<string>();
    persistance.sauvegarderSlotsDistant.mockImplementationOnce(() => ecriture.promesse);
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine, jours: [jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" })] },
      updatedAt: T1,
    });
    const appels = persistance.chargerPlanningDistant.mock.calls.length;

    const enCours = sync.modifierSlotDistant(
      semaine,
      jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" })
    );
    evenement(semaine, T1); // écho avant la réponse de sauvegarder_slots
    await new Promise((r) => setTimeout(r, 50));
    ecriture.resoudre(T1);
    await enCours;
    await new Promise((r) => setTimeout(r, 50));

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels);
    expect(alerte.result.current).toBe(false);
    expect(JSON.parse(localStorage.getItem("planning_courant")!).jours[0].diner.id).toBe("nouveau");
  });

  // S1 : un autre membre modifie un AUTRE slot et son commit passe juste avant
  // le nôtre (T_autre < T_nous). Son event n'est pas un écho : il doit être relu,
  // sinon le cache local reste sans son slot et la prochaine édition en vue
  // Semaine (sauvegarder_planning, toute la semaine) l'écrase en base.
  it("écriture en vol : l'event d'un autre membre plus ancien que notre écriture est relu (alerte)", async () => {
    const { sync, semaine, alerte } = await monterPlanning();
    poserSemaineAffichee(
      semaine,
      [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })],
      "2026-06-15T09:00:00.000Z"
    );
    const T_AUTRE = "2026-06-15T10:00:01.000100+00:00";
    const T_NOUS = "2026-06-15T10:00:01.000200+00:00";
    const ecriture = differe<string>();
    persistance.sauvegarderSlotsDistant.mockImplementationOnce(() => ecriture.promesse);
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: {
        semaine,
        jours: [
          jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }),
          jourPlanningSimple("mardi", { id: "autre-membre", nom: "Autre" }),
        ],
      },
      updatedAt: T_NOUS,
    });
    const appels = persistance.chargerPlanningDistant.mock.calls.length;

    const enCours = sync.modifierSlotDistant(
      semaine,
      jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" })
    );
    evenement(semaine, T_AUTRE); // l'autre membre, commit juste avant le nôtre
    evenement(semaine, T_NOUS); // notre écho, avant la réponse de sauvegarder_slots
    ecriture.resoudre(T_NOUS);
    await enCours;

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 1);
    expect(joursLocaux().map((jp) => jp.diner?.id)).toEqual(["nouveau", "autre-membre"]);
  });

  it("hors écriture : un event plus ancien que planning_courant_maj mais pas de nous est relu", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const T_NOUS = "2026-06-15T10:00:02.000000+00:00";
    const T_AUTRE = "2026-06-15T10:00:01.500000+00:00";
    persistance.sauvegarderPlanningDistant.mockResolvedValueOnce(T_NOUS);
    storePlanning.ecrire(JSON.stringify(avecPersonnes(semaine, 3)));
    await vi.waitFor(() => expect(localStorage.getItem("planning_dirty")).toBeNull(), {
      timeout: 2000,
    });
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine, jours: [{ jour: "lundi", diner: recette("autre-membre") }] },
      updatedAt: T_NOUS,
    });

    evenement(semaine, T_NOUS); // écho tardif de notre push : ignoré
    await new Promise((r) => setTimeout(r, 30));
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels);

    evenement(semaine, T_AUTRE); // autre membre, livré après notre réponse
    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 1);
  });

  it("anti-écho à la microseconde : même milliseconde que notre écriture mais autre horodatage → relu", async () => {
    const { sync, semaine, alerte } = await monterPlanning();
    poserSemaineAffichee(
      semaine,
      [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })],
      "2026-06-15T09:00:00.000Z"
    );
    // Postgres tronque les zéros finaux : « .94056 » = 940 560 µs.
    persistance.sauvegarderSlotsDistant.mockResolvedValueOnce("2026-06-15T10:00:01.94056+00:00");
    await sync.modifierSlotDistant(semaine, jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }));
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: {
        semaine,
        jours: [
          jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" }),
          jourPlanningSimple("mardi", { id: "autre-membre", nom: "Autre" }),
        ],
      },
      updatedAt: "2026-06-15T10:00:01.940562+00:00",
    });

    evenement(semaine, "2026-06-15T10:00:01.940560+00:00"); // notre écho, autre écriture
    await new Promise((r) => setTimeout(r, 30));
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels);

    evenement(semaine, "2026-06-15T10:00:01.940562+00:00"); // autre membre, même ms
    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
  });

  // S2 : l'event différé ne doit pas être jugé après le démontage de /planning
  // (relecture inutile ET réabonnement d'un canal que useSync vient de couper).
  it("event différé puis démontage pendant l'écriture : ni relecture ni canal rouvert", async () => {
    const { sync, semaine, alerte, vue } = await monterPlanning();
    poserSemaineAffichee(
      semaine,
      [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })],
      "2026-06-15T09:00:00.000Z"
    );
    const ecriture = differe<string>();
    persistance.sauvegarderSlotsDistant.mockImplementationOnce(() => ecriture.promesse);
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    const canaux = canauxPlanning();

    const enCours = sync.modifierSlotDistant(
      semaine,
      jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" })
    );
    evenement(semaine, T_DISTANT); // un autre membre, pendant l'écriture
    vue.unmount(); // départ de /planning
    ecriture.resoudre(T1);
    await enCours;
    await new Promise((r) => setTimeout(r, 50));

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels);
    expect(canauxPlanning()).toBe(canaux);
    expect(alerte.result.current).toBe(false);
  });

  // S2, changement de semaine : l'event différé d'une semaine quittée n'est
  // jamais jugé (ni relecture de cette semaine, ni canal rouvert pour elle).
  function canauxDe(semaine: string): number {
    return realtime.rappels.filter(
      (r) => (r.filtre as { filter?: string }).filter === `semaine=eq.${semaine}`
    ).length;
  }
  async function ecritureEnVolAvecEventDistant(sync: Awaited<ReturnType<typeof chargerSync>>, semaine: string) {
    poserSemaineAffichee(
      semaine,
      [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })],
      "2026-06-15T09:00:00.000Z"
    );
    // Chaque semaine relue a un planning : `semaineActive()` n'est jamais null,
    // la garde de traiterChangementPlanningDistant ne masque donc rien.
    persistance.chargerPlanningDistant.mockImplementation(async (s: string) => ({
      planning: planning(s),
      updatedAt: "2026-06-15T09:30:00.000Z",
    }));
    const ecriture = differe<string>();
    persistance.sauvegarderSlotsDistant.mockImplementationOnce(() => ecriture.promesse);
    const enCours = sync.modifierSlotDistant(
      semaine,
      jourPlanningSimple("lundi", { id: "nouveau", nom: "Nouveau" })
    );
    evenement(semaine, T_DISTANT); // un autre membre, pendant l'écriture
    return { ecriture, enCours };
  }

  it("event différé puis navigation vers une autre semaine pendant l'écriture : ni relecture ni canal pour la semaine quittée", async () => {
    const { sync, semaine: A, alerte } = await monterPlanning();
    const { semaineDecalee } = await import("@/lib/semaines");
    const B = semaineDecalee(A, 1);
    const { ecriture, enCours } = await ecritureEnVolAvecEventDistant(sync, A);
    const canauxA = canauxDe(A);

    await sync.naviguerVers(B);
    await vi.waitFor(() => expect(canauxDe(B)).toBe(1));
    const lecturesA = () =>
      persistance.chargerPlanningDistant.mock.calls.filter(([s]) => s === A).length;
    const lecturesAAvant = lecturesA();
    ecriture.resoudre(T1);
    await enCours;
    await new Promise((r) => setTimeout(r, 50));

    expect(lecturesA()).toBe(lecturesAAvant);
    expect(canauxDe(A)).toBe(canauxA);
    expect(alerte.result.current).toBe(false);
  });

  it("aller-retour A → B → A pendant l'écriture : l'event différé de la première visite de A n'est pas rejugé", async () => {
    const { sync, semaine: A, alerte } = await monterPlanning();
    const { semaineDecalee } = await import("@/lib/semaines");
    const B = semaineDecalee(A, 1);
    const { ecriture, enCours } = await ecritureEnVolAvecEventDistant(sync, A);

    await sync.naviguerVers(B);
    await sync.naviguerVers(A); // relit A : l'event différé est déjà pris en compte
    const lectures = persistance.chargerPlanningDistant.mock.calls.length;
    ecriture.resoudre(T1);
    await enCours;
    await new Promise((r) => setTimeout(r, 50));

    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures);
    expect(alerte.result.current).toBe(false);
  });

  // S3 : la régénération du cycle (sauvegarder_cycle) est un troisième écrivain
  // de la semaine abonnée (vue Cycle de /planning) : son écho n'alerte pas et le
  // cache de la semaine affichée reçoit les jours générés.
  it("régénération du cycle touchant la semaine abonnée : ni alerte ni relecture, cache à jour", async () => {
    const { sync, semaine, alerte } = await monterPlanning();
    // Cycle affiché hors de la semaine abonnée : ses lectures de re-projection
    // ne se confondent pas avec une relecture US-21 de la semaine.
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-07-13", longueur: 7 }));
    poserSemaineAffichee(
      semaine,
      [jourPlanningSimple("lundi", { id: "vieux", nom: "Vieux" })],
      "2026-06-15T09:00:00.000Z"
    );
    const ecriture = differe<Record<string, string>>();
    persistance.sauvegarderCycleDistant.mockImplementationOnce(() => ecriture.promesse);
    const appelsAvant = persistance.chargerPlanningDistant.mock.calls.length;

    const enCours = sync.appliquerGenerationCycle("2026-07-13", [
      { semaine, jours: [jourPlanningSimple("mardi", { id: "genere", nom: "Généré" })] },
    ]);
    // La RPC part après le vidage des envois (#355) : son écho ne peut précéder son envoi.
    await vi.waitFor(() => expect(persistance.sauvegarderCycleDistant).toHaveBeenCalled());
    evenement(semaine, T1); // écho avant la réponse de sauvegarder_cycle
    ecriture.resoudre({ [semaine]: T1 });
    await enCours;
    evenement(semaine, T1); // écho tardif
    await new Promise((r) => setTimeout(r, 50));

    expect(alerte.result.current).toBe(false);
    // Seules les lectures de la re-projection du cycle (aucune relecture US-21).
    const relectures = persistance.chargerPlanningDistant.mock.calls
      .slice(appelsAvant)
      .filter(([s]) => s === semaine);
    expect(relectures).toHaveLength(0);
    expect(joursLocaux().map((jp) => [jp.jour, jp.diner?.id])).toEqual([
      ["lundi", "vieux"],
      ["mardi", "genere"],
    ]);
    expect(localStorage.getItem("planning_courant_maj")).toBe(T1);
    expect(localStorage.getItem("planning_dirty")).toBeNull();
  });
});

// Jumeau côté cycle (/courses, #259) : même règle d'écho exacte.
describe("alerte US-21 côté cycle : écho exact (#352)", () => {
  it("un event d'un autre membre plus ancien que la dernière lecture du cycle est re-projeté (alerte)", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine: "2026-W29", jours: [jourPlanningSimple("lundi", { id: "r1", nom: "R1" })] },
      updatedAt: "2026-07-13T10:00:02.000000+00:00",
    });
    renderHook(() => sync.useSyncCourses("2026-07-13"));
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() =>
      expect(realtime.rappels.find((r) => r.filtre.table === "planning")).toBeDefined()
    );
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: {
        semaine: "2026-W29",
        jours: [
          jourPlanningSimple("lundi", { id: "r1", nom: "R1" }),
          jourPlanningSimple("mardi", { id: "autre-membre", nom: "Autre" }),
        ],
      },
      updatedAt: "2026-07-13T10:00:02.000000+00:00",
    });

    realtime.rappels
      .find((r) => r.filtre.table === "planning")!
      .rappel({
        eventType: "UPDATE",
        new: { semaine: "2026-W29", updated_at: "2026-07-13T10:00:01.000000+00:00" },
        old: {},
      });

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(persistance.chargerPlanningDistant.mock.calls.length).toBeGreaterThan(appels);
  });

  it("génération en vol : notre écho est ignoré, l'event d'un autre membre est jugé à la fin (alerte)", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine: "2026-W29", jours: [jourPlanningSimple("lundi", { id: "r1", nom: "R1" })] },
      updatedAt: "2026-07-13T09:00:00.000000+00:00",
    });
    renderHook(() => sync.useSyncCourses("2026-07-13"));
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() =>
      expect(realtime.rappels.find((r) => r.filtre.table === "planning")).toBeDefined()
    );
    const event = (maj: string) =>
      realtime.rappels
        .find((r) => r.filtre.table === "planning")!
        .rappel({ eventType: "UPDATE", new: { semaine: "2026-W29", updated_at: maj }, old: {} });
    const T_NOUS = "2026-07-13T10:00:02.000000+00:00";
    const T_AUTRE = "2026-07-13T10:00:03.000000+00:00";
    const ecriture = {} as { resoudre: (v: Record<string, string>) => void };
    persistance.sauvegarderCycleDistant.mockImplementationOnce(
      () => new Promise((r) => (ecriture.resoudre = r))
    );
    // Re-projection de rafraichirCycleGenere : la base juste après notre RPC ;
    // relecture suivante : la base porte aussi le slot de l'autre membre.
    persistance.chargerPlanningDistant
      .mockResolvedValueOnce({
        planning: { semaine: "2026-W29", jours: [jourPlanningSimple("mardi", { id: "genere", nom: "G" })] },
        updatedAt: T_NOUS,
      })
      .mockResolvedValue({
        planning: {
          semaine: "2026-W29",
          jours: [
            jourPlanningSimple("lundi", { id: "autre-membre", nom: "A" }),
            jourPlanningSimple("mardi", { id: "genere", nom: "G" }),
          ],
        },
        updatedAt: T_AUTRE,
      });

    const enCours = sync.appliquerGenerationCycle("2026-07-13", [
      { semaine: "2026-W29", jours: [jourPlanningSimple("mardi", { id: "genere", nom: "G" })] },
    ]);
    // La RPC part après le vidage des envois (#355) : son écho ne peut précéder son envoi.
    await vi.waitFor(() => expect(persistance.sauvegarderCycleDistant).toHaveBeenCalled());
    event(T_NOUS); // notre écho, avant la réponse
    event(T_AUTRE); // un autre membre écrit pendant la génération
    await new Promise((r) => setTimeout(r, 30));
    expect(alerte.result.current).toBe(false); // rien de jugé pendant la fenêtre
    ecriture.resoudre({ "2026-W29": T_NOUS });
    await enCours;

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
  });
});

// Jumeau de la vue Cycle (#352, revue) : /courses retombe aussi sur lundi quand
// le jour de courses est illisible, et le repli est loggé (CLAUDE.md : toute
// erreur capturée est loggée), via le même `jourCoursesOuLundi`.
describe("hydraterCycle : jour de courses illisible", () => {
  it("retombe sur lundi en loggant le repli", async () => {
    vi.doMock("@/lib/foyer", () => ({
      chargerJourCoursesFoyer: () => Promise.reject(new Error("réseau")),
    }));
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { hydraterCycle } = await chargerSync();
      const { ancreParDefaut } = await import("@/lib/cycles");

      await hydraterCycle();

      expect(avertissement).toHaveBeenCalledWith(
        "Jour de courses illisible, lundi par défaut.",
        expect.any(Error)
      );
      expect(JSON.parse(localStorage.getItem("cycle_affiche")!).ancre).toBe(
        ancreParDefaut(new Date(), 1)
      );
    } finally {
      avertissement.mockRestore();
      vi.doUnmock("@/lib/foyer");
    }
  });
});

// #355 : une relecture US-21 (changement d'un autre membre) alors que des
// éditions locales ne sont pas encore poussées les rejoue sur les créneaux que
// le distant n'a pas touchés ; sur un même créneau, le distant gagne. Base de
// comparaison : l'instantané persistant `planning_confirme` (dernier planning
// connu du serveur pour la semaine affichée).
describe("relecture US-21 : rejeu des éditions locales en attente (#355)", () => {
  const T0 = "2026-06-15T09:00:00.000Z";
  const T_DISTANT = "2026-06-15T10:05:00.000Z";
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

  /** Semaine complète (7 jours) : déjeuner `d-<jour>`, dîner `s-<jour>`. */
  function semaineComplete(semaine: string): Planning {
    return {
      semaine,
      jours: JOURS.map((jour) => ({
        jour,
        dejeuner: recette(`d-${jour}`),
        diner: recette(`s-${jour}`),
      })),
    };
  }
  function avecJour(
    p: Planning,
    jour: string,
    f: (jp: JourPlanning) => JourPlanning
  ): Planning {
    return { ...p, jours: p.jours.map((jp) => (jp.jour === jour ? f(jp) : jp)) };
  }
  function rappelPlanning(): RappelRealtime | undefined {
    return realtime.rappels.find((r) => r.filtre.table === "planning");
  }
  function evenement(semaine: string, majISO: string): void {
    rappelPlanning()!.rappel({
      eventType: "UPDATE",
      new: { foyer_id: "foyer-1", semaine, updated_at: majISO },
      old: {},
    });
  }
  function cache(): Planning {
    return JSON.parse(localStorage.getItem("planning_courant")!) as Planning;
  }
  function confirme(): Planning {
    return JSON.parse(localStorage.getItem("planning_confirme")!) as Planning;
  }
  function jourDe(p: Planning, jour: string): JourPlanning {
    return p.jours.find((jp) => jp.jour === jour)!;
  }
  // Monte /planning hydraté depuis la base sur une semaine complète.
  async function monterPlanning() {
    const sync = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const { storePlanning } = await import("@/lib/stockage");
    const { renderHook } = await import("@testing-library/react");
    const semaine = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: semaineComplete(semaine),
      updatedAt: T0,
    });
    const vue = renderHook(() => sync.useSync());
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));
    await vi.waitFor(() => expect(rappelPlanning()).toBeDefined());
    return { sync, semaine, alerte, storePlanning, vue };
  }
  // Stepper lundi dîner → `personnes`, pas encore poussé (débounce 800 ms).
  function stepperLundiDiner(
    storePlanning: { ecrire: (v: string) => void },
    semaine: string,
    personnes: number
  ): void {
    storePlanning.ecrire(
      JSON.stringify(
        avecJour(semaineComplete(semaine), "lundi", (jp) => ({ ...jp, personnes: { diner: personnes } }))
      )
    );
  }

  it("le pull non-dirty pose l'instantané confirmé de la semaine", async () => {
    const { semaine } = await monterPlanning();
    expect(confirme()).toEqual(semaineComplete(semaine));
  });

  it("stepper local + autre créneau modifié à distance → les deux, dirty, push, alerte", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT); // un autre membre modifie mardi déjeuner

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi").personnes?.diner).toBe(4);
    expect(jourDe(cache(), "mardi").dejeuner?.id).toBe("autre-membre");
    expect(localStorage.getItem("planning_dirty")).toBe("1");
    expect(localStorage.getItem("planning_courant_maj")).toBe(T_DISTANT);
    // L'instantané confirmé est le DISTANT (pas la fusion) jusqu'au push.
    expect(confirme()).toEqual(distant);

    // Le push rejoue la fusion : les deux créneaux partent en base.
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    const pousse = persistance.sauvegarderPlanningDistant.mock.calls.at(-1)![0] as Planning;
    expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
    await vi.waitFor(() => expect(localStorage.getItem("planning_dirty")).toBeNull());
    // Push réussi : l'instantané confirmé devient le planning poussé.
    expect(confirme()).toEqual(pousse);
  });

  it("même créneau modifié des deux côtés → le distant gagne, alerte, aucun push", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "lundi", (jp) => ({
      ...jp,
      personnes: { diner: 6 },
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi").personnes?.diner).toBe(6);
    expect(localStorage.getItem("planning_dirty")).toBeNull();
    await new Promise((r) => setTimeout(r, 1000)); // au-delà du débounce
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  it("sans édition locale : relecture, distant affiché, alerte, instantané à jour, aucun push", async () => {
    const { semaine, alerte } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(cache()).toEqual(distant);
    expect(confirme()).toEqual(distant);
    expect(localStorage.getItem("planning_dirty")).toBeNull();
    await new Promise((r) => setTimeout(r, 1000));
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  it("instantané d'une autre semaine : pas de rejeu, le distant fait foi (chemin actuel)", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    localStorage.setItem("planning_confirme", JSON.stringify(semaineComplete("2020-W01")));
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(cache()).toEqual(distant);
    expect(localStorage.getItem("planning_dirty")).toBeNull();
  });

  it("planning local incomplet : pas de rejeu, le distant fait foi (chemin actuel)", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    storePlanning.ecrire(
      JSON.stringify({
        semaine,
        jours: [{ jour: "lundi", diner: recette("s-lundi"), personnes: { diner: 4 } }],
      })
    );
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(cache()).toEqual(distant);
    expect(localStorage.getItem("planning_dirty")).toBeNull();
  });

  it("édition faite pendant la relecture : rejouée aussi, aucun push pendant la lecture", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    let resoudre!: (v: { planning: Planning; updatedAt: string }) => void;
    persistance.chargerPlanningDistant.mockImplementationOnce(
      () => new Promise((r) => (resoudre = r))
    );

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT);
    await new Promise((r) => setTimeout(r, 20));
    stepperLundiDiner(storePlanning, semaine, 5); // clic pendant la lecture
    await new Promise((r) => setTimeout(r, 1000)); // lecture lente, au-delà du débounce
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
    resoudre({ planning: distant, updatedAt: T_DISTANT });

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi").personnes?.diner).toBe(5);
    expect(jourDe(cache(), "mardi").dejeuner?.id).toBe("autre-membre");
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    const pousse = persistance.sauvegarderPlanningDistant.mock.calls.at(-1)![0] as Planning;
    expect(jourDe(pousse, "lundi").personnes?.diner).toBe(5);
    expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
  });

  // Revue #355 : pousser le local après une lecture ratée effacerait en base
  // (toute la semaine) le changement de l'autre membre. Le push attend une
  // relecture réussie, relancée au prochain déclencheur de push.
  it("échec de la relecture : rien n'est poussé avant une relecture réussie, puis la fusion part", async () => {
    const { sync, semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockRejectedValueOnce(new Error("réseau"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stepperLundiDiner(storePlanning, semaine, 4);
      evenement(semaine, T_DISTANT);
      await vi.waitFor(() => expect(erreur).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 1000)); // au-delà du débounce
      expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
      expect(localStorage.getItem("planning_dirty")).toBe("1");
      expect(jourDe(cache(), "lundi").personnes?.diner).toBe(4);

      // Prochain déclencheur de push (remontage SPA de /planning, comme le
      // retour en ligne) : relecture (réussie) d'abord, puis push de la fusion.
      // Pas d'event `online` : les modules des tests précédents, encore montés,
      // l'écouteraient aussi.
      persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });
      void sync.hydrater();

      await vi.waitFor(() => expect(alerte.result.current).toBe(true));
      await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
        timeout: 2000,
      });
      const pousse = persistance.sauvegarderPlanningDistant.mock.calls.at(-1)![0] as Planning;
      expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
      expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
    } finally {
      erreur.mockRestore();
    }
  });

  it("aucun push ne part pendant la lecture, même déclenché directement (remontage SPA)", async () => {
    const { sync, semaine, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    let resoudre!: (v: { planning: Planning; updatedAt: string }) => void;
    persistance.chargerPlanningDistant.mockImplementationOnce(
      () => new Promise((r) => (resoudre = r))
    );

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT);
    await new Promise((r) => setTimeout(r, 20));
    void sync.hydrater(); // remontage SPA : pousser() appelé sans minuteur
    await new Promise((r) => setTimeout(r, 50));
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
    resoudre({ planning: distant, updatedAt: T_DISTANT });

    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    const pousse = persistance.sauvegarderPlanningDistant.mock.calls[0][0] as Planning;
    expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
  });

  it("deux events pendant une lecture lente : relecture finale, le push contient les trois créneaux", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const d1 = avecJour(semaineComplete(semaine), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    const d2 = avecJour(d1, "mercredi", (jp) => ({ ...jp, diner: recette("autre-membre-2") }));
    let resoudre!: (v: { planning: Planning; updatedAt: string }) => void;
    persistance.chargerPlanningDistant
      .mockImplementationOnce(() => new Promise((r) => (resoudre = r)))
      .mockResolvedValue({ planning: d2, updatedAt: "2026-06-15T10:06:00.000Z" });

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT); // B1 : lecture lente
    await new Promise((r) => setTimeout(r, 20));
    evenement(semaine, "2026-06-15T10:06:00.000Z"); // B2, écrit après la lecture de A
    resoudre({ planning: d1, updatedAt: T_DISTANT });

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalledTimes(1);
    const pousse = persistance.sauvegarderPlanningDistant.mock.calls[0][0] as Planning;
    expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
    expect(jourDe(pousse, "mercredi").diner?.id).toBe("autre-membre-2");
  });

  it("semaine supprimée à distance avec une édition en attente : chemin historique (cache vidé)", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    persistance.chargerPlanningDistant.mockResolvedValue(null);

    stepperLundiDiner(storePlanning, semaine, 4);
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(localStorage.getItem("planning_courant")).toBeNull());
    // Comportement historique : semaine vide → état vide, sans alerte
    // (`semaineActive()` devient null avec le cache).
    expect(alerte.result.current).toBe(false);
    expect(localStorage.getItem("planning_confirme")).toBeNull();
    expect(localStorage.getItem("planning_dirty")).toBeNull();
    await new Promise((r) => setTimeout(r, 1000));
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  it("modifierSlotDistant sur la semaine affichée met aussi l'instantané confirmé à jour (jumeau)", async () => {
    const { sync, semaine } = await monterPlanning();
    const jour: JourPlanning = { jour: "mercredi", diner: recette("cycle") };

    await sync.modifierSlotDistant(semaine, jour);

    expect(jourDe(confirme(), "mercredi")).toEqual(jour);
    expect(confirme()).toEqual(cache());
  });

  it("appliquerGenerationCycle sur la semaine affichée met aussi l'instantané confirmé à jour (jumeau)", async () => {
    const { sync, semaine } = await monterPlanning();
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-07-13", longueur: 7 }));
    persistance.sauvegarderCycleDistant.mockResolvedValueOnce({ [semaine]: T_DISTANT });

    await sync.appliquerGenerationCycle("2026-07-13", [
      { semaine, jours: [{ jour: "jeudi", diner: recette("genere") }] },
    ]);

    expect(jourDe(confirme(), "jeudi").diner?.id).toBe("genere");
    expect(jourDe(confirme(), "jeudi").dejeuner?.id).toBe("d-jeudi");
    expect(confirme()).toEqual(cache());
  });

  it("reinitialiserCacheFoyer efface l'instantané confirmé", async () => {
    const sync = await chargerSync();
    localStorage.setItem("planning_confirme", JSON.stringify(semaineComplete("2026-W45")));
    sync.reinitialiserCacheFoyer();
    expect(localStorage.getItem("planning_confirme")).toBeNull();
  });
});

// Gardes ciblées de la synchro temps réel (#355, Task 3) : rejeu d'un event
// reçu pendant une re-projection du cycle (jumeau de `relecturePlanningDemandee`),
// abonnement planning borné au montage de /planning, envois vidés avant une
// régénération du cycle, et relecture US-21 ratée qui survit à un rechargement
// et se retente seule.
describe("gardes ciblées de la synchro temps réel (#355)", () => {
  const T0 = "2026-06-15T09:00:00.000Z";
  const T_DISTANT = "2026-06-15T10:05:00.000Z";
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

  function semaineComplete(semaine: string): Planning {
    return {
      semaine,
      jours: JOURS.map((jour) => ({ jour, dejeuner: recette(`d-${jour}`), diner: recette(`s-${jour}`) })),
    };
  }
  function avecJour(p: Planning, jour: string, f: (jp: JourPlanning) => JourPlanning): Planning {
    return { ...p, jours: p.jours.map((jp) => (jp.jour === jour ? f(jp) : jp)) };
  }
  function jourDe(p: Planning, jour: string): JourPlanning {
    return p.jours.find((jp) => jp.jour === jour)!;
  }
  function differe<T>(): { promesse: Promise<T>; resoudre: (v: T) => void } {
    let resoudre!: (v: T) => void;
    const promesse = new Promise<T>((r) => (resoudre = r));
    return { promesse, resoudre };
  }
  function rappelsPlanning(): RappelRealtime[] {
    return realtime.rappels.filter((r) => r.filtre.table === "planning");
  }
  function evenementSur(rappel: RappelRealtime, semaine: string, majISO: string): void {
    rappel.rappel({
      eventType: "UPDATE",
      new: { foyer_id: "foyer-1", semaine, updated_at: majISO },
      old: {},
    });
  }
  const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // --- 1. Rejeu côté cycle (jumeau de la relecture finale côté planning) ---
  it("côté cycle : un event reçu pendant une re-projection en déclenche UNE seconde, même en rafale", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    const lundi = jourPlanningSimple("lundi", { id: "r1", nom: "R1" });
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine: "2026-W29", jours: [lundi] },
      updatedAt: "2026-07-13T09:00:00.000000+00:00",
    });
    renderHook(() => sync.useSyncCourses("2026-07-13"));
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() => expect(rappelsPlanning()).toHaveLength(1));
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    const lecture = differe<{ planning: Planning; updatedAt: string }>();
    persistance.chargerPlanningDistant
      .mockImplementationOnce(() => lecture.promesse)
      .mockResolvedValue({
        planning: {
          semaine: "2026-W29",
          jours: [lundi, jourPlanningSimple("mardi", { id: "autre-membre-2", nom: "A2" })],
        },
        updatedAt: "2026-07-13T10:00:03.000000+00:00",
      });

    const canal = rappelsPlanning()[0];
    evenementSur(canal, "2026-W29", "2026-07-13T10:00:01.000000+00:00"); // re-projection lente
    await attendre(20);
    evenementSur(canal, "2026-W29", "2026-07-13T10:00:02.000000+00:00"); // rafale pendant
    evenementSur(canal, "2026-W29", "2026-07-13T10:00:03.000000+00:00");
    lecture.resoudre({
      planning: {
        semaine: "2026-W29",
        jours: [lundi, jourPlanningSimple("mardi", { id: "autre-membre-1", nom: "A1" })],
      },
      updatedAt: "2026-07-13T10:00:01.000000+00:00",
    });

    await vi.waitFor(() =>
      expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 2)
    );
    await attendre(50);
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 2);
    expect(alerte.result.current).toBe(true);
    const projete = JSON.parse(localStorage.getItem("cycle_planning")!) as Planning;
    expect(projete.jours.some((jp) => jp.diner?.id === "autre-membre-2")).toBe(true);
  });

  // --- 2. Abonnement planning borné au montage de /planning ---
  it("hydratation encore en vol au démontage : aucun canal planning ouvert, puis abonnement au remontage", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    const { semaineParDefaut } = await import("@/lib/semaines");
    const semaine = semaineParDefaut();
    const lecture = differe<{ planning: Planning; updatedAt: string }>();
    persistance.chargerPlanningDistant.mockImplementationOnce(() => lecture.promesse);

    const vue = renderHook(() => sync.useSync());
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalled());
    vue.unmount(); // départ de /planning avant la fin de la lecture
    lecture.resoudre({ planning: semaineComplete(semaine), updatedAt: T0 });
    await attendre(50);
    expect(rappelsPlanning()).toHaveLength(0);

    // Montage normal : l'abonnement se fait.
    const vue2 = renderHook(() => sync.useSync());
    await vi.waitFor(() => expect(rappelsPlanning()).toHaveLength(1));
    vue2.unmount();
  });

  it("relecture US-21 encore en vol au démontage : aucun canal rouvert, plus aucun event jugé", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    const { semaineParDefaut } = await import("@/lib/semaines");
    const semaine = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: semaineComplete(semaine), updatedAt: T0 });
    const vue = renderHook(() => sync.useSync());
    await vi.waitFor(() => expect(rappelsPlanning()).toHaveLength(1));
    const canal = rappelsPlanning()[0];
    const lecture = differe<{ planning: Planning; updatedAt: string }>();
    persistance.chargerPlanningDistant.mockImplementationOnce(() => lecture.promesse);

    evenementSur(canal, semaine, T_DISTANT); // relecture (chemin historique), lente
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(2));
    vue.unmount();
    lecture.resoudre({ planning: semaineComplete(semaine), updatedAt: T_DISTANT });
    await attendre(50);
    expect(rappelsPlanning()).toHaveLength(1); // aucun canal rouvert

    // `semainePlanningVoulue` reste null : un event tardif n'est pas jugé.
    evenementSur(canal, semaine, "2026-06-15T10:06:00.000Z");
    await attendre(50);
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(2);
  });

  // --- 3. Envois vidés avant la régénération du cycle ---
  it("appliquerGenerationCycle attend la fin d'un push planning en attente avant sauvegarder_cycle", async () => {
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-10-29", longueur: 7 }));
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    const push = differe<string>();
    persistance.sauvegarderPlanningDistant.mockImplementationOnce(() => push.promesse);
    const { appliquerGenerationCycle } = await chargerSync();

    const enCours = appliquerGenerationCycle("2026-10-29", [
      { semaine: "2026-W44", jours: [jourPlanningSimple("lundi", { id: "g", nom: "G" })] },
    ]);
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalledTimes(1));
    await attendre(50);
    expect(persistance.sauvegarderCycleDistant).not.toHaveBeenCalled();
    push.resoudre("2026-06-15T10:00:00.000Z");
    await enCours;

    expect(persistance.sauvegarderCycleDistant).toHaveBeenCalledTimes(1);
    expect(persistance.sauvegarderCycleDistant.mock.invocationCallOrder[0]).toBeGreaterThan(
      persistance.sauvegarderPlanningDistant.mock.invocationCallOrder[0]
    );
  });

  it("appliquerGenerationCycle : envois impossibles → rejet explicite, aucune RPC sauvegarder_cycle", async () => {
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: "2026-10-29", longueur: 7 }));
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    persistance.sauvegarderPlanningDistant.mockRejectedValue(new Error("hors-ligne"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { appliquerGenerationCycle } = await chargerSync();
      await expect(
        appliquerGenerationCycle("2026-10-29", [
          { semaine: "2026-W44", jours: [jourPlanningSimple("lundi", { id: "g", nom: "G" })] },
        ])
      ).rejects.toThrow(
        "Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie."
      );
      expect(persistance.sauvegarderCycleDistant).not.toHaveBeenCalled();
      expect(localStorage.getItem("planning_dirty")).toBe("1");
    } finally {
      erreur.mockRestore();
    }
  }, 10000);

  // --- 4. Relecture ratée : persistée, retentée, signalée ---
  async function monterPlanningComplet() {
    const sync = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const { storePlanning } = await import("@/lib/stockage");
    const { renderHook } = await import("@testing-library/react");
    const semaine = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: semaineComplete(semaine), updatedAt: T0 });
    const vue = renderHook(() => sync.useSync());
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));
    await vi.waitFor(() => expect(rappelsPlanning()).toHaveLength(1));
    return { sync, semaine, storePlanning, vue, alerte, canal: rappelsPlanning()[0] };
  }
  function distantAvecMardi(semaine: string): Planning {
    return avecJour(semaineComplete(semaine), "mardi", (jp) => ({ ...jp, dejeuner: recette("autre-membre") }));
  }
  function stepperLundi(storePlanning: { ecrire: (v: string) => void }, semaine: string): void {
    storePlanning.ecrire(
      JSON.stringify(avecJour(semaineComplete(semaine), "lundi", (jp) => ({ ...jp, personnes: { diner: 4 } })))
    );
  }

  it("lecture ratée : la relecture à refaire est persistée (et purgée par reinitialiserCacheFoyer)", async () => {
    const { sync, semaine, storePlanning, canal, vue } = await monterPlanningComplet();
    persistance.chargerPlanningDistant.mockRejectedValueOnce(new Error("réseau"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stepperLundi(storePlanning, semaine);
      evenementSur(canal, semaine, T_DISTANT);
      await vi.waitFor(() => expect(localStorage.getItem("planning_a_relire")).toBe(semaine));
      vue.unmount(); // coupe aussi la nouvelle tentative différée
      sync.reinitialiserCacheFoyer();
      expect(localStorage.getItem("planning_a_relire")).toBeNull();
    } finally {
      erreur.mockRestore();
    }
  });

  it("rechargement avec une relecture à refaire : hydrater relit avant de pousser, la fusion part", async () => {
    const { semaineParDefaut } = await import("@/lib/semaines");
    const semaine = semaineParDefaut();
    const local = avecJour(semaineComplete(semaine), "lundi", (jp) => ({ ...jp, personnes: { diner: 4 } }));
    localStorage.setItem("planning_courant", JSON.stringify(local));
    localStorage.setItem("planning_courant_maj", T0);
    localStorage.setItem("planning_dirty", "1");
    localStorage.setItem("planning_confirme", JSON.stringify(semaineComplete(semaine)));
    localStorage.setItem("planning_a_relire", semaine);
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distantAvecMardi(semaine), updatedAt: T_DISTANT });
    const { hydrater } = await chargerSync();

    await hydrater();

    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(persistance.chargerPlanningDistant.mock.invocationCallOrder[0]).toBeLessThan(
      persistance.sauvegarderPlanningDistant.mock.invocationCallOrder[0]
    );
    const pousse = persistance.sauvegarderPlanningDistant.mock.calls[0][0] as Planning;
    expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
    expect(localStorage.getItem("planning_a_relire")).toBeNull();
  });

  it("lecture ratée en ligne : état « hors-ligne », nouvelle tentative seule, état rétabli et fusion poussée", async () => {
    const { semaine, storePlanning, canal, vue, alerte } = await monterPlanningComplet();
    persistance.chargerPlanningDistant
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValue({ planning: distantAvecMardi(semaine), updatedAt: T_DISTANT });
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    // Horloge simulée (vague finale #355) : plus d'attente réelle de la tentative.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      stepperLundi(storePlanning, semaine);
      evenementSur(canal, semaine, T_DISTANT);
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(vue.result.current).toBe("hors-ligne"));
      expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();

      // Aucun déclencheur : la tentative différée (2 s) relit seule.
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(alerte.result.current).toBe(true));
      await vi.advanceTimersByTimeAsync(800); // débounce du push
      expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled();
      const pousse = persistance.sauvegarderPlanningDistant.mock.calls[0][0] as Planning;
      expect(jourDe(pousse, "lundi").personnes?.diner).toBe(4);
      expect(jourDe(pousse, "mardi").dejeuner?.id).toBe("autre-membre");
      await vi.waitFor(() => expect(vue.result.current).toBe("synchronise"));
    } finally {
      vi.useRealTimers();
      erreur.mockRestore();
      vue.unmount();
    }
  });

  it("lecture ratée puis démontage : la nouvelle tentative différée est annulée", async () => {
    const { semaine, storePlanning, canal, vue } = await monterPlanningComplet();
    persistance.chargerPlanningDistant.mockRejectedValueOnce(new Error("réseau"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    // Horloge simulée AVANT l'échec : la tentative différée est un minuteur simulé.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      stepperLundi(storePlanning, semaine);
      evenementSur(canal, semaine, T_DISTANT);
      await vi.advanceTimersByTimeAsync(0);
      expect(localStorage.getItem("planning_a_relire")).toBe(semaine);
      const lectures = persistance.chargerPlanningDistant.mock.calls.length;
      vue.unmount();
      await vi.advanceTimersByTimeAsync(2500); // au-delà du premier délai de nouvelle tentative
      expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures);
      expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      erreur.mockRestore();
    }
  });
});

// Vague finale #355 : semaines partielles (week-end « Aucun », créneau
// désactivé, RG-44/46), édition faite pendant une relecture sans `dirty` au
// départ, lecture ratée sur le chemin historique, levée ciblée de la relecture
// à refaire, édition depuis la vue Cycle d'un jour absent du cache.
describe("vague finale de la synchro temps réel (#355)", () => {
  const T0 = "2026-06-15T09:00:00.000Z";
  const T_DISTANT = "2026-06-15T10:05:00.000Z";
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
  type JourSemaine = (typeof JOURS)[number];

  /** Semaine limitée aux `jours` donnés : déjeuner `d-<jour>`, dîner `s-<jour>`. */
  function semaineDe(semaine: string, jours: readonly JourSemaine[] = JOURS): Planning {
    return {
      semaine,
      jours: jours.map((jour) => ({ jour, dejeuner: recette(`d-${jour}`), diner: recette(`s-${jour}`) })),
    };
  }
  function avecJour(p: Planning, jour: string, f: (jp: JourPlanning) => JourPlanning): Planning {
    return { ...p, jours: p.jours.map((jp) => (jp.jour === jour ? f(jp) : jp)) };
  }
  function jourDe(p: Planning, jour: string): JourPlanning | undefined {
    return p.jours.find((jp) => jp.jour === jour);
  }
  function cache(): Planning {
    return JSON.parse(localStorage.getItem("planning_courant")!) as Planning;
  }
  function confirme(): Planning {
    return JSON.parse(localStorage.getItem("planning_confirme")!) as Planning;
  }
  function differe<T>(): { promesse: Promise<T>; resoudre: (v: T) => void } {
    let resoudre!: (v: T) => void;
    const promesse = new Promise<T>((r) => (resoudre = r));
    return { promesse, resoudre };
  }
  function rappelPlanning(): RappelRealtime | undefined {
    return realtime.rappels.find((r) => r.filtre.table === "planning");
  }
  function evenement(semaine: string, majISO: string): void {
    rappelPlanning()!.rappel({
      eventType: "UPDATE",
      new: { foyer_id: "foyer-1", semaine, updated_at: majISO },
      old: {},
    });
  }
  const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Monte /planning hydraté depuis la base sur le planning `initial(semaine)`.
  async function monterPlanning(initial: (semaine: string) => Planning = (s) => semaineDe(s)) {
    const sync = await chargerSync();
    const { semaineParDefaut } = await import("@/lib/semaines");
    const { storePlanning } = await import("@/lib/stockage");
    const { renderHook } = await import("@testing-library/react");
    const semaine = semaineParDefaut();
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: initial(semaine), updatedAt: T0 });
    const vue = renderHook(() => sync.useSync());
    const alerte = renderHook(() => sync.useAlertePlanning());
    await vi.waitFor(() => expect(localStorage.getItem("semaine_affichee")).toBe(semaine));
    await vi.waitFor(() => expect(rappelPlanning()).toBeDefined());
    return { sync, semaine, alerte, storePlanning, vue };
  }
  // Stepper lundi dîner → `personnes` sur le cache courant (pas encore poussé).
  function stepperLundi(storePlanning: { ecrire: (v: string) => void }, personnes: number): void {
    storePlanning.ecrire(
      JSON.stringify(avecJour(cache(), "lundi", (jp) => ({ ...jp, personnes: { diner: personnes } })))
    );
  }
  async function dernierPush(): Promise<Planning> {
    await vi.waitFor(() => expect(persistance.sauvegarderPlanningDistant).toHaveBeenCalled(), {
      timeout: 2000,
    });
    return persistance.sauvegarderPlanningDistant.mock.calls.at(-1)![0] as Planning;
  }

  // --- A1 : semaine partielle → le rejeu s'applique quand même ---
  it("semaine de 5 jours (week-end « Aucun ») : l'édition locale est rejouée, pas écrasée", async () => {
    const cinqJours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"] as const;
    const { semaine, alerte, storePlanning } = await monterPlanning((s) => semaineDe(s, cinqJours));
    const distant = avecJour(semaineDe(semaine, cinqJours), "mardi", (jp) => ({
      ...jp,
      dejeuner: recette("autre-membre"),
    }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    stepperLundi(storePlanning, 4);
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi")?.personnes?.diner).toBe(4);
    expect(jourDe(cache(), "mardi")?.dejeuner?.id).toBe("autre-membre");
    const pousse = await dernierPush();
    expect(jourDe(pousse, "lundi")?.personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi")?.dejeuner?.id).toBe("autre-membre");
    expect(pousse.jours.map((jp) => jp.jour)).toEqual([...cinqJours]);
  });

  it("créneau désactivé (dimanche absent, samedi sans dîner) : l'édition locale est rejouée", async () => {
    const partielle = (s: string): Planning => {
      const p = semaineDe(s, ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]);
      return avecJour(p, "samedi", (jp) => ({ jour: jp.jour, dejeuner: jp.dejeuner }));
    };
    const { semaine, alerte, storePlanning } = await monterPlanning(partielle);
    const distant = avecJour(partielle(semaine), "mardi", (jp) => ({ ...jp, dejeuner: recette("autre-membre") }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });

    stepperLundi(storePlanning, 4);
    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi")?.personnes?.diner).toBe(4);
    const pousse = await dernierPush();
    expect(jourDe(pousse, "lundi")?.personnes?.diner).toBe(4);
    expect(jourDe(pousse, "mardi")?.dejeuner?.id).toBe("autre-membre");
    expect(jourDe(pousse, "samedi")?.diner).toBeUndefined();
    expect(jourDe(pousse, "dimanche")).toBeUndefined();
  });

  // --- A4 : édition faite pendant la lecture, `dirty` faux au départ ---
  it("sans édition au départ, un clic pendant la lecture est rejoué (pas écrasé par le distant)", async () => {
    const { semaine, alerte, storePlanning } = await monterPlanning();
    const distant = avecJour(semaineDe(semaine), "mardi", (jp) => ({ ...jp, dejeuner: recette("autre-membre") }));
    const lecture = differe<{ planning: Planning; updatedAt: string }>();
    persistance.chargerPlanningDistant.mockImplementationOnce(() => lecture.promesse);

    evenement(semaine, T_DISTANT); // aucune édition en attente : dirty faux
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(2));
    stepperLundi(storePlanning, 5); // clic pendant la lecture
    lecture.resoudre({ planning: distant, updatedAt: T_DISTANT });

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(jourDe(cache(), "lundi")?.personnes?.diner).toBe(5);
    expect(jourDe(cache(), "mardi")?.dejeuner?.id).toBe("autre-membre");
    expect(confirme()).toEqual(distant);
    const pousse = await dernierPush();
    expect(jourDe(pousse, "lundi")?.personnes?.diner).toBe(5);
    expect(jourDe(pousse, "mardi")?.dejeuner?.id).toBe("autre-membre");
  });

  it("sans édition, la relecture remplace le cache par le distant en UNE lecture, sans push", async () => {
    const { semaine, alerte } = await monterPlanning();
    const distant = avecJour(semaineDe(semaine), "mardi", (jp) => ({ ...jp, dejeuner: recette("autre-membre") }));
    persistance.chargerPlanningDistant.mockResolvedValue({ planning: distant, updatedAt: T_DISTANT });
    const lectures = persistance.chargerPlanningDistant.mock.calls.length;

    evenement(semaine, T_DISTANT);

    await vi.waitFor(() => expect(alerte.result.current).toBe(true));
    expect(cache()).toEqual(distant);
    expect(confirme()).toEqual(distant);
    expect(localStorage.getItem("planning_courant_maj")).toBe(T_DISTANT);
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures + 1);
    await attendre(900);
    expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
  });

  // --- A2 : lecture ratée sur le chemin historique avec une édition en attente ---
  it("chemin historique, lecture ratée avec une édition en attente : aucun push avant une relecture réussie", async () => {
    const { semaine, storePlanning, vue } = await monterPlanning();
    // Instantané d'une autre semaine : pas de rejeu possible, chemin historique.
    localStorage.setItem("planning_confirme", JSON.stringify(semaineDe("2020-W01")));
    persistance.chargerPlanningDistant.mockRejectedValueOnce(new Error("réseau"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stepperLundi(storePlanning, 4);
      evenement(semaine, T_DISTANT);
      await vi.waitFor(() => expect(erreur).toHaveBeenCalled());
      await attendre(1000); // au-delà du débounce
      expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
      expect(localStorage.getItem("planning_a_relire")).toBe(semaine);
      expect(localStorage.getItem("planning_dirty")).toBe("1");
      expect(vue.result.current).toBe("hors-ligne");
    } finally {
      vue.unmount(); // coupe la nouvelle tentative différée
      erreur.mockRestore();
    }
  });

  // --- A5 : une lecture réussie ne lève que la relecture à refaire de SA semaine ---
  it("une lecture réussie d'une autre semaine ne lève pas la relecture à refaire", async () => {
    localStorage.setItem("planning_a_relire", "2020-W01");
    const { vue } = await monterPlanning(); // lecture réussie de la semaine par défaut
    expect(localStorage.getItem("planning_a_relire")).toBe("2020-W01");
    vue.unmount();
  });

  // --- A3 : vue Cycle, repas ajouté sur un jour absent du cache ---
  it("modifierSlotDistant sur un jour absent du cache : jour inséré à sa place (cache ET confirmé), puis poussé", async () => {
    const cinqJours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"] as const;
    const { sync, semaine, storePlanning } = await monterPlanning((s) => semaineDe(s, cinqJours));
    const samedi: JourPlanning = { jour: "samedi", diner: recette("cycle") };

    await sync.modifierSlotDistant(semaine, samedi);

    const ordre = [...cinqJours, "samedi"];
    expect(cache().jours.map((jp) => jp.jour)).toEqual(ordre);
    expect(jourDe(cache(), "samedi")).toEqual(samedi);
    expect(confirme()).toEqual(cache());
    // L'édition suivante en vue Semaine pousse la semaine AVEC le samedi.
    stepperLundi(storePlanning, 4);
    const pousse = await dernierPush();
    expect(jourDe(pousse, "samedi")?.diner?.id).toBe("cycle");
  });

  // --- A6 : régénération du cycle hors ligne, refus AVANT l'appel réseau ---
  it("useGenerationCycle : envois impossibles → message français, sans appeler la route de génération", async () => {
    localStorage.setItem("planning_courant", JSON.stringify(planning("2026-W10")));
    localStorage.setItem("planning_dirty", "1");
    persistance.sauvegarderPlanningDistant.mockRejectedValue(new Error("hors-ligne"));
    const fetchSimule = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSimule);
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const sync = await chargerSync();
      const { renderHook } = await import("@testing-library/react");
      const { result } = renderHook(() =>
        sync.useGenerationCycle({ ancre: "2026-10-29", longueur: 7 })
      );

      const rejet = await result.current.genererCycle().catch((e: unknown) => e);

      expect(rejet).toBeInstanceOf(sync.ErreurEnvoisEnAttente);
      expect((rejet as Error).message).toBe(
        "Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie."
      );
      expect(fetchSimule).not.toHaveBeenCalled();
      expect(persistance.sauvegarderCycleDistant).not.toHaveBeenCalled();
    } finally {
      erreur.mockRestore();
      vi.unstubAllGlobals();
    }
  }, 10000);

  // --- A7 : re-projection finale du cycle demandée pendant une génération ---
  it("côté cycle : une re-projection finale demandée pendant une génération est jugée à sa fin, pas jetée", async () => {
    const sync = await chargerSync();
    const { renderHook } = await import("@testing-library/react");
    const lundi = jourPlanningSimple("lundi", { id: "r1", nom: "R1" });
    persistance.chargerPlanningDistant.mockResolvedValue({
      planning: { semaine: "2026-W29", jours: [lundi] },
      updatedAt: "2026-07-13T09:00:00.000000+00:00",
    });
    renderHook(() => sync.useSyncCourses("2026-07-13"));
    await vi.waitFor(() =>
      expect(realtime.rappels.filter((r) => r.filtre.table === "planning")).toHaveLength(1)
    );
    const canal = realtime.rappels.filter((r) => r.filtre.table === "planning")[0];
    const lecture = differe<{ planning: Planning; updatedAt: string }>();
    persistance.chargerPlanningDistant.mockImplementationOnce(() => lecture.promesse);
    const rpc = differe<Record<string, string>>();
    persistance.sauvegarderCycleDistant.mockImplementationOnce(() => rpc.promesse);
    const appels = persistance.chargerPlanningDistant.mock.calls.length;
    const evenementCycle = (maj: string) =>
      canal.rappel({ eventType: "UPDATE", new: { semaine: "2026-W29", updated_at: maj }, old: {} });

    evenementCycle("2026-07-13T10:00:01.000000+00:00"); // re-projection lente
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 1));
    evenementCycle("2026-07-13T10:00:02.000000+00:00"); // → re-projection finale demandée
    const generation = sync.appliquerGenerationCycle("2026-07-13", [
      { semaine: "2026-W29", jours: [jourPlanningSimple("mardi", { id: "g", nom: "G" })] },
    ]);
    await vi.waitFor(() => expect(persistance.sauvegarderCycleDistant).toHaveBeenCalled());
    // La re-projection lente finit PENDANT la génération : sa finale est différée.
    lecture.resoudre({ planning: { semaine: "2026-W29", jours: [lundi] }, updatedAt: "2026-07-13T10:00:01.000000+00:00" });
    await attendre(20);
    rpc.resoudre({ "2026-W29": "2026-07-13T10:00:05.000000+00:00" });
    await generation;

    // Lectures : la lente, celle de la génération, puis la finale différée.
    await vi.waitFor(() => expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 3));
    await attendre(50);
    expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(appels + 3);
  });

  // --- A8 : back-off de la nouvelle tentative (2 s ×2, plafond 30 s, 5 essais) ---
  it("relecture ratée en boucle : nouvelles tentatives à 2, 4, 8, 16 puis 30 s, et plus rien après la 5e", async () => {
    const { semaine, storePlanning, vue } = await monterPlanning();
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      persistance.chargerPlanningDistant.mockRejectedValue(new Error("réseau"));
      stepperLundi(storePlanning, 4);
      evenement(semaine, T_DISTANT);
      await vi.advanceTimersByTimeAsync(0);
      expect(localStorage.getItem("planning_a_relire")).toBe(semaine);
      let lectures = persistance.chargerPlanningDistant.mock.calls.length;

      for (const delai of [2000, 4000, 8000, 16_000, 30_000]) {
        await vi.advanceTimersByTimeAsync(delai - 1);
        expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures);
        await vi.advanceTimersByTimeAsync(1);
        expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures + 1);
        lectures++;
      }
      // Après 5 tentatives : plus de relance automatique (restent les déclencheurs de push).
      await vi.advanceTimersByTimeAsync(120_000);
      expect(persistance.chargerPlanningDistant).toHaveBeenCalledTimes(lectures);
      expect(persistance.sauvegarderPlanningDistant).not.toHaveBeenCalled();
      expect(localStorage.getItem("planning_a_relire")).toBe(semaine);
    } finally {
      vue.unmount();
      vi.useRealTimers();
      erreur.mockRestore();
    }
  });
});

describe("coches d'ingrédients : écho Realtime d'une écriture dépassée (RG-32, #357)", () => {
  // Régression (e2e « une catégorie entièrement cochée glisse en bas de liste »,
  // flaky) : l'écho INSERT de la coche arrivait APRÈS la décoche de
  // l'utilisateur. `appliquerEventLocal` le réappliquait au blob local : la
  // case se recochait à l'écran et, la référence `cochesConnues` rattrapant le
  // local, la décoche n'était jamais poussée (base restée cochée).
  const ANCRE = "2026-07-13";

  function differe() {
    let resoudre!: () => void;
    const promesse = new Promise<void>((r) => {
      resoudre = r;
    });
    return { promesse, resoudre };
  }

  async function preparer() {
    const sync = await chargerSync();
    const { storeCoches } = await import("@/lib/stockage");
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses(ANCRE));
    await waitFor(() =>
      expect(realtime.rappels.some((r) => r.filtre.table === "etat_courses_article")).toBe(true)
    );
    const coches = () => JSON.parse(localStorage.getItem("courses_cochees") ?? "{}");
    const evenement = (
      eventType: "INSERT" | "UPDATE" | "DELETE",
      cle: string,
      quantite = 1
    ) =>
      act(() => {
        const ligne = { foyer_id: "foyer-1", ancre: ANCRE, cle, quantite };
        const abonnement = realtime.rappels.find(
          (r) => r.filtre.table === "etat_courses_article"
        )!;
        abonnement.rappel(
          eventType === "DELETE"
            ? { eventType, new: {}, old: ligne }
            : { eventType, new: ligne, old: {} }
        );
      });
    return { storeCoches, waitFor, act, coches, evenement };
  }

  it("l'écho de la coche reçu après la décoche ne recoche pas et la décoche part", async () => {
    const { storeCoches, waitFor, act, coches, evenement } = await preparer();

    act(() => storeCoches.ecrire(JSON.stringify({ "pain|piece": 1, "lardons|g": 200 })));
    await waitFor(
      () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "lardons|g", 200),
      { timeout: 3000 }
    );
    await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());

    // Décoche, puis l'écho INSERT de la coche arrive (livraison Realtime tardive).
    act(() => storeCoches.ecrire(JSON.stringify({ "pain|piece": 1 })));
    evenement("INSERT", "lardons|g", 200);

    expect(coches()).toEqual({ "pain|piece": 1 });
    await waitFor(
      () => expect(persistance.decocherArticleDistant).toHaveBeenCalledWith(ANCRE, "lardons|g"),
      { timeout: 3000 }
    );
    expect(coches()).toEqual({ "pain|piece": 1 });
  });

  it("l'écho reçu pendant l'écriture en vol, décoche faite entre-temps, ne recoche pas", async () => {
    const insert = differe();
    persistance.cocherArticleDistant.mockImplementation((_ancre: string, cle: string) =>
      cle === "lardons|g" ? insert.promesse : Promise.resolve()
    );
    try {
      const { storeCoches, waitFor, act, coches, evenement } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "pain|piece": 1, "lardons|g": 200 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "lardons|g", 200),
        { timeout: 3000 }
      );
      // L'INSERT de lardons est en vol (premier appel bloqué) : décoche, puis écho.
      act(() => storeCoches.ecrire(JSON.stringify({ "pain|piece": 1 })));
      evenement("INSERT", "lardons|g", 200);
      expect(coches()).toEqual({ "pain|piece": 1 });

      insert.resoudre();
      await waitFor(
        () => expect(persistance.decocherArticleDistant).toHaveBeenCalledWith(ANCRE, "lardons|g"),
        { timeout: 3000 }
      );
      expect(coches()).toEqual({ "pain|piece": 1 });
    } finally {
      // Test autonome : l'implémentation bloquante ne fuit pas vers les suivants.
      insert.resoudre();
      persistance.cocherArticleDistant.mockReset();
      persistance.cocherArticleDistant.mockResolvedValue(undefined);
    }
  });

  it("une coche d'un autre membre reçue pendant notre écriture en vol suit sa décoche, sans être repoussée", async () => {
    // Relecture #357 : au succès du flush, la référence reprenait l'instantané
    // poussé ; la coche de B reçue en vol en disparaissait, sa décoche passait
    // pour un « geste en attente » (ignorée) et notre geste suivant la recochait.
    const vol = differe();
    persistance.cocherArticleDistant.mockImplementation((_ancre: string, cle: string) =>
      cle === "k|g" ? vol.promesse : Promise.resolve()
    );
    try {
      const { storeCoches, waitFor, act, coches, evenement } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "k|g", 1),
        { timeout: 3000 }
      );
      // Pendant le vol : B coche j (aucun geste local sur j : appliqué).
      evenement("INSERT", "j|g", 2);
      expect(coches()).toEqual({ "k|g": 1, "j|g": 2 });

      vol.resoudre();
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());

      // B décoche j : l'écran de A suit.
      evenement("DELETE", "j|g");
      expect(coches()).toEqual({ "k|g": 1 });

      // Geste suivant de A : seule sa coche part, la décoche de B n'est pas annulée.
      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1, "m|g": 3 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "m|g", 3),
        { timeout: 3000 }
      );
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());
      expect(persistance.cocherArticleDistant).not.toHaveBeenCalledWith(ANCRE, "j|g", 2);
      expect(coches()).toEqual({ "k|g": 1, "m|g": 3 });
    } finally {
      vol.resoudre();
      persistance.cocherArticleDistant.mockReset();
      persistance.cocherArticleDistant.mockResolvedValue(undefined);
    }
  });

  it("coche puis décoche d'un autre membre, toutes deux reçues pendant notre vol sur une autre clé : suivies, jamais repoussées", async () => {
    // Relecture #357 (tour 2) : le filtre « en vol » comparait le blob poussé à
    // la référence COURANTE ; la coche de B sur j, appliquée en vol, faisait
    // passer j pour « en vol » et sa décoche, dans le même vol, était ignorée.
    const vol = differe();
    persistance.cocherArticleDistant.mockImplementation((_ancre: string, cle: string) =>
      cle === "k|g" ? vol.promesse : Promise.resolve()
    );
    try {
      const { storeCoches, waitFor, act, coches, evenement } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "k|g", 1),
        { timeout: 3000 }
      );
      evenement("INSERT", "j|g", 2);
      expect(coches()).toEqual({ "k|g": 1, "j|g": 2 });
      evenement("DELETE", "j|g");
      expect(coches()).toEqual({ "k|g": 1 });

      vol.resoudre();
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());
      expect(coches()).toEqual({ "k|g": 1 });

      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1, "m|g": 3 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "m|g", 3),
        { timeout: 3000 }
      );
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());
      expect(persistance.cocherArticleDistant).not.toHaveBeenCalledWith(ANCRE, "j|g", 2);
    } finally {
      vol.resoudre();
      persistance.cocherArticleDistant.mockReset();
      persistance.cocherArticleDistant.mockResolvedValue(undefined);
    }
  });

  it("« Tout décocher » en vol : coche puis décoche d'un autre membre reçues pendant le vidage, suivies, jamais repoussées", async () => {
    const vidage = differe();
    persistance.viderCochesDistantes.mockImplementation(() => vidage.promesse);
    try {
      const { storeCoches, waitFor, act, coches, evenement } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "k|g", 1),
        { timeout: 3000 }
      );
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());

      act(() => storeCoches.effacer());
      await waitFor(() => expect(persistance.viderCochesDistantes).toHaveBeenCalledWith(ANCRE), {
        timeout: 3000,
      });
      evenement("INSERT", "j|g", 2);
      expect(coches()).toEqual({ "j|g": 2 });
      evenement("DELETE", "j|g");
      expect(coches()).toEqual({});

      vidage.resoudre();
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());
      expect(coches()).toEqual({});
      act(() => storeCoches.ecrire(JSON.stringify({ "m|g": 2 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "m|g", 2),
        { timeout: 3000 }
      );
      expect(persistance.cocherArticleDistant).not.toHaveBeenCalledWith(ANCRE, "j|g", 2);
    } finally {
      vidage.resoudre();
      persistance.viderCochesDistantes.mockReset();
      persistance.viderCochesDistantes.mockResolvedValue(undefined);
    }
  });

  it("flush en échec à mi-parcours : la référence garde les ops passées, la décoche suivante part", async () => {
    // L'op « a » est en base, « b » échoue. Si la référence ignorait « a »,
    // décocher « a » ensuite ne dériverait aucune op : la base le garderait coché.
    persistance.cocherArticleDistant.mockImplementation((_ancre: string, cle: string) =>
      cle === "b|g" ? Promise.reject(new Error("réseau coupé")) : Promise.resolve()
    );
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { storeCoches, waitFor, act } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "a|g": 1, "b|g": 1 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "b|g", 1),
        { timeout: 3000 }
      );
      await waitFor(() =>
        expect(erreur).toHaveBeenCalledWith(
          "Synchronisation des coches échouée (sera rejouée).",
          expect.any(Error)
        )
      );
      persistance.cocherArticleDistant.mockReset();
      persistance.cocherArticleDistant.mockResolvedValue(undefined);

      // A décoche « a » (en base : coché) : la décoche part, « b » est rejoué.
      act(() => storeCoches.ecrire(JSON.stringify({ "b|g": 1 })));
      await waitFor(
        () => expect(persistance.decocherArticleDistant).toHaveBeenCalledWith(ANCRE, "a|g"),
        { timeout: 3000 }
      );
      expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "b|g", 1);
      expect(persistance.cocherArticleDistant).not.toHaveBeenCalledWith(ANCRE, "a|g", 1);
    } finally {
      erreur.mockRestore();
      persistance.cocherArticleDistant.mockReset();
      persistance.cocherArticleDistant.mockResolvedValue(undefined);
    }
  });

  it("« Tout décocher » en vol : l'écho tardif d'une coche ne recoche pas, le vidage part", async () => {
    const vidage = differe();
    persistance.viderCochesDistantes.mockImplementation(() => vidage.promesse);
    try {
      const { storeCoches, waitFor, act, coches, evenement } = await preparer();

      act(() => storeCoches.ecrire(JSON.stringify({ "k|g": 1 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "k|g", 1),
        { timeout: 3000 }
      );
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());

      // « Tout décocher », vidage en vol, puis l'écho INSERT de la coche arrive.
      act(() => storeCoches.effacer());
      await waitFor(() => expect(persistance.viderCochesDistantes).toHaveBeenCalledWith(ANCRE), {
        timeout: 3000,
      });
      evenement("INSERT", "k|g", 1);
      expect(coches()).toEqual({});

      vidage.resoudre();
      await waitFor(() => expect(localStorage.getItem("courses_dirty")).toBeNull());
      expect(coches()).toEqual({});
      // Référence vidée : le geste suivant ne repousse ni coche ni décoche de « k ».
      act(() => storeCoches.ecrire(JSON.stringify({ "m|g": 2 })));
      await waitFor(
        () => expect(persistance.cocherArticleDistant).toHaveBeenCalledWith(ANCRE, "m|g", 2),
        { timeout: 3000 }
      );
      expect(persistance.decocherArticleDistant).not.toHaveBeenCalled();
      expect(persistance.cocherArticleDistant).toHaveBeenCalledTimes(2);
    } finally {
      vidage.resoudre();
      persistance.viderCochesDistantes.mockReset();
      persistance.viderCochesDistantes.mockResolvedValue(undefined);
    }
  });

  it("une coche d'un autre membre, sans geste local en attente, s'applique", async () => {
    const { waitFor, coches, evenement } = await preparer();
    await waitFor(() => expect(localStorage.getItem("cycle_affiche")).not.toBeNull());

    evenement("INSERT", "lait|l", 2);
    expect(coches()).toEqual({ "lait|l": 2 });
    evenement("DELETE", "lait|l");
    expect(coches()).toEqual({});
    expect(persistance.cocherArticleDistant).not.toHaveBeenCalled();
    expect(persistance.decocherArticleDistant).not.toHaveBeenCalled();
  });
});

describe("basculerCocheArticle / toutDecocher — une interface (#362)", () => {
  // /courses coche ingrédients et articles manuels par la même interface,
  // sans écrire storeCoches ni connaître les deux moteurs.
  const ANCRE = "2026-07-13";
  const lait = {
    nom: "lait",
    quantite: 1,
    unite: "l" as const,
    categorie: "produits-frais" as const,
    fondDePlacard: false,
  };

  async function avecArticleManuel() {
    persistance.chargerArticlesManuelsDistants.mockResolvedValue([
      { id: "a1", libelle: "Piles", quantite: null, unite: null, categorie: "autre", fondDePlacard: false, coche: false },
    ]);
    const sync = await chargerSync();
    const { renderHook, waitFor, act } = await import("@testing-library/react");
    renderHook(() => sync.useSyncCourses(ANCRE));
    const { result } = renderHook(() => sync.useArticlesManuels());
    await waitFor(() => expect(result.current).toHaveLength(1));
    return { sync, act, articles: () => result.current };
  }

  it("ingrédient : chaque appel lit le blob courant, deux bascules sans re-rendu s'annulent (#362)", async () => {
    const sync = await chargerSync();
    void sync.basculerCocheArticle(lait);
    expect(JSON.parse(localStorage.getItem("courses_cochees") ?? "{}")).toEqual({ "lait|l": 1 });
    void sync.basculerCocheArticle(lait);
    expect(JSON.parse(localStorage.getItem("courses_cochees") ?? "{}")).toEqual({});
  });

  it("article manuel : passe par le moteur des articles manuels, coche locale immédiate", async () => {
    persistance.basculerCocheArticleManuelDistant.mockResolvedValue(null);
    const { sync, act, articles } = await avecArticleManuel();
    let promesse!: Promise<void>;
    act(() => {
      promesse = sync.basculerCocheArticle({
        nom: "Piles",
        quantite: 0,
        unite: "piece",
        categorie: "autre",
        fondDePlacard: false,
        source: "manuel",
        id: "a1",
      });
    });
    expect(articles()[0].coche).toBe(true);
    await promesse;
    expect(persistance.basculerCocheArticleManuelDistant).toHaveBeenCalledWith("a1", true);
    expect(localStorage.getItem("courses_cochees")).toBeNull();
  });

  it("article manuel en échec réseau : la promesse rejette (la page affiche son toast)", async () => {
    persistance.basculerCocheArticleManuelDistant.mockRejectedValue(new Error("hors ligne"));
    const { sync } = await avecArticleManuel();
    await expect(
      sync.basculerCocheArticle({ nom: "Piles", quantite: 0, unite: "piece", categorie: "autre", fondDePlacard: false, source: "manuel", id: "a1" })
    ).rejects.toThrow("hors ligne");
  });

  it("toutDecocher : blob et articles manuels décochés AVANT le premier await (avecTransition)", async () => {
    persistance.basculerCocheArticleManuelDistant.mockResolvedValue(null);
    persistance.viderCochesArticlesManuelsDistantes.mockReturnValue(new Promise(() => {}));
    const { sync, act, articles } = await avecArticleManuel();
    localStorage.setItem("cycle_affiche", JSON.stringify({ ancre: ANCRE, longueur: 7 }));
    await act(async () => {
      await sync.basculerCocheArticle({ nom: "Piles", quantite: 0, unite: "piece", categorie: "autre", fondDePlacard: false, source: "manuel", id: "a1" });
    });
    void sync.basculerCocheArticle(lait);
    act(() => {
      void sync.toutDecocher();
    });
    expect(localStorage.getItem("courses_cochees")).toBeNull();
    expect(articles()[0].coche).toBe(false);
  });
});
