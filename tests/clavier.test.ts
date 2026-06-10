// Tests du calcul de hauteur occultée par le clavier virtuel (lib/clavier.ts,
// #98). Cœur pur extrait pour être testable sans visualViewport (jsdom ne
// l'implémente pas).

import { describe, expect, it } from "vitest";
import { hauteurOccultee } from "@/lib/clavier";

describe("hauteurOccultee", () => {
  it("renvoie 0 quand le clavier est fermé (viewport visuel = fenêtre)", () => {
    expect(hauteurOccultee(844, 844, 0)).toBe(0);
  });

  it("renvoie la portion masquée par le clavier", () => {
    // Clavier de 300 px en bas d'une fenêtre de 844 px.
    expect(hauteurOccultee(844, 544, 0)).toBe(300);
  });

  it("soustrait le panoramique (offsetTop) du visual viewport", () => {
    // Le navigateur a fait défiler le contenu de 50 px sous le clavier.
    expect(hauteurOccultee(844, 544, 50)).toBe(250);
  });

  it("ne renvoie jamais de valeur négative", () => {
    // Cas limite : viewport visuel plus grand que la fenêtre (barres masquées).
    expect(hauteurOccultee(844, 900, 0)).toBe(0);
  });
});
