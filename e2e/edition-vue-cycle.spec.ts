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
