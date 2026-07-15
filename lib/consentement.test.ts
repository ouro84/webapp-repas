// Tests unitaires du consentement analytics (#236, US-30) — bandeau cookies.
//
// resoudreConsentement est la logique pure de décision (aucune dépendance au
// DOM) : Do Not Track prime toujours, sinon on lit le choix stocké, sinon
// aucun choix n'est fait (null → le bandeau doit s'afficher).

import { describe, test, expect } from "vitest";
import { resoudreConsentement, consentementDepuisChoix } from "@/lib/consentement";

describe("resoudreConsentement — priorité Do Not Track", () => {
  test("DNT actif force le refus, quel que soit le choix stocké", () => {
    expect(resoudreConsentement("true", true)).toBe(false);
    expect(resoudreConsentement("false", true)).toBe(false);
    expect(resoudreConsentement(null, true)).toBe(false);
  });
});

describe("resoudreConsentement — choix stocké (DNT inactif)", () => {
  test("aucun choix stocké → null (bandeau à afficher)", () => {
    expect(resoudreConsentement(null, false)).toBeNull();
  });

  test("choix accepté stocké → true", () => {
    expect(resoudreConsentement("true", false)).toBe(true);
  });

  test("choix refusé stocké → false", () => {
    expect(resoudreConsentement("false", false)).toBe(false);
  });

  test("valeur stockée corrompue/inattendue → null (comme absente)", () => {
    expect(resoudreConsentement("n'importe quoi", false)).toBeNull();
  });
});

describe("consentementDepuisChoix — accesseur boolean pour PostHog (US-37, point d'accroche)", () => {
  test("faux tant qu'aucun choix explicite n'a été fait", () => {
    expect(consentementDepuisChoix(null)).toBe(false);
  });

  test("faux si refusé", () => {
    expect(consentementDepuisChoix(false)).toBe(false);
  });

  test("vrai uniquement si accepté explicitement", () => {
    expect(consentementDepuisChoix(true)).toBe(true);
  });
});
