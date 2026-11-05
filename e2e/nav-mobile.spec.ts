// e2e/nav-mobile.spec.ts
// Barre d'onglets mobile (#335) : les 4 destinations du quotidien, libellées,
// en bas d'écran sous `md:` ; barre du haut réduite à la marque, l'aide et le
// profil. Redirection d'un connecté de « / » vers /ce-soir.
// Ordre des sections identique en haut (≥ md) et en bas (#351).

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant } from "./helpers";

const onglets = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sections" });

test("les 4 onglets du bas sont libellés, dans l'ordre d'usage, avec l'onglet actif signalé (#335)", async ({
  page,
}) => {
  await page.goto("/planning");
  const barre = onglets(page);
  await expect(barre).toBeVisible();
  await expect(barre.getByRole("link")).toHaveText([
    /^Ce (midi|soir)$/,
    "Planning",
    "Courses",
    "Recettes",
  ]);
  await expect(barre.getByRole("link", { name: "Planning" })).toHaveAttribute(
    "aria-current",
    "page"
  );

  // Barre du haut : nom complet de l'app, aide et profil ; pas de doublon des
  // sections (masquées sous md:).
  const haut = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(haut.getByText("On mange quoi")).toBeVisible();
  await expect(haut.getByRole("link", { name: "Aide" })).toBeVisible();
  await expect(haut.getByRole("link", { name: "Courses" })).toHaveCount(0);

  // Navigation par onglet.
  await barre.getByRole("link", { name: "Courses" }).click();
  await page.waitForURL("**/courses");
  await expect(barre.getByRole("link", { name: "Courses" })).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("à 320 px, ni la barre du haut ni les onglets ne débordent (#335)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/planning");
  await expect(onglets(page)).toBeVisible();
  const debordement = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(debordement).toBe(0);
  // Chaque libellé tient dans son onglet (pas de troncature).
  for (const lien of await onglets(page).getByRole("link").all()) {
    const libelle = lien.locator("span").last();
    const { scrollWidth, clientWidth } = await libelle.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }
});

test("desktop : pas d'onglets en bas, sections libellées en haut dans l'ordre mobile (#335, #351)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/planning");
  await expect(onglets(page)).toBeHidden();
  const haut = page.getByRole("navigation", { name: "Navigation principale" });
  // Seuls les 4 liens de section (logo, aide et avatar exclus) ; « Ce midi »
  // ou « Ce soir » selon l'heure du run.
  const sectionsHaut = haut.getByRole("link", {
    name: /^(Ce (midi|soir)|Planning|Courses|Recettes)$/,
  });
  await expect(sectionsHaut).toHaveText([
    /^Ce (midi|soir)$/,
    "Planning",
    "Courses",
    "Recettes",
  ]);
  await expect(haut.getByRole("link", { name: "Planning" })).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("un connecté qui ouvre « / » arrive sur le prochain repas (#335)", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL("**/ce-soir");
  // Le logo y mène aussi directement.
  await page.goto("/planning");
  await page.getByRole("link", { name: "On mange quoi ? — accueil" }).click();
  await page.waitForURL("**/ce-soir");
});

test("les toasts s'affichent au-dessus de la barre d'onglets (#335)", async ({
  page,
  request,
}) => {
  await nettoyerEtatDistant(request);
  await page.addInitScript(() => {
    for (const c of ["planning_courant", "planning_courant_maj", "planning_dirty", "semaine_affichee"]) {
      localStorage.removeItem(c);
    }
  });
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const toast = page.getByText("Planning généré");
  await expect(toast).toBeVisible({ timeout: 20_000 });
  const boiteBarre = (await onglets(page).boundingBox())!;
  // Le toast entre en glissant depuis le bas (sonner) : mesurer une fois
  // l'animation finie, pas au premier instant visible.
  await expect
    .poll(async () => {
      const boite = await toast.boundingBox();
      return boite ? boite.y + boite.height : Infinity;
    })
    .toBeLessThanOrEqual(boiteBarre.y);
});
