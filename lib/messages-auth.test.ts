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

  test("compte déjà existant (signup)", () => {
    expect(traduireErreurAuth({ code: "user_already_exists" })).toMatch(
      /existe déjà/
    );
    expect(traduireErreurAuth({ code: "email_exists" })).toMatch(/existe déjà/);
  });

  test("mot de passe trop court", () => {
    expect(traduireErreurAuth({ code: "weak_password" })).toMatch(
      /au moins 6 caractères/
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
    ).toMatch(/6 caractères/);
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
    ).toMatch(/6 caractères/);
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
