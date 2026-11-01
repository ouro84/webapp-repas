// e2e/lien-cycle.spec.ts
// Lien profond `/planning?cycle=AAAA-MM-JJ` (#320, RG-87) : ouvre la vue Cycle
// sur le cycle qui contient la date, une seule fois, sans écrire la vue
// préférée (`vue_planning`). Compte partagé, lecture seule : aucune écriture
// en base, seul le jour de courses (lundi) est fixé pour calculer les libellés.

import type { Page } from "@playwright/test";
import { test, expect, attacherGardeCrash } from "./fixtures";
import { E2E_EMAIL, reinitialiserJourCoursesDistant } from "./helpers";
import { remplirLogin } from "./oauth";
import { ancreParDefaut, cycleDecale, joursDuCycle, libelleCycle } from "../lib/cycles";

const JOUR_COURSES = 1; // lundi, cf. reinitialiserJourCoursesDistant
const LONGUEUR = 7;

// Cycle suivant le cycle affiché par défaut, et une date INTÉRIEURE à ce cycle
// (ancre + 2 jours) : prouve que le lien résout la date, pas seulement l'ancre.
// Calculés à l'appel (et non à l'import) : la date du jour décide du week-end.
function cibleLien() {
  const suivant = cycleDecale(ancreParDefaut(new Date(), JOUR_COURSES), 1);
  const date = joursDuCycle(suivant, LONGUEUR)[2];
  return { suivant, date, libelle: libelleCycle(suivant, LONGUEUR) };
}

// Pose `vue_planning = "semaine"` UNE fois par onglet : `addInitScript` rejoue à
// chaque chargement complet, ce qui écraserait la valeur lue après un reload.
async function poserVueSemaine(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e_vue_posee")) return;
    sessionStorage.setItem("e2e_vue_posee", "1");
    localStorage.setItem("vue_planning", "semaine");
  });
}

const vuePlanning = (page: Page) =>
  page.evaluate(() => localStorage.getItem("vue_planning"));

const bascule = (page: Page, nom: "Semaine" | "Cycle") =>
  page.getByRole("group", { name: "Vue du planning" }).getByRole("button", { name: nom });

test.beforeAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test("lien vers le cycle suivant : vue Cycle sur ce cycle, URL nettoyée, vue préférée intacte, rechargement → vue préférée", async ({
  page,
}) => {
  const { date, libelle } = cibleLien();
  await poserVueSemaine(page);

  await page.goto(`/planning?cycle=${date}`);
  await expect(page).toHaveURL(/\/planning$/);
  await expect(page.getByText(libelle, { exact: true })).toBeVisible();
  await expect(bascule(page, "Cycle")).toHaveAttribute("aria-pressed", "true");
  // Le lien n'écrit jamais la préférence (RG-87).
  expect(await vuePlanning(page)).toBe("semaine");

  // Le paramètre est retiré : un rechargement revient à la vue préférée.
  await page.reload();
  await expect(bascule(page, "Semaine")).toHaveAttribute("aria-pressed", "true");
  await expect(bascule(page, "Cycle")).toHaveAttribute("aria-pressed", "false");
  expect(await vuePlanning(page)).toBe("semaine");
});

test("date invalide : ignorée sans message, vue préférée conservée", async ({ page }) => {
  await poserVueSemaine(page);

  await page.goto("/planning?cycle=2026-13-45");
  await expect(page).toHaveURL(/\/planning$/);
  await expect(bascule(page, "Semaine")).toHaveAttribute("aria-pressed", "true");
  await expect(bascule(page, "Cycle")).toHaveAttribute("aria-pressed", "false");
  // Page hydratée et semaine connue AVANT les assertions de comptage zéro, qui
  // passeraient sinon dès le premier essai (le titre est déjà rendu par l'état
  // vide). La navigation entre semaines n'apparaît qu'une fois la page prête.
  // Une date invalide ne déclenche aucun appel asynchrone (seulement
  // `history.replaceState`) : pas de toast tardif possible côté lien.
  await expect(page.getByRole("button", { name: "Semaine suivante" })).toBeVisible();
  // Ni alerte ni toast d'erreur. `alert` scopé à `main` : le route-announcer de
  // Next (toujours monté, shadow DOM) porte lui aussi `role="alert"`. Les toasts
  // sonner sont des `li[data-sonner-toast]`.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  expect(await vuePlanning(page)).toBe("semaine");
});

test("clic sur Semaine puis Cycle après le lien : cycle par défaut, préférence écrite", async ({
  page,
}) => {
  const { date, libelle } = cibleLien();
  const libelleDefaut = libelleCycle(ancreParDefaut(new Date(), JOUR_COURSES), LONGUEUR);
  await poserVueSemaine(page);

  await page.goto(`/planning?cycle=${date}`);
  await expect(page.getByText(libelle, { exact: true })).toBeVisible();

  // Un clic sur la bascule est un choix explicite : il coupe le lien pour la visite.
  await bascule(page, "Semaine").click();
  await expect(bascule(page, "Semaine")).toHaveAttribute("aria-pressed", "true");
  await bascule(page, "Cycle").click();
  await expect(bascule(page, "Cycle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(libelleDefaut, { exact: true })).toBeVisible();
  expect(await vuePlanning(page)).toBe("cycle");
});

test("sans session : connexion puis retour sur le lien (cycle suivant)", async ({ browser }) => {
  const { date, libelle } = cibleLien();
  // storageState VIDE explicite : `browser.newContext()` hérite sinon de la session
  // du compte partagé. On s'y connecte par mot de passe, SANS se déconnecter (le
  // `signOut` révoquerait le refresh token commun, cf. e2e.md).
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const garde = attacherGardeCrash(page);
  try {
    await page.goto(`/planning?cycle=${date}`);
    await page.waitForURL(/\/login\?.*suivant=/);

    await remplirLogin(page, E2E_EMAIL);
    // `/planning?cycle=…` est lu puis retiré : l'URL finale n'a plus de paramètre.
    await page.waitForURL(/\/planning$/);
    await expect(page.getByText(libelle, { exact: true })).toBeVisible();
    await expect(bascule(page, "Cycle")).toHaveAttribute("aria-pressed", "true");
    expect(garde.erreurs).toEqual([]);
  } finally {
    await ctx.close();
  }
});
