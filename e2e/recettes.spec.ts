// Parcours CRUD recettes — création, édition, duplication, suppression (#2).
// Session authentifiée (storageState). Écrit en base (staging en CI) : chaque
// recette de test porte le SUFFIXE du run pour être identifiable, et un
// teardown (afterAll) supprime tout ce que le run a créé — pas d'accumulation.

import { test, expect } from "./fixtures";
import { request as apiRequest, type Page } from "@playwright/test";
import { nettoyerRecettesDistantes, nettoyerMasquagesDistants } from "./helpers";

// Suffixe unique au run (Date.now est autorisé dans les tests Playwright).
const SUFFIXE = `${Date.now()}`;

// Recette du catalogue par défaut (seedée par migration, nom stable) servant de
// cible aux tests « catalogue ». Depuis #105 PR2, « Modifier » est UNIFORME → on
// ne peut plus repérer une recette par défaut par l'absence de ce bouton ; on la
// cible par son nom exact.
const RECETTE_CATALOGUE = "Poulet basquaise";

// Les masquages (#105 : « suppression » d'une recette du catalogue) persistent
// en base pour le compte de test partagé. On les purge AVANT chaque test (un
// résidu fausserait le vivier / l'absence d'une recette du catalogue) et APRÈS
// la série, en plus du nettoyage des recettes perso du run.
test.beforeEach(async () => {
  const contexte = await apiRequest.newContext();
  try {
    await nettoyerMasquagesDistants(contexte);
  } finally {
    await contexte.dispose();
  }
});

// Teardown : supprime les recettes du run + les masquages résiduels via DELETE
// REST (rapide, robuste). Remplace l'ancienne suppression par clics UI, dont le
// re-render de liste faisait dépasser le timeout afterAll (« element detached »).
test.afterAll(async () => {
  const contexte = await apiRequest.newContext();
  try {
    await nettoyerRecettesDistantes(contexte, SUFFIXE);
    await nettoyerMasquagesDistants(contexte);
  } finally {
    await contexte.dispose();
  }
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

  // Une recette du catalogue par défaut, ciblée par son nom exact → Dupliquer.
  const ligneCatalogue = page
    .locator("main li")
    .filter({ has: page.getByText(RECETTE_CATALOGUE, { exact: true }) });
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

test("supprimer une recette perso la retire, avec undo (#105)", async ({
  page,
}) => {
  const nom = `E2E ASupprimer ${SUFFIXE}`;
  await creer(page, nom);

  // Plus de confirmation : la suppression est immédiate + toast d'undo.
  await page
    .locator("li", { hasText: nom })
    .getByRole("button", { name: "Supprimer" })
    .click();
  await expect(page.getByText("Recette supprimée")).toBeVisible();
  await expect(page.locator("li", { hasText: nom })).toHaveCount(0);

  // « Annuler » recrée la recette perso (US-09-like undo).
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Annulé")).toBeVisible();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();
});

test("supprimer une recette du catalogue la masque, avec undo (#105)", async ({
  page,
}) => {
  await page.goto("/recettes");
  const nom = RECETTE_CATALOGUE;
  const ligne = page
    .locator("main li")
    .filter({ has: page.getByText(nom, { exact: true }) });
  await expect(ligne).toBeVisible();

  await ligne.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Recette supprimée")).toBeVisible();
  await expect(page.locator("li", { hasText: nom })).toHaveCount(0);

  // « Annuler » démasque la recette par défaut → elle réapparaît.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Annulé")).toBeVisible();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();
});

test("modifier une recette du catalogue crée une copie perso et masque l'originale (#105 PR2)", async ({
  page,
}) => {
  const nomModifie = `E2E Modif Catalogue ${SUFFIXE}`;
  await page.goto("/recettes");
  const ligne = page
    .locator("main li")
    .filter({ has: page.getByText(RECETTE_CATALOGUE, { exact: true }) });
  await expect(ligne).toBeVisible();

  // « Modifier » est uniforme : sur une recette par défaut, le formulaire
  // s'ouvre pré-rempli ; l'enregistrement duplique en perso + masque l'originale.
  await ligne.getByRole("button", { name: "Modifier" }).click();
  await expect(
    page.getByRole("heading", { name: "Modifier la recette" })
  ).toBeVisible();
  await expect(page.getByLabel("Nom de la recette")).toHaveValue(RECETTE_CATALOGUE);
  await page.getByLabel("Nom de la recette").fill(nomModifie);
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Recette modifiée")).toBeVisible();
  // Ma version (perso, éditable) apparaît…
  await expect(
    page.locator("li", { hasText: nomModifie }).getByRole("button", { name: "Modifier" })
  ).toBeVisible();
  // …et l'originale par défaut a disparu (masquée derrière ma copie).
  await expect(
    page
      .locator("main li")
      .filter({ has: page.getByText(RECETTE_CATALOGUE, { exact: true }) })
  ).toHaveCount(0);
});

test("une recette végétarienne porte le badge et passe le filtre (#86)", async ({
  page,
}) => {
  // `creer` ajoute un ingrédient « légumes-fruits » → l'heuristique pré-coche
  // « végétarienne » (B3), donc la recette créée est végé.
  const nom = `E2E Vege ${SUFFIXE}`;
  await creer(page, nom);

  const ligne = page.locator("li", { hasText: nom });
  // Le badge reflète la valeur relue depuis la base (round-trip du flag).
  await expect(ligne.getByText("Végétarien")).toBeVisible();

  // Le filtre « Végétariennes seulement » la conserve.
  await page.getByLabel("Végétariennes seulement").check();
  await expect(page.locator("li", { hasText: nom })).toBeVisible();
});

test("la recherche filtre la liste des recettes", async ({ page }) => {
  await page.goto("/recettes");
  await expect(page.locator("main li").first()).toBeVisible();
  await page.getByPlaceholder("Rechercher une recette…").fill("zzzzz-introuvable");
  await expect(page.getByText(/Aucune recette ne correspond/)).toBeVisible();
});
