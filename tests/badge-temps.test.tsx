// Tests du BadgeTemps (components/planning/badge-temps.tsx, #209).
// Verrouille l'échelle d'horloges graduées : rien (rapide) / 1 (normal) / 2
// (long) — le repère visuel qui rend l'échelle de temps lisible.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BadgeTemps } from "@/components/planning/badge-temps";

afterEach(cleanup);

describe("BadgeTemps", () => {
  it("affiche le libellé de chaque temps", () => {
    expect(render(<BadgeTemps temps="rapide" />).container.textContent).toContain("Rapide");
    cleanup();
    expect(render(<BadgeTemps temps="normal" />).container.textContent).toContain("Normal");
    cleanup();
    expect(render(<BadgeTemps temps="long" />).container.textContent).toContain("Long");
  });

  it("gradue les horloges selon la durée (0 / 1 / 2)", () => {
    expect(render(<BadgeTemps temps="rapide" />).container.querySelectorAll("svg")).toHaveLength(0);
    cleanup();
    expect(render(<BadgeTemps temps="normal" />).container.querySelectorAll("svg")).toHaveLength(1);
    cleanup();
    expect(render(<BadgeTemps temps="long" />).container.querySelectorAll("svg")).toHaveLength(2);
  });
});
