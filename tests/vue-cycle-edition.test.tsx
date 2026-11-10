// Vue Cycle (components/planning/vue-cycle.tsx) : retours d'édition alignés sur
// la vue Semaine (#373) — avertissements RG-26/27/28 après « Changer »,
// annulation au clavier (Ctrl/Cmd+Z) et toast « Annulé », message inline
// « Pas de recette disponible » sur le créneau.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import type { JourPlanning, Planning } from "@/types";

const m = vi.hoisted(() => ({
  editerSlot: vi.fn(),
  modifierSlotDistant: vi.fn(),
  // Barrière optionnelle sur la lecture du cycle (squelette de premier chargement, #400).
  barriereLecture: null as Promise<void> | null,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/lib/edition-slot", async (original) => ({
  ...(await original<typeof import("@/lib/edition-slot")>()),
  editerSlot: m.editerSlot,
}));
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
function recette(id: string) {
  return { id, nom: id, tempsPreparation: "rapide" as const, ingredients: [] };
}
vi.mock("@/lib/persistance", () => ({
  chargerLongueurCycle: () => Promise.resolve(7),
  chargerPlanningDistant: async (semaine: string) => {
    await m.barriereLecture;
    return {
      planning: {
        semaine,
        jours: JOURS.map((jour) => ({ jour, dejeuner: recette(`d-${jour}`), diner: recette(`s-${jour}`) })),
      },
      updatedAt: "2026-11-07T10:00:00.000Z",
    };
  },
}));
vi.mock("@/lib/foyer", () => ({ chargerJourCoursesFoyer: () => Promise.resolve(1) }));
vi.mock("@/lib/ancre-cycle", () => ({ resoudreCycle: vi.fn() }));
vi.mock("@/lib/supabase/par-defaut", () => ({ clientParDefaut: vi.fn() }));
vi.mock("@/lib/reglages-data", () => ({ chargerReglages: () => new Promise(() => {}) }));
vi.mock("@/lib/recettes", () => ({ chargerRecettesGerees: () => new Promise(() => {}) }));
vi.mock("@/lib/preferences", () => ({ chargerPreferences: () => new Promise(() => {}) }));
vi.mock("@/lib/sync", () => ({
  ErreurEnvoisEnAttente: class ErreurEnvoisEnAttente extends Error {},
  definirCycleAffiche: vi.fn(),
  modifierSlotDistant: m.modifierSlotDistant,
  useGenerationCycle: () => ({ enGeneration: false, genererCycle: vi.fn() }),
}));

import { VuePlanningCycle } from "@/components/planning/vue-cycle";
import { MESSAGES_EDITION } from "@/lib/edition-slot";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.editerSlot.mockReset();
  m.modifierSlotDistant.mockReset();
  m.modifierSlotDistant.mockResolvedValue(undefined);
  m.barriereLecture = null;
  localStorage.clear(); // journal des modifications en attente (PR #405)
  for (const f of [toast, toast.error, toast.success, toast.warning, toast.dismiss]) vi.mocked(f).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Boutons « Changer le dîner » de la grille (14 cellules × 2 paliers), ciblés
// par leur aria-label : une requête par rôle avec `name` calcule le rôle, la
// visibilité et le nom accessible de chaque élément (~1 000 nœuds), et coûtait
// ~2 s sous la charge de la suite complète, assez pour dépasser le délai du
// test (#403).
const CHANGER_DINER = /^Changer le dîner/;

// Le dernier « Changer » de la grille : dernier jour du cycle, jamais passé
// (pas de confirmation RG-24 à traverser).
async function afficherEtChanger(): Promise<void> {
  render(<VuePlanningCycle idsModifiables={new Set()} vue="cycle" onChangerVue={() => {}} />);
  const boutons = await screen.findAllByLabelText(CHANGER_DINER);
  fireEvent.click(boutons[boutons.length - 1]);
}

function editionReussie(avertissements: string[] = []) {
  m.editerSlot.mockImplementation((p: Planning, jour: JourPlanning["jour"]) => {
    const precedent = p.jours.find((j) => j.jour === jour)!;
    return {
      ok: true,
      precedent,
      jour: { ...precedent, diner: recette("nouvelle") },
      planning: p,
      avertissements,
    };
  });
}

describe("VuePlanningCycle : retours d'édition alignés sur la vue Semaine (#373)", () => {
  it("« Changer » toaste les avertissements RG-26/27/28, dans l'ordre, après « Recette remplacée »", async () => {
    editionReussie(["vege", "legume", "saison"]);
    await afficherEtChanger();

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(3));
    expect(vi.mocked(toast.warning).mock.calls.map((c) => c[0])).toEqual([
      MESSAGES_EDITION.avertissements.vege,
      MESSAGES_EDITION.avertissements.legume,
      MESSAGES_EDITION.avertissements.saison,
    ]);
    expect(toast).toHaveBeenCalledWith(MESSAGES_EDITION.remplacee, expect.anything());
  });

  it("Ctrl+Z annule la dernière édition (ancien repas réécrit) et affiche « Annulé »", async () => {
    editionReussie();
    await afficherEtChanger();
    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledTimes(2));
    const [, jourRejoue] = m.modifierSlotDistant.mock.calls[1] as [string, JourPlanning];
    expect(jourRejoue.diner?.id).toBe("s-dimanche");
    expect(toast.success).toHaveBeenCalledWith("Annulé");
    expect(toast.dismiss).toHaveBeenCalledWith("annulation-slot-cycle");

    // Un seul cran : un second Ctrl+Z ne fait rien.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.modifierSlotDistant).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("le bouton « Annuler » du toast affiche aussi « Annulé »", async () => {
    editionReussie();
    await afficherEtChanger();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(MESSAGES_EDITION.remplacee, expect.anything()));
    const options = vi.mocked(toast).mock.calls.at(-1)![1] as unknown as { action: { onClick: () => void } };

    act(() => options.action.onClick());

    expect(toast.success).toHaveBeenCalledWith("Annulé");
    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledTimes(2));
  });

  it("Ctrl+Z après la fenêtre du toast (5 s) : rien n'est annulé, Ctrl+Z laissé au navigateur", async () => {
    editionReussie();
    await afficherEtChanger();
    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledTimes(1));
    const maintenant = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(maintenant + 6000);

    const evenement = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    window.dispatchEvent(evenement);

    expect(evenement.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("écriture en échec (état revenu au confirmé) : Ctrl+Z n'annule plus rien", async () => {
    editionReussie();
    m.modifierSlotDistant.mockRejectedValue(new Error("réseau"));
    await afficherEtChanger();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible d'enregistrer la modification. Réessaie."));
    await act(async () => {}); // rendu + effets de l'échec (un humain ne frappe pas dans la même microtâche)

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(toast.success).not.toHaveBeenCalled();
    expect(m.modifierSlotDistant).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Z dans un champ de saisie : ignoré", async () => {
    editionReussie();
    await afficherEtChanger();
    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledTimes(1));
    const champ = document.createElement("input");
    document.body.appendChild(champ);

    fireEvent.keyDown(champ, { key: "z", ctrlKey: true });

    expect(toast.success).not.toHaveBeenCalled();
    champ.remove();
  });

  it("aucune recette disponible : message inline sur le créneau, effacé par l'édition réussie suivante", async () => {
    m.editerSlot.mockReturnValue({ ok: false, motif: "indisponible" });
    await afficherEtChanger();

    // Un seul créneau marqué, rendu par les deux paliers de la grille (mobile + desktop).
    const alertes = await screen.findAllByRole("alert");
    expect(alertes).toHaveLength(2);
    for (const a of alertes) expect(a.textContent).toBe("Pas de recette disponible");
    expect(toast.error).toHaveBeenCalledWith(MESSAGES_EDITION.indisponible);

    editionReussie();
    const boutons = screen.getAllByLabelText(CHANGER_DINER);
    fireEvent.click(boutons[boutons.length - 1]);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("VuePlanningCycle : squelette du premier chargement (#400)", () => {
  it("lecture en attente : un seul role=status, titre réel et grille « Déjeuner » ; plus aucun une fois le cycle lu", async () => {
    let lire!: () => void;
    m.barriereLecture = new Promise<void>((r) => (lire = r));
    const { container } = render(
      <VuePlanningCycle idsModifiables={new Set()} vue="cycle" onChangerVue={() => {}} />
    );

    // Un seul rôle status, annonçant « Chargement… » ; le titre est du vrai texte (aria-hidden).
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toContain("Chargement…");
    expect(container.querySelector("h1")?.textContent).toBe("Mon planning du cycle");
    // 7 jours × grilles mobile et desktop.
    expect(screen.getAllByText("Déjeuner")).toHaveLength(14);

    await act(async () => lire());

    await screen.findAllByLabelText(CHANGER_DINER);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });
});

// Écriture d'une page précédente restée en attente (rechargement pendant une
// écriture en vol, PR #405) : rejouée AVANT la lecture du cycle, sinon la vue
// afficherait la base d'avant l'annulation.
describe("VuePlanningCycle : rejeu des modifications en attente", () => {
  it("rejoue le journal avant de lire le cycle, puis le vide", async () => {
    const enAttente = { jour: "lundi", diner: recette("origine") };
    localStorage.setItem(
      "slots_cycle_en_attente",
      JSON.stringify({ "2026-W46|lundi": { semaine: "2026-W46", jour: enAttente } })
    );
    let ecrit!: () => void;
    m.modifierSlotDistant.mockReturnValue(new Promise<void>((r) => (ecrit = r)));
    render(<VuePlanningCycle idsModifiables={new Set()} vue="cycle" onChangerVue={() => {}} />);

    await waitFor(() => expect(m.modifierSlotDistant).toHaveBeenCalledWith("2026-W46", enAttente));
    // Lecture du cycle pas encore faite : toujours le squelette.
    expect(screen.getAllByRole("status")).toHaveLength(1);

    await act(async () => ecrit());
    await screen.findAllByLabelText(CHANGER_DINER);
    expect(localStorage.getItem("slots_cycle_en_attente")).toBeNull();
  });
});
