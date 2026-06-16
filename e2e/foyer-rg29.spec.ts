// Parcours #56 / #174 — RG-29 : on ne peut rejoindre un foyer que si l'on est
// SEUL ; en foyer PARTAGÉ, il faut d'abord quitter le sien.
//
// Comme foyer-clonage, ce test fait une VRAIE jonction → il crée DEUX comptes
// JETABLES dédiés (emails uniques par run), disjoints du compte de test partagé
// (un vrai changement de foyer sur le compte partagé casserait les autres
// specs). Comptes NON supprimés en teardown (clé anon insuffisante) :
// accumulation assumée sur staging. Validation EN CI uniquement (jonction réelle
// + RLS staging) ; NE PAS lancer en local (.env.local pointe la prod).

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  E2E_PASSWORD,
  lireEnvLocal,
  marquerOnboardingCompletDistant,
} from "./helpers";

const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;
const RUN = Date.now();

// Signup REST idempotent + marquage onboarding (sinon le login atterrirait sur
// /bienvenue au lieu de /planning) — même contrat que foyer-clonage.
async function inscrire(
  request: APIRequestContext,
  email: string
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

async function connecter(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/planning");
  return page;
}

test("rejoindre est refusé en foyer partagé : il faut quitter d'abord (RG-29)", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const emailX = `rg29-x-${RUN}@example.com`;
  const emailY = `rg29-y-${RUN}@example.com`;
  await inscrire(request, emailX);
  await inscrire(request, emailY);

  // Contextes VIERGES (sinon héritage du storageState du compte partagé, cf.
  // foyer-clonage).
  const vierge = { storageState: { cookies: [], origins: [] } };
  const ctxX = await browser.newContext(vierge);
  const ctxY = await browser.newContext(vierge);

  try {
    // X invite : génère un code.
    const x = await connecter(ctxX, emailX);
    await x.goto("/profil");
    await x.getByRole("button", { name: "Inviter quelqu’un" }).click();
    await expect(x.getByText(CODE_RX)).toBeVisible();
    const code = (await x.getByText(CODE_RX).innerText()).trim();
    expect(code).toMatch(CODE_RX);

    // Y est SOLO au départ : le champ « Rejoindre » est présent.
    const y = await connecter(ctxY, emailY);
    await y.goto("/profil");
    await expect(y.getByLabel("Rejoindre un foyer")).toBeVisible();

    // Y rejoint le foyer de X → passe en foyer PARTAGÉ.
    await y.getByLabel("Rejoindre un foyer").fill(code);
    await y.getByRole("button", { name: "Rejoindre" }).click();
    await expect(y.getByRole("button", { name: "Quitter le foyer" })).toBeVisible();

    // RG-29 : en foyer partagé, le champ « Rejoindre » DISPARAÎT et un message
    // renvoie vers la sortie préalable — impossible de rejoindre un autre foyer.
    await expect(y.getByLabel("Rejoindre un foyer")).toHaveCount(0);
    await expect(
      y.getByText("Pour rejoindre un autre foyer, quitte d’abord celui-ci.")
    ).toBeVisible();
  } finally {
    await ctxX.close();
    await ctxY.close();
  }
});
