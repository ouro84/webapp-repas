// Tests de la traduction des erreurs d'auth Supabase (#58).
// Mapping par code en priorité, repli sur le message anglais, puis générique.

import { describe, test, expect } from "vitest";
import { traduireErreurAuth } from "@/lib/messages-auth";

describe("traduireErreurAuth — mapping par code (#58)", () => {
  test("identifiants invalides", () => {
    expect(traduireErreurAuth({ code: "invalid_credentials" })).toBe(
      "Email ou mot de passe incorrect. Vérifie ta saisie ou inscris-toi."
    );
  });

  test("compte déjà existant — contexte connexion : message explicite", () => {
    expect(traduireErreurAuth({ code: "user_already_exists" })).toMatch(
      /existe déjà/
    );
    expect(traduireErreurAuth({ code: "email_exists" })).toMatch(/existe déjà/);
  });

  test("mot de passe trop faible (court / simple / compromis)", () => {
    expect(traduireErreurAuth({ code: "weak_password" })).toMatch(
      /au moins 8 caractères/
    );
  });

  test("mot de passe compromis (HIBP) → message robuste (#189)", () => {
    expect(
      traduireErreurAuth({ message: "Password is known to be weak and easy to guess" })
    ).toMatch(/compromis/);
    expect(traduireErreurAuth({ message: "This password is pwned" })).toMatch(
      /compromis/
    );
  });

  test("limite de débit", () => {
    expect(traduireErreurAuth({ code: "over_request_rate_limit" })).toMatch(
      /Trop de tentatives/
    );
  });

  test("email invalide", () => {
    expect(traduireErreurAuth({ code: "email_address_invalid" })).toBe(
      "Adresse email invalide."
    );
  });
});

describe("traduireErreurAuth — anti-énumération à l'inscription (F-05)", () => {
  test("contexte signup : compte existant → message NEUTRE (ne révèle pas l'existence)", () => {
    const neutre = traduireErreurAuth({ code: "user_already_exists" }, "signup");
    expect(neutre).not.toMatch(/existe déjà/);
    expect(neutre).toMatch(/Inscription impossible/);
    expect(traduireErreurAuth({ code: "email_exists" }, "signup")).toBe(neutre);
    expect(
      traduireErreurAuth({ message: "User already registered" }, "signup")
    ).toBe(neutre);
  });

  test("contexte signup : les autres erreurs restent spécifiques", () => {
    expect(traduireErreurAuth({ code: "weak_password" }, "signup")).toMatch(
      /8 caractères/
    );
    expect(
      traduireErreurAuth({ code: "email_address_invalid" }, "signup")
    ).toBe("Adresse email invalide.");
  });
});

describe("traduireErreurAuth — repli sur le message anglais", () => {
  test("« Invalid login credentials » (SDK sans code)", () => {
    expect(
      traduireErreurAuth({ message: "Invalid login credentials" })
    ).toMatch(/incorrect/);
  });

  test("« User already registered »", () => {
    expect(
      traduireErreurAuth({ message: "User already registered" })
    ).toMatch(/existe déjà/);
  });

  test("« Password should be at least 6 characters »", () => {
    expect(
      traduireErreurAuth({ message: "Password should be at least 6 characters" })
    ).toMatch(/8 caractères/);
  });

  test("insensible à la casse", () => {
    expect(
      traduireErreurAuth({ message: "INVALID LOGIN CREDENTIALS" })
    ).toMatch(/incorrect/);
  });

  test("le code prime sur le message si les deux sont présents", () => {
    expect(
      traduireErreurAuth({
        code: "weak_password",
        message: "Invalid login credentials",
      })
    ).toMatch(/8 caractères/);
  });
});

describe("traduireErreurAuth — repli générique", () => {
  const GENERIQUE = "Une erreur est survenue. Réessaie dans un instant.";

  test("code inconnu", () => {
    expect(traduireErreurAuth({ code: "some_new_code_2030" })).toBe(GENERIQUE);
  });

  test("message inconnu", () => {
    expect(traduireErreurAuth({ message: "Teapot is on fire" })).toBe(GENERIQUE);
  });

  test("erreur nulle ou vide", () => {
    expect(traduireErreurAuth(null)).toBe(GENERIQUE);
    expect(traduireErreurAuth({})).toBe(GENERIQUE);
  });

  test("ne renvoie jamais le texte brut anglais de Supabase", () => {
    const messagesBruts = [
      "Invalid login credentials",
      "User already registered",
      "Email not confirmed",
    ];
    for (const message of messagesBruts) {
      expect(traduireErreurAuth({ message })).not.toBe(message);
    }
  });
});
