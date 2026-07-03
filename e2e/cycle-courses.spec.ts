// Parcours e2e — cycle de courses non calendaire (#257).
//
// Le « jour de courses » du foyer (réglage de /profil, section « Mon foyer »)
// ancre la fenêtre de 7 jours affichée par /courses (lib/cycles.ts —
// ancreCourante), en lieu et place de la semaine ISO fixe. Deux parcours :
//  1. Le DÉFAUT (lundi) ne régresse pas : sans planning généré, l'état vide
//     de /courses s'affiche normalement (aucun crash).
//  2. Changer le jour vers jeudi ré-ancre la liste : une fois un planning réel
//     généré, le libellé « Courses du … » apparaît, et la navigation
//     ‹ Cycle suivant › fonctionne (avec ou sans contenu sur le cycle visé).
//
// CI-only (génération réelle, cf. piège CLAUDE.md « les e2e de génération ne
// valident qu'en CI »). Foyer PARTAGÉ (compte de test) : le jour de courses
// est remis à lundi en beforeEach ET afterAll pour ne pas faire diverger
// l'ancre vue par les autres specs (courses.spec, coches-realtime.spec…).

import { test, expect } from "@playwright/test";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  await reinitialiserJourCoursesDistant(request);
});

test("le jour de courses réancre la liste (aucune régression en défaut lundi)", async ({
  page,
}) => {
  // Défaut lundi (remis par reinitialiserJourCoursesDistant) : sans planning
  // généré, /courses se comporte comme avant #257 — état vide, pas de crash.
  await page.goto("/courses");
  await expect(
    page.getByRole("heading", { name: "Liste de courses" })
  ).toBeVisible();
});

test("changer le jour de courses puis naviguer les cycles", async ({ page }) => {
  await page.goto("/profil");
  const radioJeudi = page.getByRole("radio", { name: "jeudi" });
  await radioJeudi.click();
  // Confirme l'écriture avant de continuer (definirJourCoursesFoyer + rafraîchir
  // sont asynchrones) — sinon la navigation suivante pourrait lire un jour de
  // courses pas encore à jour côté base.
  await expect(radioJeudi).toHaveAttribute("aria-checked", "true");

  // Génère un planning réel sur la semaine courante : le cycle jeudi couvre
  // forcément AUJOURD'HUI (ancreCourante recule au plus de 6 jours), donc au
  // moins un jour de la semaine courante générée ci-dessous tombe dans la
  // fenêtre du cycle affiché par /courses.
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page.goto("/courses");
  await expect(page.getByText(/Courses du/)).toBeVisible();

  // Navigation cycle (‹ Cycle précédent / Cycle suivant ›) : ne doit jamais
  // planter, que le cycle suivant ait ou non du contenu — le planning généré
  // ci-dessus ne couvre qu'une semaine, le cycle suivant peut donc retomber en
  // état vide (« Liste de courses » sans repas planifié), ce qui est correct.
  await page.getByRole("button", { name: "Cycle suivant" }).click();
  await expect(page.getByRole("heading").first()).toBeVisible();
});
