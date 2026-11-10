// File d'écriture par jour de la vue Cycle (#301) — débounce, sérialisation
// par (semaine, jour), retour à l'état confirmé en cas d'échec. Pur : la
// fonction d'écriture et le callback d'échec sont injectés.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerFileEcritureSlots, DELAI_STEPPER_MS } from "@/lib/file-ecriture-slots";
import type { JourPlanning } from "@/types";

function jp(jour: JourPlanning["jour"], personnes: number): JourPlanning {
  return {
    jour,
    diner: { id: "r1", nom: "R1", tempsPreparation: "rapide", ingredients: [] },
    personnes: { diner: personnes },
  };
}

// Promesse résolue/rejetée à la main, pour contrôler une écriture « en vol ».
function differee() {
  let resoudre!: () => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<void>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("creerFileEcritureSlots (#301)", () => {
  it("délai 0 : écrit immédiatement", () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn() });

    file.planifier("W12", jp("lundi", 3), { delaiMs: 0, precedent: jp("lundi", 2) });

    expect(ecrire).toHaveBeenCalledWith("W12", jp("lundi", 3));
  });

  it("rafale débouncée : une seule écriture, avec la dernière valeur", () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn() });

    file.planifier("W12", jp("lundi", 3), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 2) });
    vi.advanceTimersByTime(100);
    file.planifier("W12", jp("lundi", 4), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 3) });
    vi.advanceTimersByTime(100);
    file.planifier("W12", jp("lundi", 5), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 4) });
    vi.advanceTimersByTime(799);
    expect(ecrire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(ecrire).toHaveBeenCalledTimes(1);
    expect(ecrire).toHaveBeenCalledWith("W12", jp("lundi", 5));
  });

  it("échec : surEchec reçoit l'état d'AVANT la rafale", async () => {
    const ecrire = vi.fn().mockRejectedValue(new Error("réseau"));
    const surEchec = vi.fn();
    const file = creerFileEcritureSlots({ ecrire, surEchec });

    file.planifier("W12", jp("lundi", 3), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 2) });
    file.planifier("W12", jp("lundi", 4), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 3) });
    await vi.advanceTimersByTimeAsync(800);

    expect(surEchec).toHaveBeenCalledTimes(1);
    expect(surEchec).toHaveBeenCalledWith("W12", jp("lundi", 2), expect.any(Error));
  });

  it("sérialisation par jour : pas de 2e écriture tant que la 1re est en vol", async () => {
    const premiere = differee();
    const ecrire = vi.fn().mockReturnValueOnce(premiere.promesse).mockResolvedValue(undefined);
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn() });

    file.planifier("W12", jp("lundi", 3), { delaiMs: 0, precedent: jp("lundi", 2) });
    file.planifier("W12", jp("lundi", 4), { delaiMs: 0, precedent: jp("lundi", 3) });
    expect(ecrire).toHaveBeenCalledTimes(1);

    premiere.resoudre();
    await vi.advanceTimersByTimeAsync(0);

    expect(ecrire).toHaveBeenCalledTimes(2);
    expect(ecrire).toHaveBeenLastCalledWith("W12", jp("lundi", 4));
  });

  it("clés indépendantes : deux jours partent séparément", () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn() });

    file.planifier("W12", jp("lundi", 3), { delaiMs: 0, precedent: jp("lundi", 2) });
    file.planifier("W12", jp("mardi", 3), { delaiMs: 0, precedent: jp("mardi", 2) });

    expect(ecrire).toHaveBeenCalledTimes(2);
  });

  it("succès puis échec : on revient à la dernière valeur écrite", async () => {
    const ecrire = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("réseau"));
    const surEchec = vi.fn();
    const file = creerFileEcritureSlots({ ecrire, surEchec });

    file.planifier("W12", jp("lundi", 3), { delaiMs: 0, precedent: jp("lundi", 2) });
    await vi.advanceTimersByTimeAsync(0);
    file.planifier("W12", jp("lundi", 4), { delaiMs: 0, precedent: jp("lundi", 3) });
    await vi.advanceTimersByTimeAsync(0);

    expect(surEchec).toHaveBeenCalledWith("W12", jp("lundi", 3), expect.any(Error));
  });

  it("vider() envoie immédiatement les écritures débouncées et attend leur fin", async () => {
    const ecriture = differee();
    const ecrire = vi.fn().mockReturnValue(ecriture.promesse);
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn() });
    let fini = false;

    file.planifier("W12", jp("lundi", 3), { delaiMs: DELAI_STEPPER_MS, precedent: jp("lundi", 2) });
    const p = file.vider().then(() => {
      fini = true;
    });
    expect(ecrire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(false);

    ecriture.resoudre();
    await p;
    expect(fini).toBe(true);
  });
});

// Journal des écritures non confirmées : une page rechargée pendant une
// écriture en vol perdait la valeur suivante, mise en file derrière (Ctrl+Z
// juste après « Changer » : l'annulation n'était jamais envoyée). La file
// pose chaque valeur voulue dans le journal et l'en retire une fois le jour
// réglé (écrit, ou refusé et remis à l'écran).
describe("creerFileEcritureSlots : journal des écritures non confirmées", () => {
  function journalFactice(quittee = false) {
    const poses: Map<string, JourPlanning> = new Map();
    return {
      poses,
      journal: {
        poser: (semaine: string, jour: JourPlanning) => void poses.set(`${semaine}|${jour.jour}`, jour),
        retirer: (semaine: string, nom: JourPlanning["jour"]) => void poses.delete(`${semaine}|${nom}`),
        pageQuittee: () => quittee,
      },
    };
  }

  it("valeur en file derrière une écriture en vol : journalisée jusqu'à son écriture", async () => {
    const vols = [differee(), differee()];
    let n = 0;
    const ecrire = vi.fn(() => vols[n++].promesse);
    const { poses, journal } = journalFactice();
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn(), journal });

    file.planifier("2026-W46", jp("lundi", 4), { delaiMs: 0, precedent: jp("lundi", 2) });
    file.planifier("2026-W46", jp("lundi", 2), { delaiMs: 0, precedent: jp("lundi", 4) }); // Ctrl+Z
    expect(poses.get("2026-W46|lundi")).toEqual(jp("lundi", 2));

    vols[0].resoudre();
    await vi.waitFor(() => expect(ecrire).toHaveBeenCalledTimes(2));
    expect(poses.has("2026-W46|lundi")).toBe(true); // annulation encore en vol
    vols[1].resoudre();
    await vi.waitFor(() => expect(poses.has("2026-W46|lundi")).toBe(false));
  });

  it("valeur débouncée (stepper) : journalisée dès le clic, avant tout envoi", () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    const { poses, journal } = journalFactice();
    const file = creerFileEcritureSlots({ ecrire, surEchec: vi.fn(), journal });

    file.planifier("2026-W46", jp("mardi", 3), { delaiMs: DELAI_STEPPER_MS, precedent: jp("mardi", 2) });
    expect(ecrire).not.toHaveBeenCalled();
    expect(poses.get("2026-W46|mardi")).toEqual(jp("mardi", 3));
  });

  it("échec (écran remis au confirmé) : retirée du journal", async () => {
    const ecrire = vi.fn().mockRejectedValue(new Error("réseau"));
    const { poses, journal } = journalFactice();
    const surEchec = vi.fn();
    const file = creerFileEcritureSlots({ ecrire, surEchec, journal });

    file.planifier("2026-W46", jp("lundi", 4), { delaiMs: 0, precedent: jp("lundi", 2) });
    await vi.waitFor(() => expect(surEchec).toHaveBeenCalled());
    expect(poses.size).toBe(0);
  });

  it("échec après que la page a été quittée (requête coupée) : gardée dans le journal", async () => {
    const ecrire = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const { poses, journal } = journalFactice(true);
    const surEchec = vi.fn();
    const file = creerFileEcritureSlots({ ecrire, surEchec, journal });

    file.planifier("2026-W46", jp("lundi", 4), { delaiMs: 0, precedent: jp("lundi", 2) });
    await vi.waitFor(() => expect(surEchec).toHaveBeenCalled());
    expect(poses.get("2026-W46|lundi")).toEqual(jp("lundi", 4));
  });
});
