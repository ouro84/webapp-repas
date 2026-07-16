// e2e/prochain-repas.spec.ts
// Vue « Prochain repas » (#280) — génération réelle, CI-only (catalogue
// global seedé sur staging, cf. contrainte projet).

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

test("affiche le prochain repas après génération, ou l'état vide sinon", async ({ page }) => {
  // Génère un planning réel pour la semaine courante (fenêtre couverte par
  // /ce-soir : semaine courante + suivante).
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main li").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Ce soir" }).click();
  // Selon l'heure réelle d'exécution CI, le créneau visé peut avoir une
  // recette (fiche montée, <dialog> visible) ou non (état vide) — les deux
  // sont des succès légitimes, on n'en impose pas un des deux exclusivement.
  const ficheOuverte = page.getByRole("dialog");
  const etatVide = page.getByText("Rien de prévu pour ce repas.");
  await expect(ficheOuverte.or(etatVide)).toBeVisible({ timeout: 10_000 });
});

test.describe("déconnecté", () => {
  // Neutralise le storageState hérité du projet (connecté) — sinon le proxy
  // redirige un utilisateur déjà authentifié hors de /login (vers /planning),
  // où le lien « Ce soir » est légitimement présent (cf. e2e/auth.spec.ts).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("le lien « Ce soir » n'apparaît pas dans la nav déconnectée", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Ce soir" })).toHaveCount(0);
  });
});
