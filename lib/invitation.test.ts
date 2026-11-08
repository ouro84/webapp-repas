import { beforeEach, describe, expect, it } from "vitest";
import { capterCodeDepuisURL } from "@/lib/invitation";

// Collision ?code sur /auth/* (US-57, D14) : le lien de réinitialisation du mot
// de passe arrive en `/auth/reinitialiser?code=<pkce>` (createBrowserClient force
// PKCE). Ce code appartient à Supabase, pas à une invitation de foyer.

const CLE = "code_invitation_en_attente";

describe("capterCodeDepuisURL", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("ignore le code PKCE d’un chemin /auth/* : ni capté, ni retiré de l’URL", () => {
    window.history.replaceState(null, "", "/auth/reinitialiser?code=abc-123");

    expect(capterCodeDepuisURL()).toBeNull();
    expect(sessionStorage.getItem(CLE)).toBeNull();
    expect(window.location.search).toBe("?code=abc-123");
  });

  it("renvoie le code déjà en attente sur /auth/* sans toucher à l’URL", () => {
    sessionStorage.setItem(CLE, "ABCD2345");
    window.history.replaceState(null, "", "/auth/reinitialiser?code=abc-123");

    expect(capterCodeDepuisURL()).toBe("ABCD2345");
    expect(window.location.search).toBe("?code=abc-123");
  });

  it("capte toujours le code d’invitation sur /signup (non-régression)", () => {
    window.history.replaceState(null, "", "/signup?code=abcd2345");

    expect(capterCodeDepuisURL()).toBe("ABCD2345");
    expect(sessionStorage.getItem(CLE)).toBe("ABCD2345");
    expect(window.location.search).toBe("");
  });
});
