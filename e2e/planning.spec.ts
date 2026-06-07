// Parcours critique n°1 — le planning (US-01, US-04).
// Session authentifiée via le projet "setup" (storageState).
//
// Chaque test repart d'un localStorage sans planning : l'état initial
// est donc déterministe (état vide, RG-09) malgré la persistance (F-11).

import { test, expect } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";

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

// ---------------------------------------------------------------------------
// US-06 — sélection manuelle d'une recette (RG-15).
// Les assertions restent découplées du contenu de data/recettes.json : les
// noms de recettes sont lus dynamiquement dans le sélecteur (issue #29).
// ---------------------------------------------------------------------------

test("sélectionner manuellement une recette remplace le slot visé, le reste est intact", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);

  const carteLundi = jours.first();
  const carteMardi = jours.nth(1);
  const mardiAvant = await carteMardi.innerText();

  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();

  // Le sélecteur s'ouvre, titré du slot visé, recherche en tête.
  const selecteur = page.getByRole("dialog");
  await expect(selecteur).toBeVisible();
  await expect(
    selecteur.getByRole("heading", { name: "Dîner de lundi" })
  ).toBeVisible();

  // Choix dynamique : la première recette de la liste (nom lu, pas codé en dur).
  const premiereRecette = selecteur.locator("ul button").first();
  const nomChoisi = (await premiereRecette.locator("span").first().innerText()).trim();
  await premiereRecette.click();

  // Sélecteur fermé, slot remplacé par la recette choisie, mardi intact.
  await expect(selecteur).not.toBeVisible();
  await expect(page.getByText("Recette remplacée")).toBeVisible();
  await expect(carteLundi).toContainText(nomChoisi);
  expect(await carteMardi.innerText()).toBe(mardiAvant);

  // Doublon éclairé (RG-15) : la recette posée sur lundi est signalée
  // quand on rouvre le sélecteur pour un autre slot.
  await carteMardi
    .getByRole("button", { name: "Sélectionner le dîner de mardi" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .locator("li", { hasText: nomChoisi })
      .getByText("déjà au planning")
  ).toBeVisible();
});

test("la recherche du sélecteur filtre la liste et gère l'absence de résultat", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  const selecteur = page.getByRole("dialog");
  const lignes = selecteur.locator("ul button");
  const totalAvant = await lignes.count();
  expect(totalAvant).toBeGreaterThan(1);

  // Requête = nom complet de la dernière recette de la liste : le filtrage
  // doit réduire la liste et conserver cette recette.
  const nomCible = (
    await lignes.last().locator("span").first().innerText()
  ).trim();
  const recherche = selecteur.getByRole("searchbox", {
    name: "Rechercher une recette",
  });
  await recherche.fill(nomCible);

  await expect(selecteur.locator("ul button", { hasText: nomCible }).first()).toBeVisible();
  expect(await lignes.count()).toBeLessThan(totalAvant);

  // Aucun résultat → état vide explicite, pas de liste fantôme (RG-09).
  await recherche.fill("zzzzzzzz");
  await expect(selecteur.getByText(/^Aucune recette ne correspond à/)).toBeVisible();
  await expect(lignes).toHaveCount(0);
});

test("fermer le sélecteur avec Échap ne modifie pas le planning", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const carteLundi = page.locator("main ul > li").first();
  const lundiAvant = await carteLundi.innerText();

  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await carteLundi.innerText()).toBe(lundiAvant);
});

test("une sélection manuelle conserve les coches de la liste de courses (RG-15/RG-12)", async ({
  page,
}) => {
  // Planning généré, puis un article coché côté courses.
  // Navigation par les LIENS de l'app (SPA) et non page.goto : un chargement
  // complet rejouerait l'init script du beforeEach, qui purge le planning.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  const premierArticle = page.getByRole("checkbox").first();
  const nomArticle = await premierArticle.evaluate(
    (input) => input.closest("label")?.querySelector("span")?.textContent ?? ""
  );
  await premierArticle.click();
  await expect(page.getByRole("checkbox", { name: nomArticle }).first()).toBeChecked();

  // Sélection manuelle du dîner de lundi… en re-choisissant LA MÊME recette
  // (permis par RG-15) : les agrégats de la liste ne bougent pas, le test est
  // déterministe — on vérifie précisément l'absence de reset global (RG-13),
  // pas l'invalidation par quantité (couverte en unitaire, RG-12).
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  const carteLundi = page.locator("main ul > li").first();
  const nomRecetteLundi = (await carteLundi.locator("p").nth(1).innerText()).trim();
  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  const selecteur = page.getByRole("dialog");
  await selecteur
    .getByRole("searchbox", { name: "Rechercher une recette" })
    .fill(nomRecetteLundi);
  await selecteur.locator("ul button", { hasText: nomRecetteLundi }).first().click();
  await expect(page.getByText("Recette remplacée")).toBeVisible();

  // La coche a survécu au remplacement (pas de réinitialisation, RG-13).
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: nomArticle }).first()).toBeChecked();
});

// ---------------------------------------------------------------------------
// US-07 — nombre de personnes par repas (RG-16/17).
// ---------------------------------------------------------------------------

test("le stepper de personnes est borné et persiste au rechargement", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const carteLundi = page.locator("main ul > li").first();
  await expect(carteLundi).toContainText("2 pers."); // défaut RG-16

  const plus = carteLundi.getByRole("button", {
    name: "Plus de personnes pour le dîner de lundi",
  });
  const moins = carteLundi.getByRole("button", {
    name: "Moins de personnes pour le dîner de lundi",
  });

  // À 2, on peut monter ; descendre deux fois borne à 1 (bouton désactivé).
  await moins.click();
  await expect(carteLundi).toContainText("1 pers.");
  await expect(moins).toBeDisabled();

  // Remonter à 4 et vérifier la persistance.
  await plus.click();
  await plus.click();
  await plus.click();
  await expect(carteLundi).toContainText("4 pers.");

  // Persistance via aller-retour SPA (et non reload : l'addInitScript du
  // beforeEach re-purgerait le planning — cf. piège documenté CLAUDE.md).
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  await expect(page.locator("main ul > li").first()).toContainText("4 pers.");
});

test("modifier le nombre de personnes met à l'échelle la liste de courses (RG-17)", async ({
  page,
}) => {
  // Planning déterministe : omelette (6 œufs) au dîner de lundi.
  const planning = {
    semaine: "2026-W23",
    jours: [{ jour: "lundi", diner: recetteFixture("omelette-aux-champignons") }],
  };
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
  );
  await page.goto("/planning");

  // 4 personnes sur le dîner de lundi → œufs ×2.
  const carteLundi = page.locator("main ul > li").first();
  await carteLundi
    .getByRole("button", { name: "Plus de personnes pour le dîner de lundi" })
    .click();
  await carteLundi
    .getByRole("button", { name: "Plus de personnes pour le dîner de lundi" })
    .click();
  await expect(carteLundi).toContainText("4 pers.");

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");

  // 6 œufs (recette) → 12 à 4 personnes.
  const ligneOeufs = page.locator("li", { hasText: "œufs" }).first();
  await expect(ligneOeufs).toContainText("12");
});

test("modifier les personnes invalide la coche de l'article touché, pas les autres (RG-12)", async ({
  page,
}) => {
  const planning = {
    semaine: "2026-W23",
    jours: [{ jour: "lundi", diner: recetteFixture("omelette-aux-champignons") }],
  };
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
  );
  await page.goto("/planning");

  // Cocher les œufs côté courses.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await page.getByRole("checkbox", { name: /œufs/ }).click();
  await expect(page.getByRole("checkbox", { name: /œufs/ })).toBeChecked();

  // Augmenter les personnes : la quantité d'œufs change → coche invalidée.
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  await page
    .locator("main ul > li")
    .first()
    .getByRole("button", { name: "Plus de personnes pour le dîner de lundi" })
    .click();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: /œufs/ })).not.toBeChecked();
});

test("une génération complète remet tous les repas à 2 personnes (RG-16)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const carteLundi = page.locator("main ul > li").first();
  await carteLundi
    .getByRole("button", { name: "Plus de personnes pour le dîner de lundi" })
    .click();
  await expect(carteLundi).toContainText("3 pers.");

  await page.getByRole("button", { name: "Regénérer" }).click();
  // .first() : la génération est désormais synchrone (#63), le toast de la 1re
  // génération peut coexister avec celui de la regénération (même libellé).
  await expect(page.getByText("Planning généré").first()).toBeVisible();
  await expect(page.locator("main ul > li").first()).toContainText("2 pers.");
});

test("la grille 7 colonnes n'apparaît qu'à partir du desktop (#64)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  // Mobile (viewport par défaut 390) : liste verticale (jours en toutes
  // lettres), la grille desktop (jours abrégés) est masquée.
  await expect(page.getByRole("heading", { name: "Lundi" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lun", exact: true })
  ).toBeHidden();

  // Desktop (≥ lg) : la grille 7 colonnes apparaît, la liste mobile disparaît.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Lun", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lundi" })).toBeHidden();
});
