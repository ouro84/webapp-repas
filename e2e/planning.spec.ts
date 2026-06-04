// Parcours critique n°1 — le planning (US-01, US-04).
// Session authentifiée via le projet "setup" (storageState).
//
// Chaque test repart d'un localStorage sans planning : l'état initial
// est donc déterministe (état vide, RG-09) malgré la persistance (F-11).

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Purge le planning persisté AVANT le chargement de la page.
  await page.addInitScript(() => localStorage.removeItem("planning_courant"));
  await page.goto("/planning");
});

test("l'utilisateur arrive sur un état initial clair avec un bouton de génération", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Mon planning de la semaine" })
  ).toBeVisible();
  await expect(page.getByText("Aucun planning pour l'instant")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Générer mon planning" })
  ).toBeVisible();
});

test("la génération affiche un planning de 7 jours avec leurs 9 repas", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();

  // Confirmation utilisateur (toast sonner).
  await expect(page.getByText("Planning généré")).toBeVisible();

  // Vue mobile (RG-08) : une carte par jour, lundi → dimanche.
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);
  await expect(jours.first()).toContainText("Lundi");
  await expect(jours.last()).toContainText("Dimanche");

  // 9 repas : 7 dîners + 2 déjeuners (samedi, dimanche) — un bouton de
  // remplacement par slot.
  await expect(
    page.getByRole("button", { name: /^Changer le/ }).filter({ visible: true })
  ).toHaveCount(9);

  // Le numéro de semaine est affiché en clair (« Semaine du 1 juin 2026 »).
  await expect(page.getByText(/^Semaine du /)).toBeVisible();
});

test("l'utilisateur peut remplacer un repas sans toucher au reste du planning", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);

  const carteLundi = jours.first();
  const carteMardi = jours.nth(1);
  const lundiAvant = await carteLundi.innerText();
  const mardiAvant = await carteMardi.innerText();

  await carteLundi
    .getByRole("button", { name: "Changer le dîner de lundi" })
    .click();

  // Confirmation utilisateur, puis : lundi a changé, mardi est intact.
  await expect(page.getByText("Recette remplacée")).toBeVisible();
  await expect
    .poll(async () => carteLundi.innerText())
    .not.toBe(lundiAvant);
  expect(await carteMardi.innerText()).toBe(mardiAvant);
});
