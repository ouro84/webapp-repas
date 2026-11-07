// Sélecteur de jour de courses partagé (#386) : ancre du cycle de courses
// (RG-90), employé par /profil (PanneauFoyer) et le tunnel /bienvenue (US-23).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelecteurJourCourses } from "@/components/ui/selecteur-jour-courses";

afterEach(cleanup);

describe("SelecteurJourCourses", () => {
  it("coche le jour courant", () => {
    render(<SelecteurJourCourses valeur={6} onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(
      screen.getByRole("radio", { name: "samedi" }).getAttribute("aria-checked")
    ).toBe("true");
    for (const nom of ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "dimanche"]) {
      expect(
        screen.getByRole("radio", { name: nom }).getAttribute("aria-checked")
      ).toBe("false");
    }
  });

  it("signale le jour choisi", () => {
    const onChange = vi.fn();
    render(<SelecteurJourCourses valeur={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "jeudi" }));
    expect(onChange).toHaveBeenCalledWith(4, "jeudi");
  });

  it("désactivé, ne signale rien", () => {
    const onChange = vi.fn();
    render(<SelecteurJourCourses valeur={2} onChange={onChange} desactive />);
    for (const bouton of screen.getAllByRole("radio")) {
      expect((bouton as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole("radio", { name: "jeudi" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
