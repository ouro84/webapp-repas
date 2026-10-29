// e2e/edition-vue-cycle.spec.ts
// Édition complète depuis la vue Cycle (#279 suite, retour post-merge #281) —
// génération réelle, CI-only (catalogue seedé sur staging).

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  definirJourCoursesDistant,
  nettoyerEtatDistant,
  reinitialiserJourCoursesDistant,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

// Le cycle généré peut couvrir des jours déjà PASSÉS par rapport à la date
// réelle d'exécution (ex. lundi d'un cycle jeudi→jeudi si le run a lieu le
// jeudi) — la garde RG-24 (§3.e) affiche alors « Modifier un jour passé ? »
// avant d'appliquer l'édition. On confirme si elle apparaît, no-op sinon.
async function confirmerSiModaleJourPasse(page: Page): Promise<void> {
  const modale = page.getByRole("dialog", { name: "Modifier un jour passé ?" });
  const apparue = await modale
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (apparue) {
    await modale.getByRole("button", { name: "Modifier" }).click();
  }
}

test("changer un repas depuis la vue Cycle persiste au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^Plus d'actions/ }).first().click();
  const nomAvant = await page
    .locator("main button[aria-label^='Voir la recette']")
    .first()
    .textContent();
  await page.getByRole("button", { name: /^Changer/ }).first().click();
  await confirmerSiModaleJourPasse(page);
  await expect(page.getByText("Recette remplacée")).toBeVisible();

  await page.reload();
  const nomApres = await page
    .locator("main button[aria-label^='Voir la recette']")
    .first()
    .textContent();
  expect(nomApres).not.toBe(nomAvant);
});

test("modifier le nombre de personnes depuis la vue Cycle persiste au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  // Le stepper personnes n'est PAS gardé par la confirmation "jour passé"
  // (action mineure, même comportement que la vue Semaine).
  const boutonPlus = page.getByRole("button", { name: /^Plus de personnes/ }).first();
  await boutonPlus.click();
  await expect(page.getByText("3 pers.").first()).toBeVisible();

  // Stepper débouncé 800 ms (#301) : l'app passée en arrière-plan (mobile qui
  // verrouille, onglet quitté) doit envoyer l'écriture tout de suite, sinon un
  // rechargement ou une fermeture juste après le clic la perdrait.
  const envoi = page.waitForRequest("**/rest/v1/rpc/sauvegarder_slots", { timeout: 500 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const reponse = await (await envoi).response();
  expect(reponse?.ok()).toBe(true);

  await page.reload();
  await expect(page.getByText("3 pers.").first()).toBeVisible();
});

// Génère le cycle depuis la vue Cycle et attend la grille. Jour de courses =
// lundi (beforeEach) → le cycle coïncide avec la semaine affichée en vue
// Semaine : une double écriture sauvegarder_slots + sauvegarder_planning y
// serait observable.
async function genererCycleDepuisVueCycle(page: Page): Promise<void> {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });
}

async function lirePersonnes(carte: ReturnType<Page["locator"]>): Promise<number> {
  const texte = await carte.getByText(/\d+ pers\./).first().textContent();
  return Number(texte!.match(/(\d+) pers\./)![1]);
}

// #301 : une édition en vue Cycle remplaçait toute la grille par « Chargement… »
// (scroll perdu, stepper non recliquable) le temps d'un aller-retour réseau.
test("édition en vue Cycle : la grille reste affichée, une seule écriture après une rafale de clics (#301)", async ({
  page,
}) => {
  await genererCycleDepuisVueCycle(page);

  // Routes posées APRÈS la génération : on ne compte que les écritures de
  // l'édition. Le délai rend la fenêtre d'attente réseau observable.
  let appelsSlots = 0;
  let appelsPlanning = 0;
  await page.route("**/rest/v1/rpc/sauvegarder_slots", async (route) => {
    appelsSlots++;
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  await page.route("**/rest/v1/rpc/sauvegarder_planning", async (route) => {
    appelsPlanning++;
    await route.continue();
  });
  await page.evaluate(() => {
    const w = window as unknown as { __chargementVu: boolean };
    w.__chargementVu = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes("Chargement…")) w.__chargementVu = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  const carte = page.locator("main li").nth(4);
  await carte.scrollIntoViewIfNeeded();
  const scrollAvant = await page.evaluate(() => window.scrollY);
  expect(scrollAvant).toBeGreaterThan(0);
  const n = await lirePersonnes(carte);

  const plus = carte.getByRole("button", { name: /^Plus de personnes/ }).first();
  await plus.click();
  await plus.click();
  await plus.click();

  // Visible avant la fin de la RPC (1,5 s) : la mise à jour est optimiste.
  await expect(carte.getByText(`${n + 3} pers.`).first()).toBeVisible({ timeout: 1_000 });
  await expect.poll(() => appelsSlots, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(2_500); // débounce 800 ms + RPC 1,5 s + marge

  expect(appelsSlots).toBe(1);
  expect(appelsPlanning).toBe(0);
  expect(
    await page.evaluate(() => (window as unknown as { __chargementVu: boolean }).__chargementVu)
  ).toBe(false);
  const scrollApres = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollApres - scrollAvant)).toBeLessThanOrEqual(2);

  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.locator("main li").nth(4).getByText(`${n + 3} pers.`).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("édition en vue Cycle : échec réseau → valeur précédente restaurée + toast (#301)", async ({ page }) => {
  await genererCycleDepuisVueCycle(page);
  await page.route("**/rest/v1/rpc/sauvegarder_slots", (route) => route.abort());

  const carte = page.locator("main li").first();
  const n = await lirePersonnes(carte);
  await carte.getByRole("button", { name: /^Plus de personnes/ }).first().click();

  await expect(carte.getByText(`${n + 1} pers.`).first()).toBeVisible({ timeout: 1_000 });
  await expect(page.getByText("Impossible d'enregistrer la modification. Réessaie.")).toBeVisible({
    timeout: 5_000,
  });
  await expect(carte.getByText(`${n} pers.`).first()).toBeVisible();
});

test("marquer un repas en restes depuis la vue Cycle persiste au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^Plus d'actions/ }).first().click();
  await page.getByRole("button", { name: /^Marquer/ }).first().click();
  await confirmerSiModaleJourPasse(page);
  await expect(page.getByText("Repas marqué « Restes »")).toBeVisible();
  await expect(page.getByText("Restes").first()).toBeVisible();

  await page.reload();
  await expect(page.getByText("Restes").first()).toBeVisible();
});

// Régression : un cycle non calendaire (jour de courses ≠ lundi) chevauche
// TOUJOURS deux semaines ISO (ex. ancre=vendredi → vendredi/samedi/dimanche
// dans une semaine, lundi-jeudi dans la suivante, cf. lib/cycles.ts). Éditer
// un jour du groupe minoritaire déclenchait silencieusement la disparition de
// TOUS ses jours si la lecture de sa semaine échouait (`.catch(() => null)`
// confondait « pas de planning » et « lecture échouée » dans `chargerCycle`).
// Aucune autre spec ne fait varier le jour de courses (toutes le remettent à
// lundi), donc ce chevauchement n'était jamais exercé.
test("cycle chevauchant deux semaines ISO — éditer vendredi/samedi/dimanche ne fait disparaître aucun jour", async ({
  page,
  request,
}) => {
  await definirJourCoursesDistant(request, 5); // vendredi

  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li")).toHaveCount(7, { timeout: 20_000 });

  const carteVendredi = page.locator("main li").filter({ hasText: /^Vendredi/ });
  await carteVendredi.getByRole("button", { name: /^Plus d'actions/ }).first().click();
  await carteVendredi.getByRole("button", { name: /^Changer/ }).first().click();
  await confirmerSiModaleJourPasse(page);
  await expect(page.getByText("Recette remplacée")).toBeVisible();

  // Les 7 jours (dont samedi/dimanche, même semaine ISO que vendredi) restent
  // tous affichés avec un repas — aucun "Rien de prévu" fantôme.
  await expect(page.locator("main li")).toHaveCount(7);
  await expect(page.getByText("Rien de prévu")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("main li")).toHaveCount(7);
  await expect(page.getByText("Rien de prévu")).toHaveCount(0);
});

// Revue #301 : une édition faite PENDANT « Générer mon cycle » armait une
// écriture débouncée de l'ANCIEN jour, qui partait après la génération et
// écrasait silencieusement le jour généré. Les éditions sont donc bloquées
// tant que la génération court.
test("édition en vue Cycle bloquée pendant « Générer mon cycle » (#301)", async ({ page }) => {
  await genererCycleDepuisVueCycle(page);
  await page.route("**/api/planning/generer", async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });

  const carte = page.locator("main li").first();
  const n = await lirePersonnes(carte);
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.getByRole("button", { name: "Génération…" })).toBeVisible();
  let appelsSlots = 0;
  page.on("request", (req) => {
    if (req.url().includes("/rest/v1/rpc/sauvegarder_slots")) appelsSlots++;
  });
  await carte.getByRole("button", { name: /^Plus de personnes/ }).first().click();

  // Ni affichage optimiste ni écriture tant que la génération n'a pas répondu.
  await page.waitForTimeout(1_000); // > débounce 800 ms, < délai de génération
  expect(appelsSlots).toBe(0);
  await expect(carte.getByText(`${n + 1} pers.`)).toHaveCount(0);
  await expect(page.getByText("Cycle généré")).toBeVisible({ timeout: 20_000 });
});
