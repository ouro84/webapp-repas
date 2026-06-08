// Parcours critiques n°2 — la liste de courses (US-03, RG-05)
// et n°3 — les articles cochables en magasin (US-05, RG-10 à RG-14).
// Session authentifiée via le projet "setup" (storageState).

import { test, expect } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant } from "./helpers";
import type { Jour, Planning } from "../types";

test.beforeEach(async ({ page, request }) => {
  // État distant vierge (#6) : sinon un planning persisté réapparaîtrait à
  // l'hydratation (casse l'état vide attendu par le test « après génération »).
  // Les clés de sync locales sont purgées avant chaque chargement ; les tests
  // posent eux-mêmes planning_courant via leur propre addInitScript.
  await nettoyerEtatDistant(request);
  await page.addInitScript(() => {
    localStorage.removeItem("planning_courant_maj");
    localStorage.removeItem("planning_dirty");
  });
});

// Planning déterministe injecté en localStorage (découplage, issue #29).
// Composition agrégée attendue (fixtures figées) : 7 articles à acheter —
// Produits frais : crème fraîche (briquette), oeufs (9), parmesan (50 g),
// pâte brisée ; Légumes & Fruits : champignons de Paris ; Épicerie :
// tagliatelles ; Viandes & Poissons : lardons — et 4 au fond de placard
// (beurre, huile d'olive, poivre, sel).
function planningDeterministe(): Planning {
  const choisies = [
    recetteFixture("omelette-aux-champignons"),
    recetteFixture("tagliatelles-au-parmesan"),
    recetteFixture("quiche-aux-lardons"),
  ];
  const jours: Jour[] = ["lundi", "mardi", "mercredi"];
  return {
    semaine: "2026-W23",
    jours: choisies.map((recette, i) => ({ jour: jours[i]!, diner: recette })),
  };
}

test("après génération d'un planning, la liste de courses n'est pas vide", async ({
  page,
}) => {
  // Parcours réel : générer le planning puis naviguer vers les courses.
  await page.addInitScript(() => localStorage.removeItem("planning_courant"));
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");

  await expect(
    page.getByRole("heading", { name: "Liste de courses" })
  ).toBeVisible();
  // Le compteur de progression confirme une liste non vide (« 0/38 articles … », US-05).
  await expect(page.getByText(/^0\/[1-9]\d* articles?/)).toBeVisible();
  // Au moins une catégorie et plusieurs lignes d'ingrédients.
  await expect(page.locator("main section h2").first()).toBeVisible();
  expect(await page.locator("main li").count()).toBeGreaterThan(0);
});

test("les catégories d'ingrédients et le fond de placard sont visibles", async ({
  page,
}) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  // Les sections de catégories attendues pour ces recettes (RG-05, étape 5).
  for (const categorie of ["Viandes & Poissons", "Produits frais", "Épicerie"]) {
    await expect(
      page.getByRole("heading", { name: categorie })
    ).toBeVisible();
  }

  // La section fond de placard et sa consigne (F-09).
  await expect(
    page.getByRole("heading", { name: "Fond de placard" })
  ).toBeVisible();
  await expect(page.getByText("À vérifier avant d'acheter")).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-05 — articles cochables (RG-10 à RG-14)
// ---------------------------------------------------------------------------

test("cocher un article le raye, l'envoie en fin de catégorie et persiste au rechargement", async ({
  page,
}) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  const produitsFrais = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Produits frais" }) });

  // Avant : « crème fraîche » est en tête de sa catégorie (ordre alphabétique).
  await expect(produitsFrais.locator("li").first()).toContainText("crème fraîche");

  // Cocher (RG-10) : la ligne entière est cliquable via le label.
  await page.getByRole("checkbox", { name: /crème fraîche/ }).click();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).toBeChecked();

  // RG-11 : rayé + déplacé en fin de catégorie. RG-14 : compteur à 1/7.
  await expect(produitsFrais.locator("li").last()).toContainText("crème fraîche");
  await expect(
    produitsFrais.locator("li").last().locator("span").first()
  ).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByText(/^1\/7 articles/)).toBeVisible();

  // RG-12 : la coche survit à un rechargement de page.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).toBeChecked();
  await expect(page.getByText(/^1\/7 articles/)).toBeVisible();

  // Décocher : retour à la place alphabétique, compteur à 0.
  await page.getByRole("checkbox", { name: /crème fraîche/ }).click();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).not.toBeChecked();
  await expect(produitsFrais.locator("li").first()).toContainText("crème fraîche");
  await expect(page.getByText(/^0\/7 articles/)).toBeVisible();
});

test("le fond de placard est cochable mais n'entre pas dans la progression (RG-14)", async ({
  page,
}) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  await page.getByRole("checkbox", { name: /beurre/ }).click();

  // Coché visuellement… mais le compteur d'articles à acheter reste à 0.
  await expect(page.getByRole("checkbox", { name: /beurre/ })).toBeChecked();
  await expect(page.getByText(/^0\/7 articles/)).toBeVisible();
});

test("« Tout décocher » retire toutes les coches, fond de placard compris", async ({
  page,
}) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  // Le bouton n'apparaît qu'à partir de la première coche.
  await expect(page.getByRole("button", { name: "Tout décocher" })).toHaveCount(0);

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /beurre/ }).click();
  await expect(page.getByRole("checkbox", { name: /beurre/ })).toBeChecked();
  await expect(page.getByText(/^1\/7 articles/)).toBeVisible();

  await page.getByRole("button", { name: "Tout décocher" }).click();

  await expect(page.getByText(/^0\/7 articles/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /lardons/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /beurre/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Tout décocher" })).toHaveCount(0);
});

test("une section de catégorie se replie et se déplie (US-05)", async ({ page }) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  const enTete = page.getByRole("button", { name: "Épicerie" });
  const tagliatelles = page.getByRole("checkbox", { name: /tagliatelles/ });

  await expect(tagliatelles).toBeVisible();
  await enTete.click();
  await expect(enTete).toHaveAttribute("aria-expanded", "false");
  await expect(tagliatelles).toHaveCount(0); // section repliée : liste démontée
  await enTete.click();
  await expect(tagliatelles).toBeVisible();
});

test("regénérer le planning réinitialise toutes les coches (RG-13)", async ({
  page,
}) => {
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planningDeterministe())
  );
  await page.goto("/courses");

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.getByText(/^1\/7 articles/)).toBeVisible();

  // Génération complète depuis la page planning (vraies recettes, liste
  // non déterministe) : les coches doivent être effacées (RG-13).
  await page.goto("/planning");
  await page.getByRole("button", { name: "Regénérer" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page.goto("/courses");
  await expect(page.getByText(/^0\/[1-9]\d* articles?/)).toBeVisible();
});

test("les libellés s'accordent en nombre selon la quantité (US-08)", async ({
  page,
}) => {
  // Planning forgé : un ingrédient pièce au singulier (1), un au pluriel (3),
  // un nom de masse invariable (200 g). La page lit le planning brut depuis
  // localStorage — pas besoin que la recette existe dans le dataset (#29).
  const planning = {
    semaine: "2026-W23",
    jours: [
      {
        jour: "lundi",
        diner: {
          id: "test-accord",
          nom: "Test accord",
          tempsPreparation: "rapide",
          ingredients: [
            { nom: "carottes", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
            { nom: "tomates", quantite: 3, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
            { nom: "beurre", quantite: 200, unite: "g", categorie: "produits-frais", fondDePlacard: false },
          ],
        },
      },
    ],
  };
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
  );
  await page.goto("/courses");

  // Quantité 1 → singulier ; quantité 3 → pluriel ; masse → invariable.
  await expect(page.getByText("carotte", { exact: true })).toBeVisible();
  await expect(page.getByText("tomates", { exact: true })).toBeVisible();
  await expect(page.getByText("beurre", { exact: true })).toBeVisible();
});
