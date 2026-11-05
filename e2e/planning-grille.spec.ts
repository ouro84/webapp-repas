// e2e/planning-grille.spec.ts
// Grille des jours commune aux vues Semaine et Cycle (#352) : en desktop, les
// rangées Déjeuner / Dîner s'alignent d'une colonne à l'autre (CSS subgrid), les
// actions restent libellées à 1024 px, le jour courant est marqué (jamais le
// week-end, où semaine et cycle par défaut sont la période suivante), un cycle
// de plus de 7 jours passe sur plusieurs rangées de 7, et rien ne déborde à
// 320 px.
//
// Compte partagé : planning, jour de courses et longueurs de cycle sont remis à
// l'état par défaut avant chaque test et en fin de fichier.

import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  definirJourCoursesDistant,
  definirLongueurCycleDistant,
  nettoyerEtatDistant,
  nettoyerLongueursCycleDistantes,
  reinitialiserJourCoursesDistant,
} from "./helpers";
import { semaineISO, semaineParDefaut } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await nettoyerLongueursCycleDistantes(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await nettoyerLongueursCycleDistantes(request);
  await reinitialiserJourCoursesDistant(request);
});

const PASTILLE = "Aujourd’hui";

// Cartes de repas d'une colonne (section) : le décor éventuel de la chorégraphie
// (#337, calque `aria-hidden`) est exclu, il ne prend pas de cellule.
function cartesDe(section: Locator): Locator {
  return section.locator(":scope > div:not([aria-hidden])");
}

async function genererSemaine(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(
    page.getByRole("button", { name: /^Voir la recette/ }).first()
  ).toBeVisible({ timeout: 20_000 });
  // La vue Cycle relit la base : attendre la fin du push débouncé de la semaine.
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();
}

// Contrôles d'une carte de repas qui sortent de la carte (colonne étroite) :
// renvoie les débordements, en px, par nom accessible (vide = tout tient).
async function controlesHorsCarte(carte: Locator): Promise<Record<string, number>> {
  return carte.evaluate((el) => {
    const bord = el.getBoundingClientRect();
    const hors: Record<string, number> = {};
    for (const b of Array.from(el.querySelectorAll("button"))) {
      const r = b.getBoundingClientRect();
      const exces = Math.max(bord.left - r.left, r.right - bord.right);
      if (exces > 0.5) hors[b.getAttribute("aria-label") ?? b.textContent ?? "?"] = exces;
    }
    return hors;
  });
}

async function debordementHorizontal(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test("desktop : rangées Déjeuner et Dîner alignées", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/planning");
  await genererSemaine(page);

  const rangees = page.getByTestId("rangee-jours");
  await expect(rangees).toHaveCount(1);
  const sections = rangees.first().locator("section");
  await expect(sections).toHaveCount(7);

  // toPass : l'entrée en cascade des jours (#337) translate les colonnes le
  // temps de l'animation ; on mesure une fois la grille posée.
  await expect(async () => {
    for (const rang of [0, 1]) {
      const hauteurs: number[] = [];
      for (let i = 0; i < 7; i++) {
        const boite = await cartesDe(sections.nth(i)).nth(rang).boundingBox();
        expect(boite).not.toBeNull();
        hauteurs.push(boite!.height);
      }
      for (const h of hauteurs) expect(Math.abs(h - hauteurs[0])).toBeLessThanOrEqual(1);
    }
    const changerDejeuner = page.getByRole("button", { name: /^Changer le déjeuner de / });
    await expect(changerDejeuner).toHaveCount(7);
    const ys: number[] = [];
    for (let i = 0; i < 7; i++) {
      const boite = await changerDejeuner.nth(i).boundingBox();
      expect(boite).not.toBeNull();
      ys.push(boite!.y);
    }
    for (const y of ys) expect(Math.abs(y - ys[0])).toBeLessThanOrEqual(1);
    for (const rang of [0, 1]) {
      expect(await controlesHorsCarte(cartesDe(sections.nth(0)).nth(rang))).toEqual({});
    }
  }).toPass({ timeout: 10_000 });
  expect(await debordementHorizontal(page)).toBe(0);
});

test("desktop 1024 : actions libellées comme en mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/planning");
  await genererSemaine(page);

  await expect(page.getByRole("button", { name: "Changer le dîner de lundi" })).toHaveText(
    "Changer"
  );
  await expect(
    page.getByRole("button", { name: "Sélectionner le dîner de lundi" })
  ).toHaveText("Sélectionner");
  await expect(
    page.getByRole("button", { name: "Marquer le dîner de lundi en restes" })
  ).toHaveText("Restes");
  expect(await debordementHorizontal(page)).toBe(0);
  // Colonne la plus étroite : actions et stepper tiennent dans leur carte.
  const lundi = page.getByTestId("rangee-jours").first().locator("section").first();
  await expect(async () => {
    expect(await controlesHorsCarte(cartesDe(lundi).nth(0))).toEqual({});
    expect(await controlesHorsCarte(cartesDe(lundi).nth(1))).toEqual({});
  }).toPass({ timeout: 10_000 });
});

test("aujourd'hui marqué, sauf le week-end", async ({ page }) => {
  // Viewport par défaut : 390 px (liste mobile).
  const enSemaine = semaineParDefaut() === semaineISO();
  await page.goto("/planning");
  await genererSemaine(page);

  async function verifierPastille(): Promise<void> {
    const pastille = page.getByText(PASTILLE, { exact: true });
    if (enSemaine) {
      await expect(pastille.filter({ visible: true })).toHaveCount(1);
      await expect(page.locator("main ul > li").filter({ has: pastille })).toHaveClass(
        /border-brand-600/
      );
    } else {
      // Week-end : la semaine et le cycle par défaut sont les suivants.
      await expect(pastille).toHaveCount(0);
    }
  }

  await verifierPastille();

  // Accent des cartes de repas (Q19) : en mobile, seule la carte du jour est
  // bordée (pas de cadres imbriqués) ; en desktop, les cartes de la colonne du
  // jour portent la bordure épaisse. Lu sur le style calculé, pas les classes.
  if (enSemaine) {
    const bordureHaute = (l: Locator) =>
      l.evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopWidth));
    const jourMobile = page
      .locator("main ul > li")
      .filter({ has: page.getByText(PASTILLE, { exact: true }) });
    const cartesMobile = jourMobile.locator(":scope > div.grid > div");
    await expect(cartesMobile).toHaveCount(2);
    expect(await bordureHaute(cartesMobile)).toEqual(["1px", "1px"]);

    await page.setViewportSize({ width: 1280, height: 900 });
    const colonne = page
      .getByTestId("rangee-jours")
      .locator("section")
      .filter({ has: page.getByText(PASTILLE, { exact: true }) });
    await expect(colonne).toHaveCount(1);
    await expect(cartesDe(colonne)).toHaveCount(2);
    await expect
      .poll(() => bordureHaute(cartesDe(colonne)))
      .toEqual(["2px", "2px"]);
    await page.setViewportSize({ width: 390, height: 844 });
  }

  // Vue Cycle (jour de courses lundi, 7 jours) : même fenêtre que la semaine.
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("heading", { name: "Mon planning du cycle" })).toBeVisible();
  await expect(page.locator("main ul > li")).toHaveCount(7, { timeout: 20_000 });
  await verifierPastille();
});

test("cycle de 10 jours sur deux rangées", async ({ page, request }) => {
  await definirJourCoursesDistant(request, 4);
  await definirLongueurCycleDistant(request, ancreParDefaut(new Date(), 4), 10);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();

  const rangees = page.getByTestId("rangee-jours");
  await expect(rangees).toHaveCount(2, { timeout: 20_000 });
  await expect(rangees.nth(0).locator("section")).toHaveCount(7);
  await expect(rangees.nth(1).locator("section")).toHaveCount(3);
});

test("cycle de 5 jours : une rangée, colonnes vides", async ({ page, request }) => {
  await definirLongueurCycleDistant(request, ancreParDefaut(new Date(), 1), 5);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/planning");
  await genererSemaine(page);

  const rangees = page.getByTestId("rangee-jours");
  await expect(rangees.first().locator("section")).toHaveCount(7);
  const largeurSemaine = (await rangees.first().locator("section").first().boundingBox())!
    .width;

  // Le cycle (lundi, 5 jours) tombe dans la semaine générée : déjà rempli.
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("heading", { name: "Mon planning du cycle" })).toBeVisible();
  await expect(rangees).toHaveCount(1, { timeout: 20_000 });
  await expect(rangees.first().locator("section")).toHaveCount(5);
  await expect(async () => {
    const largeurCycle = (await rangees.first().locator("section").first().boundingBox())!
      .width;
    expect(Math.abs(largeurCycle - largeurSemaine)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 10_000 });
});

test("mobile 320 : pas de débordement", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/planning");
  await genererSemaine(page);
  await expect(page.locator("main ul > li")).toHaveCount(7);
  expect(await debordementHorizontal(page)).toBe(0);

  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("heading", { name: "Mon planning du cycle" })).toBeVisible();
  await expect(page.locator("main ul > li")).toHaveCount(7, { timeout: 20_000 });
  expect(await debordementHorizontal(page)).toBe(0);
});
