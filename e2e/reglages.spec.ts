// Parcours — réglages de génération (#45, P09, US-15).
// Session authentifiée via le projet "setup" (storageState).
//
// ⚠️ Écrit en base (table reglages, RLS) sur le compte de test : NE PAS lancer
// en local (.env.local pointe la prod). Validation en CI (staging seedé).
//
// Isolation : le compte est partagé. On nettoie les réglages avant chaque test
// (repart des défauts) ET après tous (laisse les défauts aux autres specs, qui
// supposent « génération = 2 personnes »). On nettoie aussi l'état distant +
// le cache local pour que /planning parte d'un état vide.

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, nettoyerReglagesDistants } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await nettoyerReglagesDistants(request);
  await nettoyerEtatDistant(request);
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
});

test.afterAll(async ({ request }) => {
  await nettoyerReglagesDistants(request);
});

test("modifier et enregistrer les réglages les persiste (US-15)", async ({
  page,
}) => {
  await page.goto("/reglages");

  const enregistrer = page.getByRole("button", { name: "Enregistrer" });
  // Pas de changement → bouton désactivé (RG-25, enregistrement explicite).
  await expect(enregistrer).toBeDisabled();

  // Plafonner le dîner de semaine à « Long » (défaut : Rapide).
  const dinerSemaine = page.getByRole("radiogroup", { name: "Dîner en semaine" });
  await dinerSemaine.getByRole("radio", { name: "Long" }).click();
  await expect(dinerSemaine.getByRole("radio", { name: "Long" })).toBeChecked();

  // Passer le nombre de personnes par défaut à 4.
  await expect(page.getByText("2 pers.")).toBeVisible();
  await page.getByRole("button", { name: "Plus de personnes" }).click();
  await page.getByRole("button", { name: "Plus de personnes" }).click();
  await expect(page.getByText("4 pers.")).toBeVisible();

  // Enregistrer (devenu actif), confirmation.
  await expect(enregistrer).toBeEnabled();
  await enregistrer.click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();

  // Persistance : un rechargement complet relit la base.
  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Dîner en semaine" }).getByRole("radio", { name: "Long" })
  ).toBeChecked();
  await expect(page.getByText("4 pers.")).toBeVisible();
});

test("sans Enregistrer, un changement n'est pas persisté (RG-25)", async ({
  page,
}) => {
  await page.goto("/reglages");

  await page.getByRole("button", { name: "Plus de personnes" }).click();
  await expect(page.getByText("3 pers.")).toBeVisible();

  // Rechargement SANS enregistrer → retour aux valeurs par défaut.
  await page.reload();
  await expect(page.getByText("2 pers.")).toBeVisible();
  await expect(page.getByText("3 pers.")).toHaveCount(0);
});

test("activer et enregistrer une préférence végé la persiste (#86 PR2)", async ({
  page,
}) => {
  await page.goto("/reglages");

  // L'interrupteur « Dîner en semaine » de la section végé (switch accessible).
  const toggle = page.getByRole("switch", { name: "Dîner en semaine" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();

  // Persistance : un rechargement complet relit la base.
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Dîner en semaine" })
  ).toHaveAttribute("aria-checked", "true");
});

test("activer et enregistrer « ≥1 légume/jour » le persiste (#49 PR2)", async ({
  page,
}) => {
  await page.goto("/reglages");

  // Switch unique de la section mix accompagnement.
  const toggle = page.getByRole("switch", {
    name: "Au moins un repas légumes par jour",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();

  // Persistance : un rechargement complet relit la base.
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Au moins un repas légumes par jour" })
  ).toHaveAttribute("aria-checked", "true");
});

test("désactiver et enregistrer la saisonnalité la persiste (#23 PR2)", async ({
  page,
}) => {
  await page.goto("/reglages");

  // Switch « recettes de saison » : ON par défaut (≠ végé/mix).
  const toggle = page.getByRole("switch", {
    name: "Ne proposer que des recettes de saison",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();

  // Persistance : un rechargement complet relit la base.
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Ne proposer que des recettes de saison" })
  ).toHaveAttribute("aria-checked", "false");
});

test("la génération applique le nombre de personnes par défaut (US-15)", async ({
  page,
}) => {
  // Régler le défaut à 4 et enregistrer.
  await page.goto("/reglages");
  await page.getByRole("button", { name: "Plus de personnes" }).click();
  await page.getByRole("button", { name: "Plus de personnes" }).click();
  await expect(page.getByText("4 pers.")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();

  // Générer un planning : le serveur lit les réglages → slots à 4 personnes.
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  await expect(page.locator("main ul > li").first()).toContainText("4 pers.");
});
