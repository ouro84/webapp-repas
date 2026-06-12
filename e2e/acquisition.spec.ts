// Parcours #22 PR3 — deep-link d'acquisition (US-24).
//
// Un nouvel inscrit qui ouvre un lien d'invitation (`/signup?code=…`) doit, une
// fois inscrit, retrouver le code dans le tunnel et rejoindre directement le
// foyer de l'invitant·e — sans ressaisie. On vérifie ici le scénario 1
// (nouvel inscrit) de bout en bout.
//
// ⚠️ Deux comptes JETABLES dédiés (emails uniques par run), comme foyer-clonage :
// non supprimés (la clé anon ne le permet pas), accumulation assumée sur staging.
// Repose sur la génération réelle (catalogue global seedé) + le foyer partagé →
// validation EN CI uniquement ; NE PAS lancer en local (.env.local = prod).

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

const RUN = Date.now();
const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;

// Signup REST idempotent (confirmation email désactivée → utilisable aussitôt).
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

test("un nouvel inscrit invité rejoint le foyer via le lien (US-24)", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const emailX = `acq-x-${RUN}@example.com`;
  const emailY = `acq-y-${RUN}@example.com`;

  // --- X (invitant·e) : compte onboardé, prénom, planning, code d'invitation ---
  await inscrire(request, emailX);
  await marquerOnboardingCompletDistant(request, emailX, E2E_PASSWORD);
  const ctxX = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const x = await connecter(ctxX, emailX);

  // Prénom (pour l'aperçu « Tu rejoins le foyer de Alice » côté Y).
  await x.goto("/profil");
  await x.getByLabel("Prénom").fill("Alice");
  await x.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(x.getByText("Prénom enregistré")).toBeVisible();

  // Planning (Y doit le retrouver une fois dans le foyer partagé).
  await x.goto("/planning");
  await x.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(x.locator("main ul > li")).toHaveCount(7);

  // Invitation → code.
  await x.goto("/profil");
  const inviter = x.getByRole("button", { name: "Inviter quelqu’un" });
  await expect(inviter).toBeVisible();
  await inviter.click();
  await expect(x.getByText(CODE_RX)).toBeVisible();
  const code = (await x.getByText(CODE_RX).innerText()).trim();
  expect(code).toMatch(CODE_RX);

  // --- Y (nouvel inscrit) : ouvre le lien d'invitation puis s'inscrit ---
  const ctxY = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const y = await ctxY.newPage();
  await y.goto(`/signup?code=${code}`);
  await y.getByLabel("Email").fill(emailY);
  await y.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await y.getByRole("button", { name: "Créer mon compte" }).click();

  // Nouvel inscrit → tunnel d'onboarding (pas /planning).
  await y.waitForURL("**/bienvenue");

  // Écran 1 : prénom → Suivant.
  await y.getByPlaceholder("Ton prénom").fill("Yann");
  await y.getByRole("button", { name: "Suivant" }).click();

  // Écran 2 : le code capté depuis le lien → confirmation pré-remplie (US-24).
  await expect(y.getByText(/Tu rejoins le foyer de Alice/)).toBeVisible();
  await y.getByRole("button", { name: /C.est parti/ }).click();

  // Y atterrit sur /planning et voit le planning PARTAGÉ de X (foyer commun).
  await y.waitForURL("**/planning", { timeout: 60_000 });
  await expect(y.locator("main ul > li")).toHaveCount(7);

  await ctxX.close();
  await ctxY.close();
});
