// Parcours #235/#236 (US-29/US-30) — pages légales, bandeau cookies,
// révocation du consentement depuis /profil. Compte de test PARTAGÉ pour la
// révocation (storageState par défaut du projet e2e-partage) ; contextes
// VIERGES pour les pages légales/le bandeau (comportement indépendant de la
// connexion).

import { test, expect } from "./fixtures";
import { reinitialiserConsentementDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reinitialiserConsentementDistant(request);
});
test.afterAll(async ({ request }) => {
  await reinitialiserConsentementDistant(request);
});

// ---------------------------------------------------------------------------
// Pages légales — accessibles déconnecté (#235)
// ---------------------------------------------------------------------------
test.describe("pages légales — déconnecté", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [slug, titre] of [
    ["cgu", "Conditions générales d'utilisation"],
    ["confidentialite", "Politique de confidentialité"],
    ["mentions-legales", "Mentions légales"],
  ] as const) {
    test(`/legal/${slug} est accessible sans connexion`, async ({ page }) => {
      await page.goto(`/legal/${slug}`);
      await expect(page.getByRole("heading", { name: titre, level: 1 })).toBeVisible();
    });
  }

  test("le bandeau s'affiche à la première visite, Accepter le fait disparaître et persiste (#236)", async ({
    page,
  }) => {
    await page.goto("/legal/cgu");
    const bandeau = page.getByRole("region", { name: "Consentement aux cookies" });
    await expect(bandeau).toBeVisible();

    await page.getByRole("button", { name: "Accepter" }).click();
    await expect(bandeau).toHaveCount(0);

    // Persistance : un rechargement complet ne redemande pas.
    await page.reload();
    await expect(page.getByRole("region", { name: "Consentement aux cookies" })).toHaveCount(0);
  });

  test("Refuser fait aussi disparaître le bandeau et persiste (#236)", async ({ page }) => {
    await page.goto("/legal/cgu");
    const bandeau = page.getByRole("region", { name: "Consentement aux cookies" });
    await expect(bandeau).toBeVisible();

    await page.getByRole("button", { name: "Refuser" }).click();
    await expect(bandeau).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "Consentement aux cookies" })).toHaveCount(0);
  });

  test("Do Not Track force le refus sans jamais afficher le bandeau (#236)", async ({ page }) => {
    // Émule le signal DNT AVANT tout script de page (comme le fait un vrai
    // navigateur configuré ainsi).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    });
    await page.goto("/legal/cgu");
    await expect(page.getByRole("region", { name: "Consentement aux cookies" })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Révocation depuis /profil (#236) — compte de test PARTAGÉ (storageState par
// défaut du projet e2e-partage).
// ---------------------------------------------------------------------------
test("la section « Vie privée » de /profil reflète et modifie le consentement (#236)", async ({
  page,
}) => {
  await page.goto("/profil");
  const interrupteur = page.getByRole("switch", { name: "Mesure d'audience" });

  // Aucun choix fait (réinitialisé en beforeEach) → affiché décoché.
  await expect(interrupteur).toHaveAttribute("aria-checked", "false");

  await interrupteur.click();
  await expect(interrupteur).toHaveAttribute("aria-checked", "true");

  // Persistance locale : un rechargement complet garde le choix (localStorage).
  await page.reload();
  await expect(page.getByRole("switch", { name: "Mesure d'audience" })).toHaveAttribute(
    "aria-checked",
    "true"
  );

  // Le bandeau ne réapparaît plus ailleurs (choix déjà fait).
  await page.goto("/legal/cgu");
  await expect(page.getByRole("region", { name: "Consentement aux cookies" })).toHaveCount(0);
});
