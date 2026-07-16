// e2e/coherence-semaine-cycle.spec.ts
// Couverture des retours utilisateurs #279 : génération depuis la vue Cycle,
// cohérence de fenêtre entre /planning (vue Cycle) et /courses, persistance
// du choix de vue.

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test("« Générer mon cycle » est accessible et fonctionne depuis la vue Cycle de /planning", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Générer mon cycle" })).toBeVisible();

  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  // Une recette apparaît dans la projection (génération réelle, catalogue seedé CI-only).
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });
});

test("le lien « Liste de courses → » depuis la vue Cycle conserve la même fenêtre", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  const libelleCycle = await page.getByText(/Courses du/).textContent();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await expect(page).toHaveURL(/\/courses\?ancre=/);
  // Même fenêtre affichée des deux côtés (pas de saut vers le défaut du jour).
  await expect(page.getByText(libelleCycle!)).toBeVisible();
  // Le paramètre est nettoyé après application (pas de re-déclenchement au reload).
  await page.reload();
  await expect(page).toHaveURL(/\/courses$/);
});

test("le choix de vue Cycle survit au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();
});
