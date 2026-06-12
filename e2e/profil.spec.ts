// Parcours — page « Mon profil » (#22 PR1, US-22/US-23).
// Session authentifiée via le projet "setup" (storageState).
//
// ⚠️ Écrit en base (table profiles, RLS) sur le compte de test : NE PAS lancer
// en local (.env.local pointe la prod). Validation en CI (staging seedé).
//
// Isolation : le compte est partagé. On réinitialise le profil (prénom/couleur)
// avant chaque test ET après tous, pour ne pas faire dériver l'avatar de la nav.
//
// On NE teste PAS un changement de mot de passe RÉUSSI : il modifierait le mot
// de passe du compte de test partagé et casserait auth.setup aux runs suivants.
// On couvre donc seulement les GARDES (mot de passe actuel erroné, confirmation
// divergente), qui ne modifient rien.
//
// ⚠️ DÉCONNEXION : le bouton appelle supabase.auth.signOut({ scope: 'local' }),
// qui révoque le refresh token de LA SESSION COURANTE côté serveur. Or tous les
// contextes e2e partagent le MÊME storageState (e2e/.auth/user.json = un seul
// refresh token) : se déconnecter avec la session partagée le révoquerait pour
// TOUS les tests suivants (recettes/reglages → redirigés vers /login). Le test
// de déconnexion ouvre donc un contexte VIERGE et s'y connecte FRAÎCHEMENT
// (session séparée, refresh token distinct) avant de se déconnecter — la session
// partagée reste intacte (même esprit que foyer-clonage avec ses comptes dédiés).

import { test, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD, reinitialiserProfilDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reinitialiserProfilDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserProfilDistant(request);
});

test("la page /profil regroupe identité, foyer, sécurité et réglages", async ({
  page,
}) => {
  await page.goto("/profil");

  await expect(
    page.getByRole("heading", { name: "Mon profil", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mon identité", level: 2 })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mon foyer", level: 2 })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sécurité", level: 2 })
  ).toBeVisible();
  // Passerelle vers les réglages de génération (séparés de l'identité).
  await expect(
    page.getByRole("link", { name: /Réglages de génération/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Se déconnecter" })
  ).toBeVisible();
});

test("éditer le prénom le persiste (US-23)", async ({ page }) => {
  await page.goto("/profil");

  const champ = page.getByLabel("Prénom");
  await expect(champ).toBeVisible();
  // Sans modification, le bouton est inactif (enregistrement explicite).
  const enregistrer = page
    .getByRole("button", { name: "Enregistrer" })
    .first();
  await expect(enregistrer).toBeDisabled();

  await champ.fill("Testeur");
  await expect(enregistrer).toBeEnabled();
  await enregistrer.click();

  await expect(page.getByText("Prénom enregistré")).toBeVisible();
  // L'avatar de la nav reprend l'initiale du prénom (porté par le store partagé).
  await expect(page.getByRole("link", { name: "Profil de Testeur" })).toBeVisible();
});

test("changer le mot de passe refuse un mot de passe actuel erroné (US-22)", async ({
  page,
}) => {
  await page.goto("/profil");

  await page.getByLabel("Mot de passe actuel").fill("mauvais-mot-de-passe");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("nouveau-secret-1");
  await page.getByLabel("Confirme le nouveau mot de passe").fill("nouveau-secret-1");
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();

  await expect(page.getByText("Mot de passe actuel incorrect.")).toBeVisible();
});

test("changer le mot de passe refuse une confirmation divergente (US-22)", async ({
  page,
}) => {
  await page.goto("/profil");

  await page.getByLabel("Mot de passe actuel").fill("peu-importe");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("secret-aaaaa");
  await page.getByLabel("Confirme le nouveau mot de passe").fill("secret-bbbbb");
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();

  await expect(
    page.getByText("La confirmation ne correspond pas au nouveau mot de passe.")
  ).toBeVisible();
});

test("se déconnecter détruit la session et redirige vers /login (US-22)", async ({
  browser,
}) => {
  // Contexte VIERGE (storageState vide) + connexion fraîche : la déconnexion ne
  // touchera que cette session jetable, pas le token partagé (cf. en-tête).
  const contexte = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await contexte.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_EMAIL);
    // exact : le bouton œil « Afficher le mot de passe » contient « mot de passe ».
    await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL("**/planning");

    // Déconnexion sur CETTE session.
    await page.goto("/profil");
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await page.waitForURL("**/login");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  } finally {
    await contexte.close();
  }
});
