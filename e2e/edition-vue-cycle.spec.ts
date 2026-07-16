// e2e/edition-vue-cycle.spec.ts
// Édition complète depuis la vue Cycle (#279 suite, retour post-merge #281) —
// génération réelle, CI-only (catalogue seedé sur staging).

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";

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

  await page.reload();
  await expect(page.getByText("3 pers.").first()).toBeVisible();
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
