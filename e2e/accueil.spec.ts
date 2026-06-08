// Identité de marque sur l'accueil (#59) : logo + nom « On mange quoi ? » +
// baseline, et lien de marque dans la nav. Page publique, pas de sync/DB.

import { test, expect } from "@playwright/test";

test("l'accueil affiche le nom et la baseline de marque (#59)", async ({
  page,
}) => {
  await page.goto("/");

  // Le titre contient un espace insécable avant « ? » → match par sous-chaîne.
  await expect(
    page.getByRole("heading", { name: /On mange quoi/ })
  ).toBeVisible();
  await expect(
    page.getByText("La question du soir a enfin sa réponse")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Générer mon planning" })
  ).toBeVisible();

  // Le lien d'accueil de la nav porte le nom de marque (et non l'emoji).
  await expect(
    page.getByRole("link", { name: "On mange quoi ? — accueil" })
  ).toBeVisible();
});
