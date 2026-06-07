// Parcours CRUD recettes — création, édition, duplication, suppression (#2).
// Session authentifiée (storageState). Écrit en base (staging en CI) : chaque
// recette de test porte le SUFFIXE du run pour être identifiable, et un
// teardown (afterAll) supprime tout ce que le run a créé — pas d'accumulation.

import { test, expect, type Page } from "@playwright/test";

// Suffixe unique au run (Date.now est autorisé dans les tests Playwright).
const SUFFIXE = `${Date.now()}`;

// Supprime via l'UI toutes les recettes personnelles dont le nom contient le
// SUFFIXE du run (teardown). Boucle bornée par sécurité.
async function nettoyer(page: Page): Promise<void> {
  await page.goto("/recettes");
  await page.getByPlaceholder("Rechercher une recette…").fill(SUFFIXE);
  const boutonsLigne = page.locator("main li").getByRole("button", {
    name: "Supprimer",
  });
  for (let i = 0; i < 30; i++) {
    if ((await boutonsLigne.count()) === 0) break;
    await boutonsLigne.first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer" })
      .click();
    await expect(page.getByText("Recette supprimée").first()).toBeVisible();
    // Laisse la liste se rafraîchir avant l'itération suivante.
    await page.waitForTimeout(300);
  }
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await nettoyer(page);
  await page.close();
});

// Crée une recette via le formulaire (helper).
async function creer(page: Page, nom: string): Promise<void> {
  await page.goto("/recettes");
  await page.getByRole("button", { name: "Nouvelle recette" }).click();
  await page.getByLabel("Nom de la recette").fill(nom);
  await page.getByLabel("Nom de l'ingrédient 1").fill("courgette");
  await page.getByLabel("Quantité de l'ingrédient 1").fill("3");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();
}

test("créer une recette personnelle la fait apparaître dans la liste", async ({
  page,
}) => {
  const nom = `E2E Tarte ${SUFFIXE}`;
  await creer(page, nom);

  const ligne = page.locator("li", { hasText: nom });
  await expect(ligne.getByRole("button", { name: "Modifier" })).toBeVisible();
  await expect(ligne.getByRole("button", { name: "Supprimer" })).toBeVisible();
});

test("éditer une recette personnelle met à jour son nom", async ({ page }) => {
  const nom = `E2E Gratin ${SUFFIXE}`;
  const nomModifie = `E2E Gratin maj ${SUFFIXE}`;
  await creer(page, nom);

  await page
    .locator("li", { hasText: nom })
    .getByRole("button", { name: "Modifier" })
    .click();
  await expect(page.getByLabel("Nom de la recette")).toHaveValue(nom);
  await page.getByLabel("Nom de la recette").fill(nomModifie);
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Recette modifiée")).toBeVisible();
  await expect(page.locator("li", { hasText: nomModifie })).toBeVisible();
});

test("dupliquer une recette du catalogue crée une copie personnelle", async ({
  page,
}) => {
  const nomCopie = `E2E Copie ${SUFFIXE}`;
  await page.goto("/recettes");

  // Première recette du catalogue (lecture seule) → Dupliquer.
  const ligneCatalogue = page
    .locator("main li")
    .filter({ hasText: "Catalogue" })
    .first();
  await ligneCatalogue.getByRole("button", { name: "Dupliquer" }).click();

  await expect(
    page.getByRole("heading", { name: "Dupliquer la recette" })
  ).toBeVisible();
  // Le formulaire est pré-rempli (nom suffixé « (copie) »).
  await expect(page.getByLabel("Nom de la recette")).toHaveValue(/\(copie\)$/);
  await page.getByLabel("Nom de la recette").fill(nomCopie);
  await page.getByRole("button", { name: "Enregistrer" }).click();

  // La copie est une recette personnelle (éditable + supprimable).
  await expect(page.getByText("Recette créée")).toBeVisible();
  const ligne = page.locator("li", { hasText: nomCopie });
  await expect(ligne.getByRole("button", { name: "Modifier" })).toBeVisible();
});

test("supprimer une recette demande confirmation puis la retire (RG-01)", async ({
  page,
}) => {
  const nom = `E2E ASupprimer ${SUFFIXE}`;
  await creer(page, nom);

  await page
    .locator("li", { hasText: nom })
    .getByRole("button", { name: "Supprimer" })
    .click();

  // Boîte de confirmation (RG-01).
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Supprimer cette recette ?" })
  ).toBeVisible();

  // Annuler ne supprime pas.
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();

  // Confirmer supprime.
  await page
    .locator("li", { hasText: nom })
    .getByRole("button", { name: "Supprimer" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Recette supprimée")).toBeVisible();
  await expect(page.locator("li", { hasText: nom })).toHaveCount(0);
});

test("une recette du catalogue global est en lecture seule (pas de suppression)", async ({
  page,
}) => {
  await page.goto("/recettes");
  const ligneCatalogue = page
    .locator("main li")
    .filter({ hasText: "Catalogue" })
    .first();
  await expect(ligneCatalogue).toBeVisible();
  await expect(
    ligneCatalogue.getByRole("button", { name: "Modifier" })
  ).toHaveCount(0);
  await expect(
    ligneCatalogue.getByRole("button", { name: "Supprimer" })
  ).toHaveCount(0);
});

test("la recherche filtre la liste des recettes", async ({ page }) => {
  await page.goto("/recettes");
  await expect(page.locator("main li").first()).toBeVisible();
  await page.getByPlaceholder("Rechercher une recette…").fill("zzzzz-introuvable");
  await expect(page.getByText(/Aucune recette ne correspond/)).toBeVisible();
});
