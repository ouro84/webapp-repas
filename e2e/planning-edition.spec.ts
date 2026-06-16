// Parcours critique n°1 (suite) — édition du planning : nombre de personnes
// (US-07), annulation (US-09), fiche recette (US-10), responsive (#64).
//
// Scindé de planning.spec.ts (perf CI : exécution sur un compte dédié distinct,
// en parallèle de l'autre moitié) — MÊME beforeEach (état vierge) et MÊMES
// imports. Session authentifiée via le projet "setup" (storageState).

import { test, expect } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant } from "./helpers";
import { semaineISO } from "../lib/semaines";

test.beforeEach(async ({ page, request }) => {
  // Base vierge pour le compte de test (planning + coches).
  await nettoyerEtatDistant(request);
  // Purge le cache local AVANT le chargement de la page (toutes les clés de sync).
  await page.addInitScript(() => {
    for (const c of [
      "planning_courant",
      "planning_courant_maj",
      "planning_dirty",
      "courses_cochees",
      "courses_cochees_maj",
      "courses_dirty",
      "semaine_affichee",
    ]) {
      localStorage.removeItem(c);
    }
  });
  await page.goto("/planning");
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
    // Semaine COURANTE (calculée au run) : un planning injecté daté dans le
    // passé déclencherait la garde de confirmation #5 (RG-24) à la modif/regen.
    semaine: semaineISO(),
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
    // Semaine COURANTE (calculée au run) : un planning injecté daté dans le
    // passé déclencherait la garde de confirmation #5 (RG-24) à la modif/regen.
    semaine: semaineISO(),
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
  // La regénération affiche un toast d'annulation « Planning regénéré » (US-09),
  // distinct du « Planning généré » de la première génération.
  await expect(page.getByText("Planning regénéré")).toBeVisible();
  await expect(page.locator("main ul > li").first()).toContainText("2 pers.");
});

// ---------------------------------------------------------------------------
// US-09 — annuler une regénération (RG-19). Valide en CI (instance staging
// seedée) ; en local, la génération peut échouer si la base n'est pas seedée.
// ---------------------------------------------------------------------------

test("annuler une regénération restaure le planning précédent à l'identique (US-09)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const liste = page.locator("main ul");
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const planningInitial = await liste.innerText();

  await page.getByRole("button", { name: "Regénérer" }).click();
  // Toast d'annulation avec son action « Annuler ».
  await expect(page.getByText("Planning regénéré")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();

  // Confirmation + planning restauré à l'identique (US-09, RG-19).
  await expect(page.getByText("Annulé")).toBeVisible();
  await expect.poll(async () => liste.innerText()).toBe(planningInitial);
});

test("annuler une regénération au clavier (Ctrl/Cmd+Z) restaure le planning (US-09, RG-19)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const liste = page.locator("main ul");
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const planningInitial = await liste.innerText();

  await page.getByRole("button", { name: "Regénérer" }).click();
  await expect(page.getByText("Planning regénéré")).toBeVisible();

  // Raccourci clavier (et non le bouton du toast) : le handler de la page écoute
  // Ctrl/Cmd+Z hors champ de saisie. En CI (Linux) → Control.
  await page.keyboard.press("Control+z");

  await expect(page.getByText("Annulé")).toBeVisible();
  await expect.poll(async () => liste.innerText()).toBe(planningInitial);
});

test("annuler une regénération restaure aussi les coches effacées (US-09, RG-13/RG-19)", async ({
  page,
}) => {
  // Navigation par les LIENS de l'app (SPA) : un page.goto rejouerait
  // l'addInitScript du beforeEach, qui purge le planning.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  // Cocher un article côté courses.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  const premierArticle = page.getByRole("checkbox").first();
  const nomArticle = await premierArticle.evaluate(
    (input) => input.closest("label")?.querySelector("span")?.textContent ?? ""
  );
  await premierArticle.click();
  await expect(
    page.getByRole("checkbox", { name: nomArticle }).first()
  ).toBeChecked();

  // Regénérer efface les coches (RG-13) ; annuler doit les rendre (RG-19).
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  await page.getByRole("button", { name: "Regénérer" }).click();
  await expect(page.getByText("Planning regénéré")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Annulé")).toBeVisible();

  // La coche est de retour : l'undo est « à l'identique », pas planning seul.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(
    page.getByRole("checkbox", { name: nomArticle }).first()
  ).toBeChecked();
});

// ---------------------------------------------------------------------------
// US-10 — consulter la fiche d'une recette (RG-20). Planning déterministe
// injecté en localStorage : pas de dépendance au catalogue seedé.
// ---------------------------------------------------------------------------

test("la fiche d'une recette s'ouvre au clic sur le nom, à l'échelle du slot et groupée (US-10, RG-20)", async ({
  page,
}) => {
  // Omelette : œufs + champignons (à acheter), beurre + poivre (fond de placard).
  const planning = {
    // Semaine COURANTE (calculée au run) : un planning injecté daté dans le
    // passé déclencherait la garde de confirmation #5 (RG-24) à la modif/regen.
    semaine: semaineISO(),
    jours: [{ jour: "lundi", diner: recetteFixture("omelette-aux-champignons") }],
  };
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
  );
  await page.goto("/planning");

  const carteLundi = page.locator("main ul > li").first();
  // Passer le slot à 4 personnes (×2) avant d'ouvrir la fiche.
  const plus = carteLundi.getByRole("button", {
    name: "Plus de personnes pour le dîner de lundi",
  });
  await plus.click();
  await plus.click();
  await expect(carteLundi).toContainText("4 pers.");

  // Le nom du plat ouvre la fiche.
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toBeVisible();
  await expect(
    fiche.getByRole("heading", { name: "Omelette aux champignons" })
  ).toBeVisible();
  await expect(fiche).toContainText("pour 4 personnes");

  // Quantité mise à l'échelle (RG-20 via RG-17) : champignons 250 g → 500 g.
  await expect(fiche).toContainText("champignons de Paris");
  await expect(fiche).toContainText("500 g");

  // Ingrédients groupés (RG-14) : à acheter + fond de placard.
  await expect(fiche.getByRole("heading", { name: "À acheter" })).toBeVisible();
  await expect(
    fiche.getByRole("heading", { name: /^Fond de placard/ })
  ).toBeVisible();

  // Recette injectée HORS-BASE (id slug, absente du catalogue chargé) → pas de
  // raccourci « Modifier » : évite un lien mort (#137). Une recette par défaut
  // RÉELLE en propose un (cf. test suivant).
  await expect(fiche.getByText("Modifier la recette")).toHaveCount(0);

  // Fermeture native via Échap.
  await page.keyboard.press("Escape");
  await expect(fiche).not.toBeVisible();
});

test("la fiche d'une recette par défaut propose « Modifier » et mène au formulaire (#137)", async ({
  page,
}) => {
  // Génération RÉELLE (catalogue seedé) → CI-only. Toutes les recettes du
  // planning sont des recettes par défaut présentes dans le catalogue chargé →
  // la fiche doit proposer « Modifier la recette » (#137).
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.getByText("Planning généré")).toBeVisible();

  // Ouvre la fiche du premier repas (la carte lundi porte déjeuner + dîner).
  const carteLundi = page.locator("main ul > li").first();
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).first().click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toBeVisible();

  // Le raccourci « Modifier » est proposé et mène au formulaire d'édition
  // (sans enregistrer → aucune mutation : dup+masquage ne se déclenche qu'au save).
  const modifier = fiche.getByText("Modifier la recette");
  await expect(modifier).toBeVisible();
  await modifier.click();
  await expect(
    page.getByRole("heading", { name: "Modifier la recette" })
  ).toBeVisible();
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
