// Parcours #306 (US-52, RG-74→79) — outils MCP d'ÉCRITURE joués par un
// « assistant » (jeton OAuth obtenu par DCR + consentement), et leur effet sur
// un navigateur ouvert du même compte : une écriture MCP est une modification
// ordinaire, visible en temps réel avec l'alerte US-21 (RG-79).
//
// ⚠️ Compte JETABLE (email unique par run) et client DCR créé sur staging.
// Génération réelle : catalogue global seedé, donc staging seulement.
// Prérequis staging : OAuth Server + DCR, site_url = http://localhost:3000.

import { test, expect } from "./fixtures";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { appelerOutilMcp, autoriser, connecter, inscrire } from "./oauth";

const RUN = Date.now();
const EMAIL = `claude-e2e-mcp-ecriture-${RUN}@example.com`;

test.describe.configure({ mode: "serial" });

let jeton = "";
const contextes: BrowserContext[] = [];

async function pageConnectee(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  contextes.push(contexte);
  const page = await contexte.newPage();
  await connecter(page, EMAIL);
  return page;
}

type Repas = { date: string; creneau: "midi" | "soir"; recette: string; personnes: number };

async function premierRepas(request: Parameters<typeof appelerOutilMcp>[0]): Promise<Repas> {
  const lecture = await appelerOutilMcp(request, jeton, "lire_planning");
  const repas = lecture.resultat?.structuredContent?.repas as Repas[];
  expect(repas.length).toBeGreaterThan(0);
  return repas[0];
}

function texte(appel: Awaited<ReturnType<typeof appelerOutilMcp>>): string {
  return appel.resultat?.content.map((c) => c.text).join("") ?? "";
}

test.beforeAll(async ({ browser, request }) => {
  await inscrire(request, EMAIL);
  const page = await pageConnectee(browser);
  ({ access_token: jeton } = await autoriser(page, request, `E2E OMQ écriture ${RUN}`));
});

test.afterEach(async () => {
  await Promise.all(contextes.splice(0).map((c) => c.close()));
});

test("generer_cycle : génère, refuse un 2e appel, accepte remplacer: true (RG-74)", async ({ request }) => {
  const premier = await appelerOutilMcp(request, jeton, "generer_cycle");
  expect(premier.statut).toBe(200);
  expect(premier.resultat?.isError).toBeFalsy();
  expect((premier.resultat?.structuredContent?.repas as Repas[]).length).toBeGreaterThan(0);

  const refus = await appelerOutilMcp(request, jeton, "generer_cycle");
  expect(refus.resultat?.isError).toBe(true);
  expect(texte(refus)).toContain("Un cycle existe déjà");

  const remplace = await appelerOutilMcp(request, jeton, "generer_cycle", { remplacer: true });
  expect(remplace.resultat?.isError).toBeFalsy();
});

test("remplacer_repas → alerte US-21 sur un /courses ouvert (RG-79)", async ({ browser, request }) => {
  const page = await pageConnectee(browser);
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Liste de courses" })).toBeVisible();
  // Laisser l'abonnement temps réel du cycle s'établir (cf. alerte-planning.spec).
  await page.waitForTimeout(2500);

  const { date, creneau } = await premierRepas(request);
  const appel = await appelerOutilMcp(request, jeton, "remplacer_repas", { date, creneau });
  expect(appel.resultat?.isError).toBeFalsy();

  const alerte = page.getByText(/le planning de la semaine vient d/i);
  await expect(alerte).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /OK, j.ai compris/ }).click();
  await expect(alerte).toHaveCount(0);
});

test("ajouter_article_courses puis cocher_article : visibles sans recharger (RG-77)", async ({ browser, request }) => {
  const page = await pageConnectee(browser);
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Liste de courses" })).toBeVisible();
  await page.waitForTimeout(2500);

  const ajout = await appelerOutilMcp(request, jeton, "ajouter_article_courses", { libelle: "Bougies e2e" });
  expect(ajout.resultat?.isError).toBeFalsy();
  const article = page.getByRole("checkbox", { name: /Bougies e2e/ });
  await expect(article).toBeVisible({ timeout: 20_000 });
  await expect(article).not.toBeChecked();

  const cochage = await appelerOutilMcp(request, jeton, "cocher_article", { libelle: "bougies e2e" });
  expect(cochage.resultat?.structuredContent?.modifie).toBe(true);
  await expect(article).toBeChecked({ timeout: 20_000 });
});

test("ajouter_recette puis remplacer_repas par son nom (RG-75, RG-76)", async ({ request }) => {
  const nom = `Gratin e2e ${RUN}`;
  const recette = {
    nom,
    temps_preparation: "rapide",
    ingredients: [{ nom: "courgette", quantite: 2, unite: "piece", categorie: "legumes-fruits" }],
    etapes: ["Couper", "Gratiner"],
  };
  const ajout = await appelerOutilMcp(request, jeton, "ajouter_recette", recette);
  expect(ajout.resultat?.isError).toBeFalsy();

  const { date, creneau } = await premierRepas(request);
  const remplacement = await appelerOutilMcp(request, jeton, "remplacer_repas", { date, creneau, recette: nom });
  expect(remplacement.resultat?.structuredContent?.modifie).toBe(true);

  const lecture = await appelerOutilMcp(request, jeton, "lire_planning");
  const repas = lecture.resultat?.structuredContent?.repas as Repas[];
  expect(repas.find((r) => r.date === date && r.creneau === creneau)?.recette).toBe(nom);

  const doublon = await appelerOutilMcp(request, jeton, "ajouter_recette", recette);
  expect(doublon.resultat?.isError).toBe(true);
  expect(texte(doublon)).toContain(`Le foyer a déjà une recette « ${nom} »`);
});

test("changer_personnes : 13 refusé, 6 accepté (RG-77, RG-16)", async ({ request }) => {
  const { date, creneau } = await premierRepas(request);

  const refus = await appelerOutilMcp(request, jeton, "changer_personnes", { date, creneau, personnes: 13 });
  expect(refus.resultat?.isError).toBe(true);

  const ok = await appelerOutilMcp(request, jeton, "changer_personnes", { date, creneau, personnes: 6 });
  expect(ok.resultat?.isError).toBeFalsy();
  expect((ok.resultat?.structuredContent?.repas as Repas).personnes).toBe(6);
});
