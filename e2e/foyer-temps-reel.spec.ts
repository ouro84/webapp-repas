// Temps réel entre DEUX MEMBRES d'un même foyer (US-20, RG-31, RG-32).
//
// Les specs « deux appareils » (coches-realtime, alerte-planning,
// coches-concurrence) utilisent le MÊME compte : un foyer solo. Elles ne voient
// donc pas un défaut propre aux foyers partagés : `chargerFoyerId` lisait
// `profiles` sans filtre, et la RLS de `profiles` renvoie TOUS les membres du
// foyer ; `.maybeSingle()` échouait (PGRST116) dès 2 membres, et aucun canal
// temps réel ne s'ouvrait (coches, articles manuels, présence, alerte US-21).
//
// Comptes JETABLES (emails uniques par run) : une jonction change `foyer_id`,
// interdit sur le compte partagé (cf. e2e.md). Données amorcées par REST
// (invitation, jonction, planning) : seul le temps réel est le sujet du test.

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { lireEnvLocal } from "./helpers";
import { connecter, enregistrerPlanning, inscrire, jetonMotDePasse, recettesCatalogue } from "./oauth";
import { ancreParDefaut, semainesDuCycle } from "../lib/cycles";

const RUN = Date.now();
// Jour de courses par défaut d'un foyer neuf : lundi. Le cycle affiché par
// défaut (RG-91) commence donc un lundi et tient dans une seule semaine ISO.
const ANCRE = ancreParDefaut(new Date(), 1);
const SEMAINE = semainesDuCycle(ANCRE, 7)[0]!;

async function rpc(request: APIRequestContext, jeton: string, nom: string, corps: object): Promise<unknown> {
  const r = await request.post(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/${nom}`, {
    headers: {
      apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
    },
    data: corps,
  });
  if (!r.ok()) throw new Error(`${nom} impossible : HTTP ${r.status()} — ${await r.text()}`);
  // RPC `void` (rejoindre_foyer) : corps vide, rien à lire.
  const texte = await r.text();
  return texte ? JSON.parse(texte) : null;
}

const gardesCrash: { erreurs: string[] }[] = [];

// Contexte vierge (sinon il hérite du compte partagé), sans View Transition :
// un clic pendant le réordonnancement de la liste se perdrait (cf. e2e.md).
async function ouvrirCourses(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  gardesCrash.push(attacherGardeCrash(page));
  await connecter(page, email);
  await page.goto("/courses");
  await expect(page.getByRole("checkbox").first()).toBeVisible({ timeout: 20_000 });
  return page;
}

test("deux membres d'un foyer partagé se voient en temps réel sur la liste de courses (RG-31, RG-32)", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const emailX = `temps-reel-x-${RUN}@example.com`;
  const emailY = `temps-reel-y-${RUN}@example.com`;
  await inscrire(request, emailX);
  await inscrire(request, emailY);
  const jetonX = await jetonMotDePasse(request, emailX);
  const jetonY = await jetonMotDePasse(request, emailY);

  // Y rejoint le foyer de X : le foyer compte 2 membres.
  const code = (await rpc(request, jetonX, "generer_code_invitation", {})) as string;
  await rpc(request, jetonY, "rejoindre_foyer", { p_code: code });

  // Un planning sur le cycle affiché par défaut, pour que /courses ait une liste.
  const recettes = await recettesCatalogue(request, jetonX, 2);
  await enregistrerPlanning(request, jetonX, SEMAINE, [
    { jour: "lundi", recetteId: recettes[0]!.id },
    { jour: "mardi", recetteId: recettes[1]!.id },
  ]);

  const x = await ouvrirCourses(browser, emailX);
  const y = await ouvrirCourses(browser, emailY);

  // Présence (RG-31) : chacun voit l'autre membre sur la liste.
  for (const page of [x, y]) {
    await expect(page.getByText("Un autre membre est aussi sur la liste")).toBeVisible({ timeout: 20_000 });
  }

  // Coches (RG-32) : X coche, Y la voit sans rechargement ; X décoche, Y aussi.
  await x.getByRole("checkbox").first().click();
  await expect(x.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await expect(y.getByRole("checkbox", { checked: true })).toHaveCount(1, { timeout: 15_000 });
  await x.getByRole("checkbox", { checked: true }).click();
  await expect(y.getByRole("checkbox", { checked: true })).toHaveCount(0, { timeout: 15_000 });

  expect(gardesCrash.flatMap((g) => g.erreurs)).toEqual([]);
  await x.context().close();
  await y.context().close();
});
