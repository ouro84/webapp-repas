// Connexion Google (US-57) — callback OAuth et bouton « Continuer avec Google ».
//
// On ne peut pas jouer le vrai parcours Google en e2e : on teste les issues
// d'erreur du callback, qui ne dépendent pas de Google, et le bouton jusqu'à
// l'appel d'autorisation Supabase (intercepté, le navigateur ne va jamais chez
// Google). Contexte vierge (pas de session) comme rgpd-signup.spec.ts.

import { test, expect } from "./fixtures";

test("refus chez Google : retour sur /login?erreur_oauth=annule (US-57)", async ({ browser }) => {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    await page.goto("/auth/callback?error=access_denied");
    await expect(page).toHaveURL(/\/login\?erreur_oauth=annule$/);
  } finally {
    await contexte.close();
  }
});

test("code invalide + suivant malveillant : échec sur /login, jamais de redirection externe (US-57)", async ({
  browser,
}) => {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    await page.goto("/auth/callback?code=bidon&suivant=//evil.com");
    await expect(page).toHaveURL(/\/login\?erreur_oauth=echec$/);
    const url = new URL(page.url());
    // Même origine que l'app (baseURL) : aucune sortie vers evil.com.
    expect(url.origin).toBe(new URL(test.info().project.use.baseURL ?? page.url()).origin);
    expect(url.hostname).not.toBe("evil.com");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("erreur_oauth")).toBe("echec");
  } finally {
    await contexte.close();
  }
});

for (const chemin of ["/login", "/signup"]) {
  test(`${chemin} : bouton Google et mention CGU visibles (US-57)`, async ({ browser }) => {
    const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await contexte.newPage();
    try {
      await page.goto(chemin);
      // Scopé à <main> : le pied de page porte lui aussi des liens légaux.
      const principal = page.locator("main");
      await expect(principal.getByRole("button", { name: "Continuer avec Google" })).toBeVisible();
      await expect(principal.getByText("En continuant, tu acceptes les")).toBeVisible();
      await expect(principal.getByRole("link", { name: "CGU", exact: true })).toHaveAttribute(
        "href",
        "/legal/cgu"
      );
      await expect(
        principal.getByRole("link", { name: "politique de confidentialité", exact: true })
      ).toHaveAttribute("href", "/legal/confidentialite");
    } finally {
      await contexte.close();
    }
  });
}

test("/login?erreur_oauth=annule : message d’annulation affiché (US-57)", async ({ browser }) => {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    await page.goto("/login?erreur_oauth=annule");
    // Scopé à <main> : le route-announcer de Next est aussi un role="alert".
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Connexion avec Google annulée"
    );
  } finally {
    await contexte.close();
  }
});

test("clic sur Google : appel /auth/v1/authorize avec provider=google et le callback (US-57)", async ({
  browser,
}) => {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await contexte.newPage();
  try {
    // On intercepte l'appel d'autorisation : le navigateur n'atteint jamais
    // Google, on vérifie seulement l'URL demandée à Supabase.
    const urlAutorisation = new Promise<string>((resolve) => {
      void page.route("**/auth/v1/authorize**", async (route) => {
        resolve(route.request().url());
        await route.fulfill({ status: 200, body: "" });
      });
    });
    await page.goto("/login");
    await page.getByRole("button", { name: "Continuer avec Google" }).click();
    const url = new URL(await urlAutorisation);
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toMatch(/\/auth\/callback$/);
  } finally {
    await contexte.close();
  }
});
