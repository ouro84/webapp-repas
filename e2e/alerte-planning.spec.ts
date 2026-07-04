// Parcours #56 PR5 — alerte intrusive de modif planning EN TEMPS RÉEL (US-21).
//
// Deux « appareils » du même foyer : l'un (A) est « en magasin » sur la liste de
// courses ; l'autre (B) modifie le planning de la semaine à la maison. A reçoit
// alors une alerte BLOQUANTE et sa liste est re-pull (lib/sync.ts → Realtime sur
// la table planning). On vérifie aussi que la modale se ferme à l'acquittement.
//
// ⚠️ Repose sur la GÉNÉRATION (catalogue global) → fiable en CI (staging seedé),
// pas en local (.env.local = prod). Deux contextes = deux appareils.
//
// ⚠️ test.fixme (#257 PR1) : LIMITATION CONNUE ASSUMÉE. Depuis le cycle de
// courses, /courses utilise `useSyncCourses()` qui NE câble PAS le temps réel
// planning (seulement les coches) → l'alerte US-21 ne se déclenche plus « en
// magasin ». C'est documenté (CLAUDE.md, design §limitations) et RESTAURÉ en
// PR2 (#259, génération fenêtrée qui re-câble le temps réel planning côté
// cycle). Ré-activer ce test dans #259.

import { test, expect, type Browser, type Page } from "@playwright/test";
import { nettoyerEtatDistant } from "./helpers";

// Ouvre une page authentifiée dans un contexte neuf (un « appareil »).
async function ouvrirAppareil(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  return context.newPage();
}

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

test.fixme("un membre en magasin est alerté quand le planning change à la maison (US-21)", async ({
  browser,
}) => {
  // --- Appareil A : génère un planning puis part « en magasin » (courses) ---
  const a = await ouvrirAppareil(browser);
  await a.goto("/planning");
  await a.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(a.locator("main ul > li")).toHaveCount(7);
  // Attendre la persistance du planning (push terminé) avant que B le lise.
  await expect
    .poll(async () => a.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();
  await a.getByRole("link", { name: "Liste de courses →" }).click();
  await a.waitForURL("**/courses");
  await expect(a.getByRole("heading", { name: "Liste de courses" })).toBeVisible();

  // --- Appareil B : ouvre le planning du même foyer (récupère celui de A) ---
  const b = await ouvrirAppareil(browser);
  await b.goto("/planning");
  await expect(b.locator("main ul > li")).toHaveCount(7); // planning de A hydraté
  // Laisser à l'abonnement temps réel de A (côté courses) le temps de s'établir.
  await a.waitForTimeout(2500);

  // --- B regénère → le planning de la semaine change ---
  await b.getByRole("button", { name: "Régénérer" }).click();

  // --- A : alerte bloquante, puis acquittement ---
  const alerte = a.getByText(/le planning de la semaine vient d/i);
  await expect(alerte).toBeVisible({ timeout: 20_000 });
  await a.getByRole("button", { name: /OK, j.ai compris/ }).click();
  await expect(alerte).toHaveCount(0);

  await a.context().close();
  await b.context().close();
});
