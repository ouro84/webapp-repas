// e2e/prochain-repas.spec.ts
// Page « Ce soir » (#280, refonte #336) — tape la vraie base (catalogue global
// seedé sur staging, cf. contrainte projet).
//
// Le repas visé dépend de l'heure (seuil 15 h) : les tests déterministes
// calculent le créneau avec la même fonction pure que la page
// (`prochainRepasActif`, réglages par défaut remis en beforeEach) et y écrivent
// une recette du catalogue via `planifierRepasDistant`.

import { test, expect } from "./fixtures";
import type { APIRequestContext } from "@playwright/test";
import {
  nettoyerEtatDistant,
  nettoyerReglagesDistants,
  planifierRepasDistant,
} from "./helpers";
import { prochainRepasActif, repasActifSuivant, semaineDuRepas } from "../lib/prochain-repas";
import { REGLAGES_DEFAUT } from "../lib/reglages";

const RECETTE_CIBLE = "Poulet rôti, pommes de terre";
const RECETTE_SUIVANTE = "Pâtes à la carbonara";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await nettoyerReglagesDistants(request);
});

test.afterAll(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

// Planifie le repas que /ce-soir affichera maintenant, et le suivant.
async function planifierCibleEtSuivant(request: APIRequestContext): Promise<void> {
  const cible = prochainRepasActif(new Date(), new Map(), REGLAGES_DEFAUT)!;
  const suivant = repasActifSuivant(cible, new Map(), REGLAGES_DEFAUT)!;
  const parSemaine = new Map<string, Parameters<typeof planifierRepasDistant>[2]>();
  for (const [repas, nomRecette] of [
    [cible, RECETTE_CIBLE],
    [suivant, RECETTE_SUIVANTE],
  ] as const) {
    const semaine = semaineDuRepas(repas);
    const liste = parSemaine.get(semaine) ?? [];
    liste.push({ jour: repas.jour, typeRepas: repas.typeRepas, nomRecette });
    parSemaine.set(semaine, liste);
  }
  for (const [semaine, repas] of parSemaine) {
    await planifierRepasDistant(request, semaine, repas);
  }
}

test("affiche la recette dans la page, sans fenêtre modale, avec l'aperçu « Ensuite »", async ({
  page,
  request,
}) => {
  await planifierCibleEtSuivant(request);
  await page.goto("/ce-soir");

  await expect(page.getByRole("heading", { level: 1, name: RECETTE_CIBLE, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "À acheter" })).toBeVisible();
  await expect(page.getByText("Ensuite :")).toBeVisible();
  await expect(page.locator("main footer")).toContainText(RECETTE_SUIVANTE);

  // Le lien vise la semaine du repas (le week-end, /planning ouvrirait sinon la
  // suivante) puis retire son paramètre de l'URL.
  await page.getByRole("link", { name: "Voir dans le planning" }).click();
  await expect(page).toHaveURL(/\/planning$/);
  await expect(page.locator("main").getByText(RECETTE_CIBLE, { exact: true }).first()).toBeVisible();
});

test("une coche d'ingrédient survit au rechargement", async ({ page, request }) => {
  await planifierCibleEtSuivant(request);
  await page.goto("/ce-soir");

  const premiere = page.getByRole("checkbox").first();
  await expect(premiere).toBeVisible({ timeout: 15_000 });
  await expect(premiere).not.toBeChecked();
  await premiere.check();
  await expect(premiere).toBeChecked();

  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked({ timeout: 15_000 });
});

test("sans planning : état vide avec une issue vers la génération", async ({ page }) => {
  await page.goto("/ce-soir");
  await expect(page.getByText("Rien de prévu pour ce repas.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Générer mon planning" }).click();
  await expect(page).toHaveURL(/\/planning$/);
});

test.describe("déconnecté", () => {
  // Neutralise le storageState hérité du projet (connecté) — sinon le proxy
  // redirige un utilisateur déjà authentifié hors de /login (vers /planning),
  // où le lien « Ce soir » est légitimement présent (cf. e2e/auth.spec.ts).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("le lien « Ce soir » n'apparaît pas dans la nav déconnectée", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /Ce midi|Ce soir/ })).toHaveCount(0);
  });
});
