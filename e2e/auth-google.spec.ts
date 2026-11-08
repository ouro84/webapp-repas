// Connexion Google (US-57) — route de callback OAuth.
//
// On ne peut pas jouer le vrai parcours Google en e2e : on teste les issues
// d'erreur du callback, qui ne dépendent pas de Google. Contexte vierge (pas de
// session) comme rgpd-signup.spec.ts. Les assertions sur le message affiché sur
// /login viennent avec le bandeau d'erreur ; ici, URL seulement.

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
