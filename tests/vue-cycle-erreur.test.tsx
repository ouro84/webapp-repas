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
  // Jour de courses du foyer (1 = lundi : cycle calendaire, une seule semaine ISO).
  jourCourses: 1,
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
vi.mock("@/lib/foyer", () => ({ chargerJourCoursesFoyer: () => Promise.resolve(m.jourCourses) }));
vi.mock("@/lib/ancre-cycle", () => ({ resoudreCycle: vi.fn() }));
vi.mock("@/lib/supabase/par-defaut", () => ({ clientParDefaut: vi.fn() }));
vi.mock("@/lib/reglages-data", () => ({ chargerReglages: () => new Promise(() => {}) }));
vi.mock("@/lib/recettes", () => ({ chargerRecettesGerees: () => new Promise(() => {}) }));
vi.mock("@/lib/preferences", () => ({ chargerPreferences: () => new Promise(() => {}) }));
vi.mock("@/lib/sync", () => ({
  // Refus sans RPC (#355) : même contrat que la classe réelle de lib/sync.
  ErreurEnvoisEnAttente: class ErreurEnvoisEnAttente extends Error {
    constructor() {
      super("Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie.");
    }
  },
  definirCycleAffiche: vi.fn(),
  modifierSlotDistant: vi.fn(),
  useGenerationCycle: () => ({ enGeneration: false, genererCycle: m.genererCycle }),
}));

import { VuePlanningCycle } from "@/components/planning/vue-cycle";
import { ErreurEnvoisEnAttente } from "@/lib/sync";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.chargerPlanningDistant.mockReset();
  m.genererCycle.mockReset();
  m.jourCourses = 1;
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.dismiss).mockClear();
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
    vi.mocked(toast.dismiss).mockClear(); // le chargement initial réussi l'a appelé
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
      "Certains jours du cycle n'ont pas pu être chargés. Réessaie.",
      { id: "echec-chargement-cycle" }
    );
    // La resynchronisation a réussi : le toast d'échec périmé est levé.
    expect(toast.dismiss).toHaveBeenCalledWith("echec-chargement-cycle");
  });

  it("relecture et nouvelle lecture ratées : les deux toasts partagent le même id (dédoublonnés par sonner)", async () => {
    await afficherCycleVide();
    m.genererCycle.mockResolvedValue(sansAvertissement);
    m.chargerPlanningDistant.mockRejectedValue(new Error("réseau"));

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    for (const appel of vi.mocked(toast.error).mock.calls) {
      expect(appel[1]).toEqual({ id: "echec-chargement-cycle" });
    }
    expect(toast.dismiss).not.toHaveBeenCalledWith("echec-chargement-cycle");
  });

  it("génération rejetée : toast d'erreur inchangé et cycle relu pour se resynchroniser", async () => {
    const lectures = await afficherCycleVide();
    m.genererCycle.mockRejectedValue(new Error("Impossible de générer le cycle."));
    m.chargerPlanningDistant.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    await waitFor(() =>
      expect(m.chargerPlanningDistant).toHaveBeenCalledTimes(lectures)
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Impossible de générer le cycle.");
    // L'état précédent (cycle vide) reste affiché : ni état erreur, ni « Chargement… ».
    await waitFor(() => expect(screen.getByText("Aucun repas planifié sur ce cycle.")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Générer mon cycle/ })).toBeTruthy();
    expect(screen.queryByText("Impossible de charger le cycle.")).toBeNull();
    expect(screen.queryByText("Chargement…")).toBeNull();
  });

  it("refus sans RPC (envois en attente, #355) : un seul toast, aucune relecture du cycle", async () => {
    await afficherCycleVide();
    m.genererCycle.mockRejectedValue(new ErreurEnvoisEnAttente());
    m.chargerPlanningDistant.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      "Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie."
    );
    // Laisse au gestionnaire le temps d'aller au bout (une relecture partirait ici).
    await new Promise((r) => setTimeout(r, 50));
    expect(m.chargerPlanningDistant).not.toHaveBeenCalled();
    expect(screen.getByText("Aucun repas planifié sur ce cycle.")).toBeTruthy();
  });

  it("cycle à cheval sur deux semaines, une seule en échec à la relecture : log de la semaine en échec, puis toast (chantier 05)", async () => {
    m.jourCourses = 5; // vendredi : ven/sam/dim en semaine N, lun→jeu en N+1
    const lectures = await afficherCycleVide();
    expect(lectures).toBe(2);
    const erreurConsole = vi.mocked(console.error);
    erreurConsole.mockClear();
    m.genererCycle.mockResolvedValue(sansAvertissement);
    // Relecture après génération : la 2e semaine du cycle échoue une fois, la
    // 1re réussit (aucune ligne) ; la resynchronisation qui suit réussit.
    let semaineEnEchec: string | undefined;
    m.chargerPlanningDistant.mockImplementation(async (semaine: string) => {
      if (semaineEnEchec === undefined && m.chargerPlanningDistant.mock.calls.length === 2) {
        semaineEnEchec = semaine;
        throw new Error("réseau");
      }
      return null;
    });

    fireEvent.click(screen.getByRole("button", { name: /Générer mon cycle/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(semaineEnEchec).toBeDefined();
    const logsSemaine = erreurConsole.mock.calls.filter(
      ([message]) => typeof message === "string" && message.startsWith("Chargement du planning de la semaine")
    );
    expect(logsSemaine).toHaveLength(1);
    expect(logsSemaine[0][0]).toBe(`Chargement du planning de la semaine ${semaineEnEchec} échoué.`);
    expect(logsSemaine[0][1]).toEqual(new Error("réseau"));
    // Le log précède le toast.
    const ordreLog = erreurConsole.mock.invocationCallOrder[erreurConsole.mock.calls.indexOf(logsSemaine[0])];
    expect(ordreLog).toBeLessThan(vi.mocked(toast.error).mock.invocationCallOrder[0]);
    expect(toast.error).toHaveBeenCalledWith(
      "Certains jours du cycle n'ont pas pu être chargés. Réessaie.",
      { id: "echec-chargement-cycle" }
    );
  });

  it("cycle rempli sur deux semaines, une seule en échec à la relecture : l'état affiché est conservé, sans projection partielle (chantier 05)", async () => {
    m.jourCourses = 5; // vendredi : ven/sam/dim en semaine N, lun→jeu en N+1
    // jsdom n'implémente pas <dialog>.showModal (confirmation de régénération, #334).
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    const jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
    let version = "ancien";
    let semaineEnEchec: string | undefined;
    m.chargerPlanningDistant.mockImplementation(async (semaine: string) => {
      if (semaine === semaineEnEchec) throw new Error("réseau");
      return {
        planning: {
          semaine,
          jours: jours.map((jour) => ({
            jour,
            diner: {
              id: `${version}-${semaine}-${jour}`,
              nom: `${version}-${semaine}-${jour}`,
              tempsPreparation: "rapide" as const,
              ingredients: [],
            },
          })),
        },
        updatedAt: "2026-11-06T10:00:00Z",
      };
    });
    rendre();
    const recettesAffichees = () =>
      screen
        .queryAllByLabelText(/^Voir la recette : /)
        .map((el) => el.getAttribute("aria-label")!.replace("Voir la recette : ", ""));
    await waitFor(() => expect(recettesAffichees().length).toBeGreaterThan(0));
    const semaines = [...new Set(m.chargerPlanningDistant.mock.calls.map(([s]) => s as string))];
    expect(semaines).toHaveLength(2);
    const avant = recettesAffichees();
    // Les deux semaines du cycle sont affichées.
    for (const s of semaines) expect(avant.some((nom) => nom.includes(s))).toBe(true);

    // Relecture après génération : la 1re semaine renvoie du contenu NOUVEAU, la
    // 2e échoue. Aucun jour nouveau ne doit apparaître (pas de projection partielle).
    version = "nouveau";
    semaineEnEchec = semaines[1];
    m.chargerPlanningDistant.mockClear();
    m.genererCycle.mockResolvedValue({
      vegeNonHonore: false,
      mixNonHonore: false,
      saisonNonHonore: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Régénérer" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Régénérer" }).at(-1)!);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // La relecture a bien lu les deux semaines (la 1re réussit, la 2e échoue).
    const relues = m.chargerPlanningDistant.mock.calls.map(([s]) => s as string);
    expect(relues).toEqual(expect.arrayContaining(semaines));
    expect(recettesAffichees()).toEqual(avant);
    expect(recettesAffichees().some((nom) => nom.startsWith("nouveau-"))).toBe(false);
    expect(screen.queryByText("Impossible de charger le cycle.")).toBeNull();
    expect(screen.queryByText("Aucun repas planifié sur ce cycle.")).toBeNull();
  });
});
