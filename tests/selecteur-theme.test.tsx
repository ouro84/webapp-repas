// Tests du sélecteur de thème (components/ui/selecteur-theme.tsx, #205).
// Le contrôle déplacé de la nav vers /profil doit exposer 3 options et refléter
// la préférence courante (store lib/theme.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelecteurTheme } from "@/components/ui/selecteur-theme";

beforeEach(() => {
  localStorage.clear();
  // jsdom n'implémente pas matchMedia (utilisé par la résolution « système »).
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SelecteurTheme", () => {
  it("expose un radiogroup avec les 3 options de thème", () => {
    render(<SelecteurTheme />);
    expect(screen.getByRole("radiogroup", { name: "Thème de l’application" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Système" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Clair" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sombre" })).toBeTruthy();
  });

  it("sélectionne « Système » par défaut (aucune préférence stockée)", () => {
    render(<SelecteurTheme />);
    expect(
      screen.getByRole("radio", { name: "Système" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("change la préférence au clic et la persiste", () => {
    render(<SelecteurTheme />);
    fireEvent.click(screen.getByRole("radio", { name: "Sombre" }));
    expect(
      screen.getByRole("radio", { name: "Sombre" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Système" }).getAttribute("aria-checked")
    ).toBe("false");
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
