// Parcours — onboarding du Foyer (#56 PR3, US-19). Le panneau « Mon foyer » vit
// sur /profil depuis #22 PR1 (déplacé depuis /reglages).
// Session authentifiée via le projet "setup" (storageState).
//
// ⚠️ Écrit en base sur le compte de test (génère un code d'invitation sur son
// foyer, RLS) : NE PAS lancer en local (.env.local pointe la prod). Validation
// en CI (staging seedé).
//
// ⚠️ On NE teste PAS ici de jonction/sortie RÉELLE : changer le foyer_id du
// compte de test (partagé) le ferait diverger et casserait toutes les autres
// specs (catalogue vide). On couvre ici : affichage du panneau (solo),
// génération du code, et l'erreur de jonction sur code invalide (sans effet de
// bord). Le code généré sur le foyer de test est sans danger (personne ne le
// rejoint) → pas de teardown. La jonction + sortie + clonage RÉELS (RG-33/RG-34)
// sont couverts par `foyer-clonage.spec.ts`, qui crée des comptes JETABLES
// dédiés (disjoints du compte partagé).

import { test, expect } from "./fixtures";

// 8 caractères de l'alphabet de generer_code_invitation (sans I/O/0/1).
const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;

test("le panneau « Mon foyer » s'affiche (compte solo)", async ({ page }) => {
  await page.goto("/profil");

  await expect(
    page.getByRole("heading", { name: "Mon foyer", level: 2 })
  ).toBeVisible();
  // Compte de test solo : champ pour rejoindre un foyer présent, pas de bouton
  // « Quitter » (réservé aux foyers partagés).
  await expect(page.getByLabel("Rejoindre un foyer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Quitter le foyer" })
  ).toHaveCount(0);
});

test("générer un code d'invitation l'affiche avec son expiration", async ({
  page,
}) => {
  await page.goto("/profil");

  // Idempotent entre runs : si un code valide existe déjà (« Régénérer »), on le
  // régénère ; sinon on clique « Inviter quelqu'un ». On ATTEND d'abord que le
  // panneau soit chargé (un des deux boutons présent) — sinon un isVisible()
  // instantané lit l'état « Chargement… » et branche à tort.
  const inviter = page.getByRole("button", { name: "Inviter quelqu’un" });
  const regenerer = page.getByRole("button", { name: "Régénérer" });
  await expect(inviter.or(regenerer)).toBeVisible();
  if (await inviter.isVisible()) {
    await inviter.click();
  } else {
    await regenerer.click();
  }

  // Toast de confirmation, code au bon format, expiration et actions de partage.
  await expect(page.getByText("Code d’invitation prêt")).toBeVisible();
  await expect(page.getByText(CODE_RX)).toBeVisible();
  await expect(page.getByText(/Valable jusqu’au/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copier" })).toBeVisible();

  // Le QR code se révèle au clic et s'escamote.
  await page.getByRole("button", { name: "QR code" }).click();
  await expect(page.getByRole("button", { name: "Masquer le QR" })).toBeVisible();
});

test("rejoindre avec un code invalide affiche une erreur (RG-29)", async ({
  page,
}) => {
  await page.goto("/profil");

  // Code au bon format mais inexistant → la RPC rejoindre_foyer rejette.
  await page.getByLabel("Rejoindre un foyer").fill("ZZZZZZZZ");
  await page.getByRole("button", { name: "Rejoindre" }).click();

  await expect(page.getByText("Code invalide ou expiré")).toBeVisible();
});
