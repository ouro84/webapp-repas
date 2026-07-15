// Parcours #235 (US-29) — case CGU obligatoire au signup, via la VRAIE page
// /signup (pas un signup REST comme les autres specs jetables : ici on teste
// justement la garde côté UI de la case à cocher).
//
// ⚠️ Crée des comptes JETABLES dédiés (email unique par run), distincts du
// compte de test partagé → aucun effet de bord sur les autres specs. Comptes
// NON supprimés (la clé anon ne le permet pas) : accumulation assumée sur
// staging, comme onboarding.spec/foyer-clonage.spec.

import { test, expect } from "./fixtures";
import { E2E_PASSWORD, lireProfilRgpdDistant } from "./helpers";

const RUN = Date.now();

test("la case CGU non cochée bloque l'inscription (#235)", async ({ browser }) => {
  const email = `rgpd-bloque-${RUN}@example.com`;
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
    // La case n'est délibérément PAS cochée.
    await page.getByRole("button", { name: "Créer mon compte" }).click();

    // getByRole("alert") matcherait aussi le route-announcer de Next.js
    // (role="alert" lui aussi) : on cible le texte exact de l'erreur.
    await expect(page.getByText("Tu dois accepter les CGU")).toBeVisible();
    // Toujours sur /signup : aucun compte n'a été créé (aucun appel réseau).
    await expect(page).toHaveURL(/\/signup$/);
  } finally {
    await contexte.close();
  }
});

test("cocher la case CGU permet de s'inscrire et horodate l'acceptation (#235)", async ({
  browser,
  request,
}) => {
  const email = `rgpd-accepte-${RUN}@example.com`;
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel(/J'accepte les/).check();
    await page.getByRole("button", { name: "Créer mon compte" }).click();

    // Signup réussi → navigation pleine page hors de /signup (tunnel d'onboarding).
    await page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/bienvenue$/);

    // Les pages légales restent lisibles PENDANT le tunnel d'onboarding (#235) —
    // le proxy ne doit pas rediriger vers /bienvenue en boucle.
    await page.goto("/legal/mentions-legales");
    await expect(page.getByRole("heading", { name: "Mentions légales" })).toBeVisible();
  } finally {
    await contexte.close();
  }

  const profil = await lireProfilRgpdDistant(request, email, E2E_PASSWORD);
  expect(profil.cgu_version).toBe(1);
  expect(profil.cgu_acceptees_le).not.toBeNull();
});
