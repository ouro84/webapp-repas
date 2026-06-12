// Tests unitaires de l'avatar à initiales — #22 PR1, RG-35.
//   - initiale : majuscule, espaces de tête, repli "?" sur vide
//   - couleurAvatar : déterministe, dans la palette, répartition sur emails
//   - couleurValide : garde-fou palette

import { describe, test, expect } from "vitest";
import {
  PALETTE_AVATAR,
  couleurAvatar,
  couleurValide,
  initiale,
} from "@/lib/avatar";

describe("initiale", () => {
  test("première lettre en majuscule", () => {
    expect(initiale("arnaud")).toBe("A");
    expect(initiale("Bastien")).toBe("B");
  });

  test("ignore les espaces de tête", () => {
    expect(initiale("  léa")).toBe("L");
  });

  test("accentuée conservée et mise en majuscule", () => {
    expect(initiale("élodie")).toBe("É");
  });

  test("repli '?' sur prénom vide, null ou undefined", () => {
    expect(initiale("")).toBe("?");
    expect(initiale("   ")).toBe("?");
    expect(initiale(null)).toBe("?");
    expect(initiale(undefined)).toBe("?");
  });
});

describe("couleurAvatar", () => {
  test("déterministe : un même email retombe sur la même teinte", () => {
    expect(couleurAvatar("arnaud@example.com")).toBe(
      couleurAvatar("arnaud@example.com")
    );
  });

  test("insensible à la casse et aux espaces", () => {
    expect(couleurAvatar("  Arnaud@Example.com ")).toBe(
      couleurAvatar("arnaud@example.com")
    );
  });

  test("toujours une teinte de la palette", () => {
    for (const email of ["a@b.c", "x@y.z", "long.prenom@domaine.fr", "u@v.w"]) {
      expect(PALETTE_AVATAR).toContain(couleurAvatar(email));
    }
  });

  test("email vide / null → teinte par défaut (première de la palette)", () => {
    expect(couleurAvatar("")).toBe(PALETTE_AVATAR[0]);
    expect(couleurAvatar(null)).toBe(PALETTE_AVATAR[0]);
    expect(couleurAvatar(undefined)).toBe(PALETTE_AVATAR[0]);
  });

  test("répartit des emails distincts sur plusieurs teintes", () => {
    const emails = Array.from({ length: 40 }, (_, i) => `membre${i}@foyer.fr`);
    const teintes = new Set(emails.map((e) => couleurAvatar(e)));
    // Pas un test de hash parfait : on vérifie juste qu'on n'écrase pas tout
    // sur une seule couleur (au moins la moitié de la palette est touchée).
    expect(teintes.size).toBeGreaterThanOrEqual(PALETTE_AVATAR.length / 2);
  });
});

describe("couleurValide", () => {
  test("renvoie la couleur si elle est dans la palette", () => {
    expect(couleurValide(PALETTE_AVATAR[2])).toBe(PALETTE_AVATAR[2]);
  });

  test("renvoie null pour une couleur hors palette ou vide", () => {
    expect(couleurValide("#000000")).toBeNull();
    expect(couleurValide("rouge")).toBeNull();
    expect(couleurValide("")).toBeNull();
    expect(couleurValide(null)).toBeNull();
    expect(couleurValide(undefined)).toBeNull();
  });
});
