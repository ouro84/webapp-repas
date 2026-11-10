// e2e/coherence-semaine-cycle.spec.ts
// Couverture des retours utilisateurs #279 : génération depuis la vue Cycle,
// cohérence de fenêtre entre /planning (vue Cycle) et /courses, persistance
// du choix de vue.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  attendreChargementTermine,
  nettoyerEtatDistant,
  planifierRepasDistant,
  reinitialiserJourCoursesDistant,
} from "./helpers";
import { ancreParDefaut, dateVersSemaineJour } from "../lib/cycles";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

// #357 : la génération réelle (route + RPC + relecture) peut attendre un gel de
// staging de plus de 30 s. On attend donc le TOAST de résultat (succès ou échec)
// avec un délai large, puis on exige le succès : un échec ressort avec son
// message au lieu d'un « main li » introuvable après 20 s. Le refus pour envois
// en attente (« Des modifications ne sont pas… », #355) compte aussi comme un
// résultat : échec franc et rapide plutôt que 45 s d'attente.
async function attendreCycleGenere(page: Page): Promise<void> {
  await expect(
    page.getByText(/Cycle généré|Impossible de générer|Des modifications ne sont pas/).last()
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Cycle généré").last()).toBeVisible();
}

test("« Générer mon cycle » est accessible et fonctionne depuis la vue Cycle de /planning", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  // #352 : l'état vide du cycle a le même gabarit que celui de la semaine (titre,
  // navigateur, bouton principal), sous le titre « Mon planning du cycle ».
  await expect(page.getByRole("heading", { name: "Mon planning du cycle" })).toBeVisible();
  await expect(page.getByText("Aucun repas planifié sur ce cycle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Générer mon cycle" })).toBeVisible();
  // Comme en semaine, l'état vide n'a pas de lien « Liste de courses → ».
  await expect(page.getByRole("link", { name: "Liste de courses →" })).toHaveCount(0);

  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  // Une recette apparaît dans la projection (génération réelle, catalogue seedé CI-only).
  await attendreCycleGenere(page);
  // Un repas réel (#400 : `main li` matcherait aussi le squelette).
  await expect(page.locator("main button[aria-label^='Voir la recette']").first()).toBeVisible();
});

// #334 : régénérer un cycle déjà rempli écrase les repas et purge les coches du
// foyer, sans undo → confirmation (miroir de RG-74 côté MCP). Cycle vide :
// génération directe (test précédent, aucune modale).
test("régénérer un cycle déjà rempli depuis la vue Cycle demande confirmation (#334)", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await attendreCycleGenere(page);
  // Un repas réel (#400 : `main li` matcherait aussi le squelette).
  await expect(page.locator("main button[aria-label^='Voir la recette']").first()).toBeVisible();
  const recettesAvant = await page
    .locator("main button[aria-label^='Voir la recette']")
    .allTextContents();

  // #352 : cycle rempli → l'en-tête porte « Régénérer » (comme la semaine) et
  // l'accès aux réglages de génération.
  await expect(page.getByRole("link", { name: "Réglages de génération" })).toBeVisible();

  // Annuler : rien ne change.
  await page.getByRole("button", { name: "Régénérer" }).click();
  const modale = page.getByRole("dialog", { name: "Régénérer ce cycle ?" });
  await expect(modale).toBeVisible();
  await modale.getByRole("button", { name: "Annuler" }).click();
  await expect(modale).not.toBeVisible();
  expect(
    await page.locator("main button[aria-label^='Voir la recette']").allTextContents()
  ).toEqual(recettesAvant);

  // Confirmer : le cycle est régénéré. Le toast de la 1re génération doit être
  // parti, sinon il passerait pour le résultat de la régénération (#357).
  await expect(page.getByText("Cycle généré")).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "Régénérer" }).click();
  await modale.getByRole("button", { name: "Régénérer" }).click();
  await attendreCycleGenere(page);
  // Le toast précède la relecture du cycle (`chargerCycle`) : attendre la FIN de la
  // régénération par un signal indépendant du contenu (#357). Le bouton
  // « Régénérer » de l'en-tête porte `aria-busy` de son clic jusqu'au `finally` de
  // la génération, donc après la relecture ; le corps du cycle le porte pendant la
  // relecture. Plus aucun `aria-busy` dans `main` = régénération et relecture
  // terminées. Comparer au contenu d'avant échouerait si la régénération
  // redonnait la même liste.
  await expect(page.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 20_000 });
  const recettesCycle = await page
    .locator("main button[aria-label^='Voir la recette']")
    .allTextContents();

  // #352 : le cycle (lundi → dimanche, jour de courses par défaut) est la semaine
  // affichée en vue Semaine, abonnée au temps réel. Sa régénération n'ouvre pas
  // l'alerte US-21 sur sa propre écriture, et la vue Semaine montre le cycle
  // régénéré sans relecture.
  await page.getByRole("button", { name: "Semaine", exact: true }).click();
  await expect
    .poll(async () =>
      (await page.locator("main button[aria-label^='Voir la recette']").allTextContents()).sort()
    )
    .toEqual([...recettesCycle].sort());
  await expect(page.getByRole("dialog", { name: "Planning mis à jour" })).toHaveCount(0);
});

test("le lien « Liste de courses → » depuis la vue Cycle conserve la même fenêtre", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  // #352 : le lien « Liste de courses → » n'existe que dans l'en-tête du cycle
  // rempli (pas dans l'état vide, comme en semaine) : on génère d'abord.
  await page.getByRole("button", { name: "Générer mon cycle" }).click();
  await attendreCycleGenere(page);
  // Un repas réel (#400 : `main li` matcherait aussi le squelette).
  await expect(page.locator("main button[aria-label^='Voir la recette']").first()).toBeVisible();
  // #352 : le navigateur de période (libellé relatif + dates) remplace « Courses du… ».
  const navigateurCycle = page.getByRole("group", { name: "Naviguer entre les cycles" });
  const libelleCycle = (await navigateurCycle.innerText()).trim();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL(/\/courses/);
  // Même fenêtre affichée des deux côtés (pas de saut vers le défaut du jour) —
  // preuve que l'ancre a été appliquée. On ne teste PAS la présence de `?ancre=`
  // dans l'URL : l'app le nettoie quasi immédiatement après application (relais
  // one-shot, cf. app/courses/page.tsx), une assertion dessus serait racy par
  // construction (déjà vécu : le paramètre disparaît souvent avant que
  // `toHaveURL` n'ait eu la moindre chance de l'observer).
  await expect(navigateurCycle).toHaveText(libelleCycle);
  // Le paramètre est bien nettoyé une fois appliqué (comportement one-shot).
  await expect(page).toHaveURL(/\/courses$/);
});

test("le choix de vue Cycle survit au reload", async ({ page }) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible();
});

// #352 : comme la semaine, la vue Cycle garde son en-tête, sa bascule et son
// navigateur montés pendant qu'elle charge un autre cycle (« Chargement… » seul
// au tout premier chargement) : pas de saut de mise en page, bascule disponible,
// focus clavier conservé sur la flèche cliquée.
test("naviguer entre les cycles garde l'en-tête et le focus sur la flèche pendant le chargement (#352)", async ({
  page,
  request,
}) => {
  // #357 : cycle courant amorcé en base (un repas du catalogue au 1er jour du
  // cycle par défaut) au lieu d'une génération réelle, qu'un gel de staging
  // faisait dépasser le délai.
  const { semaine, jour } = dateVersSemaineJour(ancreParDefaut(new Date(), 1));
  await planifierRepasDistant(request, semaine, [
    { jour, typeRepas: "diner", nomRecette: "Poulet rôti, pommes de terre" },
  ]);
  await page.goto("/planning");
  await page.getByRole("button", { name: "Cycle" }).click();
  // #400 : le premier chargement du cycle rend un squelette (7 `main li`) ; la
  // bascule « Cycle » pressée n'existe que dans la vue chargée.
  await expect(page.getByRole("button", { name: "Cycle", pressed: true })).toBeVisible({
    timeout: 20_000,
  });
  await attendreChargementTermine(page);
  await expect(page.locator("main button[aria-label^='Voir la recette']").first()).toBeVisible();

  // Première lecture de chaque chargement de cycle : retardée pour rendre la
  // fenêtre de chargement observable.
  await page.route("**/rest/v1/cycle_courses*", async (route) => {
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });

  const navigateur = page.getByRole("group", { name: "Naviguer entre les cycles" });
  const suivant = page.getByRole("button", { name: "Cycle suivant" });
  const libelleAvant = (await navigateur.innerText()).trim();
  await suivant.click();

  // Pendant le chargement (< 1,5 s) : tout reste monté, le focus n'a pas bougé.
  // Lectures instantanées (pas d'assertion qui réessaie : elle attendrait la fin
  // du chargement et masquerait un démontage transitoire).
  await page.waitForTimeout(800);
  expect(await page.getByRole("heading", { name: "Mon planning du cycle" }).isVisible()).toBe(true);
  expect(await page.getByRole("group", { name: "Vue du planning" }).isVisible()).toBe(true);
  expect(await navigateur.isVisible()).toBe(true);
  expect(await page.getByText("Chargement…").count()).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
    "Cycle suivant"
  );

  // Le chargement aboutit : le navigateur annonce un autre cycle.
  await expect(navigateur).not.toHaveText(libelleAvant, { timeout: 10_000 });
  await expect(page.getByRole("group", { name: "Vue du planning" })).toBeVisible();

  // Le cycle suivant est vide : l'en-tête est remplacé par l'état vide et le
  // navigateur remonté ailleurs ; le focus revient sur la flèche cliquée.
  await expect(page.getByText("Aucun repas planifié sur ce cycle.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe("Cycle suivant");
});

// Jumeau semaine (#352) : semaine remplie → semaine vide, même remontage du
// navigateur (en-tête → état vide), même reprise du focus.
test("semaine remplie → semaine vide : le focus reste sur « Semaine suivante » (#352)", async ({
  page,
}) => {
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  // #357 : même modèle que la génération de cycle : attendre le résultat (toast de
  // succès ou message d'échec) avec un délai large, puis exiger le succès.
  await expect(page.getByText(/Planning généré|Impossible de générer le planning/).last()).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText(/Planning généré/).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Voir la recette/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect(page.getByText("Aucun planning pour cette semaine.")).toBeVisible({
    timeout: 10_000,
  });
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe("Semaine suivante");
});
