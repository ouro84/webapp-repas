// Parcours #237 (US-31) — suppression de compte, droit à l'effacement RGPD.
//
// ⚠️ Crée des comptes JETABLES dédiés (emails uniques par run), disjoints du
// compte de test partagé. Contrairement aux autres specs jetables, les
// comptes ICI sont réellement supprimés en fin de test (c'est l'objet du
// test) — pas d'accumulation pour ceux-là.

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import {
  E2E_PASSWORD,
  fermerModaleDoublonsSiPresente,
  lireEnvLocal,
  marquerOnboardingCompletDistant,
} from "./helpers";

const RUN = Date.now();
const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;

async function inscrire(request: APIRequestContext, email: string): Promise<void> {
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

async function connecter(
  context: BrowserContext,
  email: string,
  gardes?: { erreurs: string[] }[]
): Promise<Page> {
  const page = await context.newPage();
  gardes?.push(attacherGardeCrash(page));
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/planning");
  return page;
}

// Vérifie qu'un compte ne peut plus se reconnecter (compte réellement supprimé).
async function verifierCompteSupprime(
  request: APIRequestContext,
  email: string
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  expect(r.ok()).toBe(false);
}

async function supprimerCompte(page: Page): Promise<void> {
  await page.goto("/profil");
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Tape SUPPRIMER pour confirmer").fill("SUPPRIMER");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await page.waitForURL("**/compte-supprime", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Ton compte a été supprimé" })).toBeVisible();
}

test("supprimer son compte en solo efface le compte et ses données (#237)", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const email = `suppr-solo-${RUN}@example.com`;
  await inscrire(request, email);

  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await connecter(contexte, email);
  await supprimerCompte(page);
  await contexte.close();

  await verifierCompteSupprime(request, email);
});

test("supprimer son compte en foyer partagé préserve les données des autres membres (#237)", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const emailX = `suppr-x-${RUN}@example.com`;
  const emailY = `suppr-y-${RUN}@example.com`;
  await inscrire(request, emailX);
  await inscrire(request, emailY);

  const vierge = { storageState: { cookies: [], origins: [] } };
  const ctxX = await browser.newContext(vierge);
  const ctxY = await browser.newContext(vierge);
  const gardes: { erreurs: string[] }[] = [];

  // --- X : génère un planning, invite ---
  const x = await connecter(ctxX, emailX, gardes);
  await x.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(x.locator("main ul > li")).toHaveCount(7);
  await expect
    .poll(async () => x.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await x.goto("/profil");
  await x.getByRole("button", { name: "Inviter quelqu’un" }).click();
  await expect(x.getByText(CODE_RX)).toBeVisible();
  const code = (await x.getByText(CODE_RX).innerText()).trim();

  // --- Y : rejoint le foyer de X ---
  const y = await connecter(ctxY, emailY, gardes);
  await y.goto("/profil");
  await y.getByLabel("Rejoindre un foyer").fill(code);
  await y.getByRole("button", { name: "Rejoindre" }).click();
  await fermerModaleDoublonsSiPresente(y);
  await expect(y.getByRole("button", { name: "Quitter le foyer" })).toBeVisible();

  // --- Y : supprime son compte ---
  await supprimerCompte(y);
  await ctxY.close();
  await verifierCompteSupprime(request, emailY);

  // --- X : le foyer partagé et son planning sont intacts ---
  await x.reload();
  await x.goto("/planning");
  await expect(x.locator("main ul > li")).toHaveCount(7);

  await ctxX.close();
  const erreurs = gardes.flatMap((g) => g.erreurs);
  expect(erreurs, `Crash React détecté : ${erreurs.join(" | ")}`).toEqual([]);
});
