// Parcours #22 PR2 — tunnel d'onboarding (US-23), calé sur le cycle (#386).
//
// Un nouvel inscrit (compte NON onboardé) doit être conduit, écran après écran,
// jusqu'à un PREMIER cycle de courses déjà rempli (« aha moment », RG-90/RG-91),
// sans jamais arriver sur un écran vide.
//
// ⚠️ Crée un compte JETABLE dédié (email unique par run), distinct du compte de
// test partagé → aucun effet de bord sur les autres specs. Comme foyer-clonage,
// le compte n'est PAS supprimé (la clé anon ne le permet pas) : accumulation
// assumée sur staging. Repose sur la génération réelle (catalogue global seedé
// sur staging) → validation EN CI uniquement ; NE PAS lancer en local
// (.env.local pointe la prod).

import { test, expect } from "./fixtures";
import { E2E_PASSWORD, lireEnvLocal, lireReglagesDistants } from "./helpers";
import { ancreParDefaut, datesCycle } from "../lib/cycles";

// Jour de courses présélectionné par le tunnel (samedi, ISO 6) et longueur du
// premier cycle (RG-91) : le libellé attendu se calcule à l'appel, la date du
// jour décidant de l'ancre.
const JOUR_COURSES_ONBOARDING = 6;
const LONGUEUR_CYCLE = 7;

const RUN = Date.now();

test("le tunnel mène un nouvel inscrit à un premier cycle (US-23, RG-91)", async ({
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

    // Écran 2 : démarrer en solo → écran 3 (jour de courses).
    await page.getByRole("button", { name: /Démarrer seul/ }).click();

    // Écran 3 : samedi présélectionné ; « Générer mon planning » lance le premier cycle.
    await expect(page.getByText("Étape 3 sur 3")).toBeVisible();
    await expect(page.getByRole("radio", { name: "samedi" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.getByRole("button", { name: "Générer mon planning" }).click();

    // `/planning?bienvenue=1` : un glob sans query ne le matcherait pas ; la page
    // retire ensuite le paramètre (history.replaceState).
    await page.waitForURL(/\/planning(\?.*)?$/, { timeout: 60_000 });
    await expect(page).not.toHaveURL(/bienvenue/);

    // Toast d'arrivée de l'onboarding (une fois, paramètre consommé).
    await expect(page.getByText("Ta liste de courses est prête")).toBeVisible();

    // Aha moment : la vue Cycle est active, sur le cycle du jour de courses (samedi).
    await expect(
      page
        .getByRole("group", { name: "Vue du planning" })
        .getByRole("button", { name: "Cycle" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText(
        datesCycle(ancreParDefaut(new Date(), JOUR_COURSES_ONBOARDING), LONGUEUR_CYCLE),
        { exact: true }
      )
    ).toBeVisible();
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
    // Midi en semaine : l'interrupteur est actif par défaut, on le coupe (RG-90).
    await page
      .getByRole("switch", { name: "On mange à la maison le midi en semaine" })
      .click();
    await page.getByRole("button", { name: "Suivant" }).click();

    // Écran 2 : démarrer en solo → écran 3 (jour de courses) → génération → /planning.
    await page.getByRole("button", { name: /Démarrer seul/ }).click();
    await page.getByRole("button", { name: "Générer mon planning" }).click();
    await page.waitForURL(/\/planning(\?.*)?$/, { timeout: 60_000 });
    await expect(page).not.toHaveURL(/bienvenue/);

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
    // Midi en semaine coupé : plafond « aucun » (créneau désactivé, RG-44).
    expect(reglages?.max_dejeuner_semaine).toBe("aucun");

    // Vue Cycle : la génération respecte le créneau désactivé. Témoin d'abord
    // (des dîners sont bien générés), puis aucun déjeuner du lundi au vendredi.
    // Les boutons « Changer le … » n'existent que sur un créneau rempli ; seule la
    // grille mobile (390 px) est dans l'arbre d'accessibilité.
    await expect(
      page.getByRole("button", { name: /^Changer le dîner de /i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Changer le déjeuner de (lundi|mardi|mercredi|jeudi|vendredi) /i,
      })
    ).toHaveCount(0);
  } finally {
    await contexte.close();
  }
});
