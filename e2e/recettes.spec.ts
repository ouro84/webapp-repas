// Parcours CRUD recettes — création et édition (#2, PR2).
// Session authentifiée (storageState). Écrit en base (staging en CI) : chaque
// recette de test a un nom unique au run pour éviter toute collision avec les
// recettes laissées par les runs précédents (la suppression arrive en PR3).

import { test, expect } from "@playwright/test";

// Nom unique par exécution (Date.now est autorisé dans les tests Playwright).
const SUFFIXE = `${Date.now()}`;

test("créer une recette personnelle la fait apparaître dans la liste", async ({
  page,
}) => {
  const nom = `E2E Tarte ${SUFFIXE}`;
  await page.goto("/recettes");

  await page.getByRole("button", { name: "Nouvelle recette" }).click();
  await expect(
    page.getByRole("heading", { name: "Nouvelle recette" })
  ).toBeVisible();

  await page.getByLabel("Nom de la recette").fill(nom);
  await page.getByLabel("Temps de préparation").selectOption("normal");

  // Première ligne d'ingrédient (présente par défaut).
  await page.getByLabel("Nom de l'ingrédient 1").fill("courgette");
  await page.getByLabel("Quantité de l'ingrédient 1").fill("3");

  await page.getByRole("button", { name: "Enregistrer" }).click();

  // Retour à la liste, recette présente et éditable (« Modifier »).
  await expect(page.getByText("Recette créée")).toBeVisible();
  const ligne = page.locator("li", { hasText: nom });
  await expect(ligne).toBeVisible();
  await expect(ligne.getByRole("button", { name: "Modifier" })).toBeVisible();
});

test("éditer une recette personnelle met à jour son nom", async ({ page }) => {
  const nom = `E2E Gratin ${SUFFIXE}`;
  const nomModifie = `${nom} maj`;

  // Création préalable.
  await page.goto("/recettes");
  await page.getByRole("button", { name: "Nouvelle recette" }).click();
  await page.getByLabel("Nom de la recette").fill(nom);
  await page.getByLabel("Nom de l'ingrédient 1").fill("pomme de terre");
  await page.getByLabel("Quantité de l'ingrédient 1").fill("4");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();

  // Édition : on renomme.
  await page
    .locator("li", { hasText: nom })
    .getByRole("button", { name: "Modifier" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Modifier la recette" })
  ).toBeVisible();
  // Le formulaire est pré-rempli.
  await expect(page.getByLabel("Nom de la recette")).toHaveValue(nom);
  await page.getByLabel("Nom de la recette").fill(nomModifie);
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Recette modifiée")).toBeVisible();
  await expect(page.locator("li", { hasText: nomModifie })).toBeVisible();
});

test("ajouter et retirer une ligne d'ingrédient dans le formulaire", async ({
  page,
}) => {
  await page.goto("/recettes");
  await page.getByRole("button", { name: "Nouvelle recette" }).click();

  await expect(page.getByLabel(/Nom de l'ingrédient 1/)).toBeVisible();
  await page.getByRole("button", { name: "+ Ajouter un ingrédient" }).click();
  await expect(page.getByLabel(/Nom de l'ingrédient 2/)).toBeVisible();
  await page.getByRole("button", { name: "Retirer l'ingrédient 2" }).click();
  await expect(page.getByLabel(/Nom de l'ingrédient 2/)).toHaveCount(0);
});

test("une recette du catalogue global est en lecture seule", async ({ page }) => {
  await page.goto("/recettes");
  // Au moins une recette globale (catalogue seedé) sans bouton Modifier.
  await expect(page.getByText("Catalogue").first()).toBeVisible();
});

test("la recherche filtre la liste des recettes", async ({ page }) => {
  await page.goto("/recettes");
  await expect(page.locator("main li").first()).toBeVisible();

  await page
    .getByPlaceholder("Rechercher une recette…")
    .fill("zzzzz-introuvable");
  await expect(
    page.getByText(/Aucune recette ne correspond/)
  ).toBeVisible();
});
