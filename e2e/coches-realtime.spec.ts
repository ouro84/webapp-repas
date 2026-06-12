// Parcours #56 PR4 — coches de la liste de courses EN TEMPS RÉEL (US-20, RG-32).
//
// Deux « appareils » du même foyer (deux contextes navigateur, même session) :
// quand l'un coche/décoche un article, l'autre le voit SANS rechargement, via
// l'abonnement Supabase Realtime. Valide aussi l'anti-clobber par-article (les
// deux peuvent cocher des articles différents sans s'écraser).
//
// ⚠️ Tape une vraie instance Supabase (staging en CI) avec le Realtime activé :
// comme les autres specs, ne pas lancer en local (.env.local = prod). La
// latence du push temps réel est absorbée par des `expect.poll`/timeouts longs.

import { test, expect, type Browser, type Page } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant } from "./helpers";
import { semaineISO } from "../lib/semaines";
import type { Jour, Planning } from "../types";

// Même planning déterministe que courses.spec, semaine COURANTE pour ne pas
// déclencher la garde de semaine passée (RG-24). Les tests cochent des articles
// d'une catégorie MULTI-articles (« Produits frais ») pour ne pas déclencher le
// repli auto de section (#111), qui démonterait la case sur l'appareil acteur.
function planningDeterministe(): Planning {
  const choisies = [
    recetteFixture("omelette-aux-champignons"),
    recetteFixture("tagliatelles-au-parmesan"),
    recetteFixture("quiche-aux-lardons"),
  ];
  const jours: Jour[] = ["lundi", "mardi", "mercredi"];
  return {
    semaine: semaineISO(),
    jours: choisies.map((recette, i) => ({ jour: jours[i]!, diner: recette })),
  };
}

// Ouvre /courses dans un contexte neuf (même session authentifiée) avec le
// planning injecté et les drapeaux de sync purgés — comme le beforeEach de
// courses.spec, mais au niveau contexte (un par « appareil »).
async function ouvrirCourses(browser: Browser, planning: Planning): Promise<Page> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  await context.addInitScript((contenu) => {
    for (const c of [
      "planning_courant_maj",
      "planning_dirty",
      "courses_cochees",
      "courses_cochees_maj",
      "courses_dirty",
    ]) {
      localStorage.removeItem(c);
    }
    localStorage.setItem("planning_courant", contenu as string);
  }, JSON.stringify(planning));
  const page = await context.newPage();
  await page.goto("/courses");
  // Attendre que la liste soit rendue (page hydratée → abonnement Realtime posé).
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeVisible();
  return page;
}

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

test("une coche posée sur un appareil apparaît en temps réel sur l'autre (US-20, RG-32)", async ({
  browser,
}) => {
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);

  // Laisser à l'abonnement Realtime de B le temps de s'établir avant d'émettre.
  await deviceB.waitForTimeout(2000);

  // A coche « parmesan » (catégorie « Produits frais », 4 articles : cocher 1
  // seul ne replie pas la section côté A — cf. #111 — la case reste montée).
  await deviceA.getByRole("checkbox", { name: /parmesan/ }).click();
  await expect(deviceA.getByRole("checkbox", { name: /parmesan/ })).toBeChecked();

  // B la voit cochée SANS rechargement (temps réel).
  await expect(deviceB.getByRole("checkbox", { name: /parmesan/ })).toBeChecked({
    timeout: 15_000,
  });

  // A décoche → B la voit décochée, toujours en temps réel.
  await deviceA.getByRole("checkbox", { name: /parmesan/ }).click();
  await expect(deviceB.getByRole("checkbox", { name: /parmesan/ })).not.toBeChecked({
    timeout: 15_000,
  });

  await deviceA.context().close();
  await deviceB.context().close();
});

test("deux appareils cochent des articles différents sans s'écraser (anti-clobber, RG-32)", async ({
  browser,
}) => {
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);
  await deviceB.waitForTimeout(2000);

  // A coche parmesan, B coche crème fraîche — en parallèle. Deux articles
  // DIFFÉRENTS d'une même catégorie multi-articles (« Produits frais ») : ni A
  // ni B ne complète la catégorie → aucune section ne se replie (#111), les
  // cases restent montées pour les assertions croisées.
  await deviceA.getByRole("checkbox", { name: /parmesan/ }).click();
  await deviceB.getByRole("checkbox", { name: /crème fraîche/ }).click();

  // Chacun finit par voir LES DEUX coches : aucune n'a écrasé l'autre.
  for (const page of [deviceA, deviceB]) {
    await expect(page.getByRole("checkbox", { name: /parmesan/ })).toBeChecked({
      timeout: 15_000,
    });
    await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).toBeChecked({
      timeout: 15_000,
    });
  }

  await deviceA.context().close();
  await deviceB.context().close();
});
