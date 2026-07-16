// Parcours d'authentification — UI et accessibilité du formulaire (#57, #60).
//
// Ces tests s'exécutent DÉCONNECTÉS : le proxy (ex-middleware) redirige un utilisateur
// authentifié hors de /login et /signup (vers /planning). On neutralise donc
// le storageState hérité du projet "setup".

import { test, expect } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("le bouton œil bascule la visibilité du mot de passe (#60)", async ({
  page,
}) => {
  await page.goto("/login");

  const motDePasse = page.getByLabel("Mot de passe", { exact: true });
  await motDePasse.fill("secret-123");

  // Masqué par défaut.
  await expect(motDePasse).toHaveAttribute("type", "password");

  const toggle = page.getByRole("button", { name: "Afficher le mot de passe" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();

  // Révélé : le champ devient du texte et le bouton inverse son libellé/état.
  await expect(motDePasse).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Masquer le mot de passe" })
  ).toHaveAttribute("aria-pressed", "true");
});

test("les champs portent les attributs d'autofill attendus (#60)", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password"
  );

  // L'inscription attend un NOUVEAU mot de passe (gestionnaires de mdp).
  await page.goto("/signup");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveAttribute(
    "autocomplete",
    "new-password"
  );
});

test("le skip link mène au contenu de la page de connexion (#60)", async ({
  page,
}) => {
  await page.goto("/login");
  // Le <main> porte id="contenu" : cible du skip link du layout (WCAG 2.4.1).
  await expect(page.locator("main#contenu")).toBeVisible();
});

test("déconnecté, la nav applicative est masquée (#207)", async ({ page }) => {
  await page.goto("/login");
  // Pas de liens de section qui rebondiraient vers /login, ni d'avatar/profil.
  await expect(page.getByRole("link", { name: "Planning" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Courses" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Recettes" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Profil/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ce midi|Ce soir/ })).toHaveCount(0);
  // Nav minimale : le logo (accueil) et l'aide restent accessibles.
  await expect(page.getByRole("link", { name: "Aide" })).toBeVisible();
});

test("un échec de connexion affiche une alerte et redonne le focus à l'email (#60)", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inconnu@example.com");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();

  // L'erreur est annoncée via role="alert", en français actionnable (#58) —
  // jamais le « Invalid login credentials » brut de Supabase. Scopé à main :
  // le Toaster sonner (hors main) expose lui aussi une région live.
  const alerte = page.locator("main").getByRole("alert");
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText("Email ou mot de passe incorrect");
  // On reste sur /login (pas de navigation) et le focus revient à l'email.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeFocused();
});
