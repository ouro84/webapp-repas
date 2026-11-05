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

// #334 : régénérer un cycle déjà rempli écrase les repas et purge les coches du
// foyer, sans undo → confirmation (miroir de RG-74 côté MCP). Cycle vide :
// génération directe (test précédent, aucune modale).
test("régénérer un cycle déjà rempli depuis la vue Cycle demande confirmation (#334)", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });
  const recettesAvant = await page
    .locator("main button[aria-label^='Voir la recette']")
    .allTextContents();

  // Annuler : rien ne change.
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  const modale = page.getByRole("dialog", { name: "Régénérer ce cycle ?" });
  await expect(modale).toBeVisible();
  await modale.getByRole("button", { name: "Annuler" }).click();
  await expect(modale).not.toBeVisible();
  expect(
    await page.locator("main button[aria-label^='Voir la recette']").allTextContents()
  ).toEqual(recettesAvant);

  // Confirmer : le cycle est régénéré.
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await modale.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.getByText("Cycle généré").last()).toBeVisible({ timeout: 20_000 });
});

test("le lien « Liste de courses → » depuis la vue Cycle conserve la même fenêtre", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  // #352 : le navigateur de période (libellé relatif + dates) remplace « Courses du… ».
  const navigateurCycle = page.getByRole("group", { name: "Naviguer entre les cycles" });
  const libelleCycle = (await navigateurCycle.innerText()).trim();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL(/\/courses/);
  // Même fenêtre affichée des deux côtés (pas de saut vers le défaut du jour) —
  // preuve que l'ancre a été appliquée. On ne teste PAS la présence de `?ancre=`
  // dans l'URL : l'app le nettoie quasi immédiatement après application (relais
  // one-shot, cf. app/courses/page.tsx), une assertion dessus serait racy par
  // construction (déjà vécu : le paramètre disparaît souvent avant que
  // `toHaveURL` n'ait eu la moindre chance de l'observer).
  await expect(navigateurCycle).toHaveText(libelleCycle);
  // Le paramètre est bien nettoyé une fois appliqué (comportement one-shot).
  await expect(page).toHaveURL(/\/courses$/);
});

test("le choix de vue Cycle survit au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();
});
