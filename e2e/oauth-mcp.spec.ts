// Parcours #305 (US-50, US-51, RG-71, RG-72) — connexion d'un assistant IA par
// OAuth 2.1 (Supabase OAuth Server + DCR), écran de consentement OMQ, lecture
// MCP en tant que l'utilisateur, isolation par foyer et révocation.
//
// ⚠️ Comptes JETABLES (emails uniques par run) et clients OAuth DCR créés sur
// staging à chaque run (ils s'accumulent). Prérequis staging : OAuth Server
// activé, DCR activé, chemin /oauth/consent, site_url = http://localhost:3000
// (scripts/configurer-oauth-supabase.mjs).

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { E2E_PASSWORD, lireEnvLocal, marquerOnboardingCompletDistant } from "./helpers";
import {
  appelerOutilMcp,
  capturerRedirection,
  echangerCode,
  enregistrerClientOAuth,
  enregistrerPlanning,
  genererPkce,
  jetonMotDePasse,
  rafraichir,
  recettesCatalogue,
  urlAutorisation,
} from "./oauth";
import { semaineISO } from "../lib/semaines";

const RUN = Date.now();
const EMAIL_A = `claude-e2e-oauth-${RUN}-a@example.com`;
const EMAIL_B = `claude-e2e-oauth-${RUN}-b@example.com`;
const EMAIL_C = `claude-e2e-oauth-${RUN}-c@example.com`;

test.describe.configure({ mode: "serial" });

async function inscrire(request: APIRequestContext, email: string, onboarde = true): Promise<void> {
  const r = await request.post(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/signup`, {
    headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  if (onboarde) await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

const contextes: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(contextes.splice(0).map((c) => c.close()));
});

async function pageVierge(browser: Browser): Promise<{ page: Page; erreurs: string[] }> {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  contextes.push(contexte);
  const page = await contexte.newPage();
  const garde = attacherGardeCrash(page);
  return { page, erreurs: garde.erreurs };
}

async function remplirLogin(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function connecter(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await remplirLogin(page, email);
  await page.waitForURL("**/planning");
}

// Écran de consentement : boutons ciblés dans sa section, car le bandeau
// cookies porte lui aussi un bouton « Refuser ».
function consentement(page: Page, nomClient: string) {
  return page.getByRole("region", { name: new RegExp(`^Autoriser ${nomClient}\\s\\?$`) });
}

// Déroule une autorisation complète pour `email` (déjà connecté sur `page`) et
// renvoie le client et les jetons obtenus.
async function autoriser(page: Page, request: APIRequestContext, nomClient: string) {
  const { clientId } = await enregistrerClientOAuth(request, nomClient);
  const { verifier, challenge } = genererPkce();
  const redirection = capturerRedirection(page);
  await page.goto(urlAutorisation(clientId, challenge, "etat-1"));
  await expect(consentement(page, nomClient)).toContainText(
    `${nomClient} pourra, en ton nom et seulement pour ton foyer`
  );
  await consentement(page, nomClient).getByRole("button", { name: "Autoriser" }).click();
  const retour = await redirection;
  expect(retour.searchParams.get("state")).toBe("etat-1");
  const code = retour.searchParams.get("code");
  expect(code).toBeTruthy();
  const jetons = await echangerCode(request, clientId, code!, verifier);
  return { clientId, ...jetons };
}

test.beforeAll(async ({ request }) => {
  await inscrire(request, EMAIL_A);
  await inscrire(request, EMAIL_B);
  await inscrire(request, EMAIL_C, false);
});

test("sans jeton : 401 + WWW-Authenticate, metadata RFC 9728 cohérente", async ({ request }) => {
  const appel = await appelerOutilMcp(request, null, "lire_planning");
  expect(appel.statut).toBe(401);
  expect(appel.reponse.headers()["www-authenticate"]).toContain(
    "/.well-known/oauth-protected-resource/api/mcp"
  );

  const metadata = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(metadata.resource).toBe("http://localhost:3000/api/mcp");
  expect(metadata.authorization_servers).toEqual([`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1`]);
});

test("un jeton de session web (sans client_id) est refusé par /api/mcp (RG-71)", async ({ request }) => {
  const appel = await appelerOutilMcp(request, await jetonMotDePasse(request, EMAIL_A), "lire_planning");
  expect(appel.statut).toBe(401);
});

test("non connecté : authorize → /login?suivant=… → connexion → retour sur le consentement", async ({
  browser,
  request,
}) => {
  const { page, erreurs } = await pageVierge(browser);
  const nom = `E2E OMQ login ${RUN}`;
  const { clientId } = await enregistrerClientOAuth(request, nom);
  await page.goto(urlAutorisation(clientId, genererPkce().challenge, "etat-login"));
  await page.waitForURL(/\/login\?.*suivant=/);
  await remplirLogin(page, EMAIL_A);
  await page.waitForURL(/\/oauth\/consent\?authorization_id=/);
  await expect(consentement(page, nom)).toBeVisible();
  expect(erreurs).toEqual([]);
});

test("consentement : nom du client affiché, Autoriser → code → jeton → lire_planning OK (US-50)", async ({
  browser,
  request,
}) => {
  const { page, erreurs } = await pageVierge(browser);
  await connecter(page, EMAIL_A);
  const { access_token: jeton } = await autoriser(page, request, `E2E OMQ ${RUN}`);
  const appel = await appelerOutilMcp(request, jeton, "lire_planning");
  expect(appel.statut).toBe(200);
  expect(appel.resultat?.isError).toBeFalsy();
  expect(appel.resultat?.structuredContent).toHaveProperty("repas");
  expect(erreurs).toEqual([]);
});

test("refus : Refuser → redirection avec error=access_denied", async ({ browser, request }) => {
  const { page, erreurs } = await pageVierge(browser);
  await connecter(page, EMAIL_A);
  const nom = `E2E OMQ refus ${RUN}`;
  const { clientId } = await enregistrerClientOAuth(request, nom);
  const redirection = capturerRedirection(page);
  await page.goto(urlAutorisation(clientId, genererPkce().challenge, "etat-refus"));
  await consentement(page, nom).getByRole("button", { name: "Refuser" }).click();
  const retour = await redirection;
  expect(retour.searchParams.get("error")).toBe("access_denied");
  expect(retour.searchParams.get("code")).toBeNull();
  expect(erreurs).toEqual([]);
});

test("isolation à deux foyers (RG-71)", async ({ browser, request }) => {
  const semaine = semaineISO(new Date());
  const jetonB = await jetonMotDePasse(request, EMAIL_B);
  const [r0, r1, r2] = await recettesCatalogue(request, jetonB, 3);
  await enregistrerPlanning(request, jetonB, semaine, [
    { jour: "lundi", recetteId: r0.id },
    { jour: "mardi", recetteId: r1.id },
  ]);

  const { page } = await pageVierge(browser);
  await connecter(page, EMAIL_A);
  const { access_token: jetonA } = await autoriser(page, request, `E2E OMQ isolation ${RUN}`);

  const planningA = await appelerOutilMcp(request, jetonA, "lire_planning", { semaine });
  expect(planningA.resultat?.structuredContent?.repas).toEqual([]);
  const listeA = await appelerOutilMcp(request, jetonA, "lire_liste_courses");
  expect(listeA.resultat?.structuredContent?.nombre_articles).toBe(0);

  await enregistrerPlanning(request, await jetonMotDePasse(request, EMAIL_A), semaine, [
    { jour: "mercredi", recetteId: r2.id },
  ]);
  const apres = await appelerOutilMcp(request, jetonA, "lire_planning", { semaine });
  const recettes = (apres.resultat?.structuredContent?.repas as Array<{ recette: string }>).map((r) => r.recette);
  expect(recettes).toEqual([r2.nom]);
});

test("onboarding non terminé : le consentement redirige vers /bienvenue", async ({ browser, request }) => {
  const { page } = await pageVierge(browser);
  await page.goto("/login");
  await remplirLogin(page, EMAIL_C);
  await page.waitForURL("**/bienvenue");
  const { clientId } = await enregistrerClientOAuth(request, `E2E OMQ onboarding ${RUN}`);
  await page.goto(urlAutorisation(clientId, genererPkce().challenge, "etat-c"));
  await page.waitForURL("**/bienvenue");
});

test("révocation (RG-72)", async ({ browser, request }) => {
  const { page, erreurs } = await pageVierge(browser);
  await connecter(page, EMAIL_A);
  const nom = `E2E OMQ revocation ${RUN}`;
  const { clientId, refresh_token: refresh } = await autoriser(page, request, nom);

  await page.goto("/profil");
  const section = page.getByRole("region", { name: "Assistants connectés" });
  await expect(section.getByText(nom)).toBeVisible();
  await section.getByRole("button", { name: `Déconnecter ${nom}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Déconnecter" }).click();
  await expect(section.getByText(nom)).toHaveCount(0);

  const r = await rafraichir(request, clientId, refresh);
  expect(r.ok()).toBe(false);
  expect(erreurs).toEqual([]);
});
