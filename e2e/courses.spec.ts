// Parcours critique n°2 — la liste de courses (US-03, RG-05).
// Session authentifiée via le projet "setup" (storageState).

import { test, expect } from "@playwright/test";
import recettesJson from "../data/recettes.json";
import type { Jour, Planning, Recette } from "../types";

const RECETTES = recettesJson as Recette[];

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
  // Le compteur confirme une liste non vide (« 38 articles … »).
  await expect(page.getByText(/^[1-9]\d* articles?/)).toBeVisible();
  // Au moins une catégorie et plusieurs lignes d'ingrédients.
  await expect(page.locator("main section h2").first()).toBeVisible();
  expect(await page.locator("main li").count()).toBeGreaterThan(0);
});

test("les catégories d'ingrédients et le fond de placard sont visibles", async ({
  page,
}) => {
  // Planning déterministe injecté en localStorage : des recettes réelles
  // choisies pour couvrir plusieurs catégories et le fond de placard.
  const ids = [
    "omelette-aux-fines-herbes", // produits-frais, legumes-fruits + sel/poivre/beurre
    "pates-au-pesto", // epicerie + huile d'olive
    "salade-cesar-au-poulet", // viandes-poissons
  ];
  const choisies = ids.map((id) => {
    const r = RECETTES.find((x) => x.id === id);
    if (!r) throw new Error(`Recette absente du dataset : ${id}`);
    return r;
  });
  const jours: Jour[] = ["lundi", "mardi", "mercredi"];
  const planning: Planning = {
    semaine: "2026-W23",
    jours: choisies.map((recette, i) => ({ jour: jours[i]!, diner: recette })),
  };

  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
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
