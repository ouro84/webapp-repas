// Parcours #22 PR2 — tunnel d'onboarding (US-23).
//
// Un nouvel inscrit (compte NON onboardé) doit être conduit, écran après écran,
// jusqu'à un PREMIER planning déjà rempli (« aha moment »), sans jamais arriver
// sur un écran vide.
//
// ⚠️ Crée un compte JETABLE dédié (email unique par run), distinct du compte de
// test partagé → aucun effet de bord sur les autres specs. Comme foyer-clonage,
// le compte n'est PAS supprimé (la clé anon ne le permet pas) : accumulation
// assumée sur staging. Repose sur la génération réelle (catalogue global seedé
// sur staging) → validation EN CI uniquement ; NE PAS lancer en local
// (.env.local pointe la prod).

import { test, expect } from "@playwright/test";
import { E2E_PASSWORD, lireEnvLocal, lireReglagesDistants } from "./helpers";

const RUN = Date.now();

test("le tunnel mène un nouvel inscrit à un premier planning (US-23)", async ({
  browser,
  request,
}) => {
  // Parcours long (signup + login + 2 écrans + génération réelle) : le défaut de
  // 30 s ne suffit pas avec la latence staging.
  test.setTimeout(120_000);

  const email = `onboarding-${RUN}@example.com`;
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // Signup REST — compte NON onboardé (on teste justement le tunnel : pas de
  // marquerOnboardingCompletDistant ici, contrairement aux autres specs).
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  expect([200, 400, 422]).toContain(r.status());

  // Contexte vierge + connexion : le proxy redirige vers /bienvenue (non onboardé).
  const contexte = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await contexte.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Redirigé vers le tunnel, pas vers /planning.
    await page.waitForURL("**/bienvenue");

    // Écran 1 : prénom (personnes + végé laissés au défaut) → Suivant.
    await page.getByPlaceholder("Ton prénom").fill("Camille");
    await page.getByRole("button", { name: "Suivant" }).click();

    // Écran 2 : démarrer en solo → génération du premier planning → /planning.
    await page.getByRole("button", { name: /Démarrer seul/ }).click();
    await page.waitForURL("**/planning", { timeout: 60_000 });

    // Aha moment : un planning de 7 jours est déjà là (pas d'écran vide).
    await expect(page.locator("main ul > li")).toHaveCount(7);
    // L'en-tête de l'app affiche l'avatar à l'initiale du prénom (US-23 sc. 6).
    await expect(
      page.getByRole("link", { name: "Profil de Camille" })
    ).toBeVisible();
  } finally {
    await contexte.close();
  }
});

test("l'écran 1 du tunnel calibre les réglages de génération (US-23, RG-37)", async ({
  browser,
  request,
}) => {
  // Parcours long (signup + login + écran 1 + génération réelle) : 30 s ne suffit
  // pas avec la latence staging.
  test.setTimeout(120_000);

  const email = `calibration-${RUN}@example.com`;
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // Signup REST — compte NON onboardé (on veut le tunnel).
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  expect([200, 400, 422]).toContain(r.status());

  const contexte = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await contexte.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL("**/bienvenue");

    // Écran 1 : prénom + 4 personnes (2 → +2) + foyer végétarien activé.
    await page.getByPlaceholder("Ton prénom").fill("Dominique");
    await page.getByRole("button", { name: "Plus de personnes" }).click();
    await page.getByRole("button", { name: "Plus de personnes" }).click();
    await page.getByRole("switch", { name: "Foyer végétarien" }).click();
    await page.getByRole("button", { name: "Suivant" }).click();

    // Écran 2 : démarrer en solo → génération → /planning.
    await page.getByRole("button", { name: /Démarrer seul/ }).click();
    await page.waitForURL("**/planning", { timeout: 60_000 });

    // RG-37 : la calibration s'est traduite dans la table reglages — nombre de
    // personnes par défaut (4) et préférence végé de SEMAINE activée (le week-end
    // reste au défaut, cf. reglagesSaisis du tunnel).
    await expect
      .poll(() => lireReglagesDistants(request, email, E2E_PASSWORD), {
        timeout: 15_000,
      })
      .not.toBeNull();
    const reglages = await lireReglagesDistants(request, email, E2E_PASSWORD);
    expect(reglages?.personnes_defaut).toBe(4);
    expect(reglages?.vege_dejeuner_semaine).toBe(true);
    expect(reglages?.vege_diner_semaine).toBe(true);
  } finally {
    await contexte.close();
  }
});
