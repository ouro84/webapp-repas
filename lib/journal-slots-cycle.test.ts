// Journal des écritures de la vue Cycle non confirmées : rejoué au chargement
// suivant de la vue, avant la lecture du cycle (Ctrl+Z ou « Changer » suivi
// d'un rechargement immédiat : l'écriture en file était perdue).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JourPlanning } from "@/types";

const CLE = "slots_cycle_en_attente";

function jp(jour: JourPlanning["jour"], id: string): JourPlanning {
  return { jour, diner: { id, nom: id, tempsPreparation: "rapide", ingredients: [] } };
}

async function module() {
  vi.resetModules();
  return import("@/lib/journal-slots-cycle");
}

beforeEach(() => {
  localStorage.clear();
});

describe("journal des écritures de la vue Cycle", () => {
  it("poser puis retirer : la dernière valeur par (semaine, jour), clé vidée à la fin", async () => {
    const { journaliserSlot, retirerSlot } = await module();
    journaliserSlot("2026-W46", jp("lundi", "a"));
    journaliserSlot("2026-W46", jp("lundi", "b"));
    journaliserSlot("2026-W46", jp("mardi", "c"));
    expect(JSON.parse(localStorage.getItem(CLE)!)).toEqual({
      "2026-W46|lundi": { semaine: "2026-W46", jour: jp("lundi", "b") },
      "2026-W46|mardi": { semaine: "2026-W46", jour: jp("mardi", "c") },
    });
    retirerSlot("2026-W46", "lundi");
    retirerSlot("2026-W46", "mardi");
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  it("rejeu : chaque valeur en attente est écrite puis retirée", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({ "2026-W46|lundi": { semaine: "2026-W46", jour: jp("lundi", "orig") } })
    );
    const { rejouerSlotsEnAttente } = await module();
    const ecrire = vi.fn().mockResolvedValue(undefined);

    await rejouerSlotsEnAttente(ecrire);

    expect(ecrire).toHaveBeenCalledWith("2026-W46", jp("lundi", "orig"));
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  it("rejeu en échec : journalisé et abandonné (pas d'écriture périmée rejouée plus tard)", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({ "2026-W46|lundi": { semaine: "2026-W46", jour: jp("lundi", "orig") } })
    );
    const { rejouerSlotsEnAttente } = await module();
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await rejouerSlotsEnAttente(vi.fn().mockRejectedValue(new Error("réseau")));
      expect(erreur).toHaveBeenCalledWith("Modification du cycle en attente non rejouée.", expect.any(Error));
      expect(localStorage.getItem(CLE)).toBeNull();
    } finally {
      erreur.mockRestore();
    }
  });

  it("double montage (StrictMode) : un seul rejeu", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({ "2026-W46|lundi": { semaine: "2026-W46", jour: jp("lundi", "orig") } })
    );
    const { rejouerSlotsEnAttente } = await module();
    const ecrire = vi.fn().mockResolvedValue(undefined);
    await Promise.all([rejouerSlotsEnAttente(ecrire), rejouerSlotsEnAttente(ecrire)]);
    expect(ecrire).toHaveBeenCalledTimes(1);
  });

  it("pageQuittee : vraie dès beforeunload (Chromium coupe les requêtes avant pagehide), rétablie par pageshow", async () => {
    const { pageQuittee } = await module();
    expect(pageQuittee()).toBe(false);
    window.dispatchEvent(new Event("beforeunload"));
    expect(pageQuittee()).toBe(true);
    window.dispatchEvent(new Event("pageshow"));
    expect(pageQuittee()).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(pageQuittee()).toBe(true);
    window.dispatchEvent(new Event("pageshow"));
  });
});
