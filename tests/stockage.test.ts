// Tests du snapshot d'annulation (US-09, RG-19) — lib/stockage.ts.
//
// Les fonctions de snapshot manipulent les valeurs brutes de localStorage :
// on écrit donc des chaînes arbitraires (pas besoin de fixture Planning) pour
// vérifier le cycle capture → écrasement → restauration. jsdom fournit un vrai
// localStorage, partagé par les stores.

import { beforeEach, describe, expect, it } from "vitest";
import {
  storePlanning,
  storeCoches,
  capturerSnapshotAnnulation,
  restaurerSnapshotAnnulation,
} from "@/lib/stockage";

beforeEach(() => {
  localStorage.clear();
});

describe("snapshot d'annulation (US-09, RG-19)", () => {
  it("restaure le planning ET les coches à l'identique après une regénération", () => {
    storePlanning.ecrire("PLANNING_A");
    storeCoches.ecrire("COCHES_A");

    // Avant l'action destructive.
    capturerSnapshotAnnulation(1000);

    // Regénération : planning écrasé + coches effacées (RG-13).
    storePlanning.ecrire("PLANNING_B");
    storeCoches.effacer();
    expect(storePlanning.lire()).toBe("PLANNING_B");
    expect(storeCoches.lire()).toBeNull();

    // Annulation dans la fenêtre.
    expect(restaurerSnapshotAnnulation(2000)).toBe(true);
    expect(storePlanning.lire()).toBe("PLANNING_A");
    expect(storeCoches.lire()).toBe("COCHES_A");
  });

  it("restaure l'absence de coches (efface des coches faites après capture)", () => {
    storePlanning.ecrire("P");
    // Aucune coche au moment de la capture.
    capturerSnapshotAnnulation(1000);

    storePlanning.ecrire("P2");
    storeCoches.ecrire("COCHES_POSTERIEURES");

    expect(restaurerSnapshotAnnulation(1500)).toBe(true);
    expect(storePlanning.lire()).toBe("P");
    expect(storeCoches.lire()).toBeNull();
  });

  it("ne propose qu'un seul cran d'undo (snapshot purgé après restauration)", () => {
    storePlanning.ecrire("A");
    capturerSnapshotAnnulation(1000);
    storePlanning.ecrire("B");

    expect(restaurerSnapshotAnnulation(1500)).toBe(true);
    // Seconde tentative : plus rien à restaurer.
    expect(restaurerSnapshotAnnulation(1600)).toBe(false);
    expect(storePlanning.lire()).toBe("A");
  });

  it("ne capture rien à la première génération (aucun planning préalable)", () => {
    // localStorage vide : pas de planning.
    capturerSnapshotAnnulation(1000);
    expect(restaurerSnapshotAnnulation(1500)).toBe(false);
  });

  it("ignore un snapshot expiré et le purge sans restaurer (RG-19)", () => {
    storePlanning.ecrire("A");
    capturerSnapshotAnnulation(1000);
    storePlanning.ecrire("B");

    // Au-delà de la fenêtre d'undo (~6 s) : pas de restauration.
    expect(restaurerSnapshotAnnulation(1000 + 6001)).toBe(false);
    expect(storePlanning.lire()).toBe("B");
    // Le snapshot a été purgé : même une demande dans les temps échoue ensuite.
    expect(restaurerSnapshotAnnulation(1000)).toBe(false);
  });

  it("renvoie false quand aucun snapshot n'existe", () => {
    expect(restaurerSnapshotAnnulation(1000)).toBe(false);
  });
});
