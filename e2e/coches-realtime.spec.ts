// Parcours #56 PR4 — coches de la liste de courses EN TEMPS RÉEL (US-20, RG-32).
//
// Deux « appareils » du même foyer (deux contextes navigateur, même session) :
// quand l'un coche/décoche un article, l'autre le voit SANS rechargement, via
// l'abonnement Supabase Realtime. Valide aussi l'anti-clobber par-article (les
// deux peuvent cocher des articles différents sans s'écraser).
//
// Depuis #257, les coches sont clées par ANCRE de cycle (pas par semaine) et
// /courses lit son planning projeté depuis `cycle_planning` (pas
// `planning_courant`, cf. lib/sync.ts) : les deux appareils injectent donc le
// même planning dans `cycle_planning` avec `semaine` posé à la MÊME ancre (jour
// de courses foyer = lundi par défaut, remis par `reinitialiserJourCoursesDistant`),
// pour partager le même canal temps réel `coches:<foyer>:<ancre>`.
//
// ⚠️ Tape une vraie instance Supabase (staging en CI) avec le Realtime activé :
// comme les autres specs, ne pas lancer en local (.env.local = prod). La
// latence du push temps réel est absorbée par des `expect.poll`/timeouts longs.

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { Browser, Page } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";
import { semaineISO } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";
import type { Jour, Planning } from "../types";

// Ancre du cycle avec le jour de courses par défaut (lundi, ISO 1) — celle que
// `hydraterCycle()` calculera au montage tant que le foyer de test reste sur
// son réglage par défaut (remis par reinitialiserJourCoursesDistant ci-dessous).
// `ancreParDefaut` (pas `ancreCourante`) pour inclure le décalage WEEK-END
// appliqué par hydraterCycle (#257) : l'injection doit matcher l'ancre calculée.
const ANCRE_LUNDI = ancreParDefaut(new Date(), 1);

// Même planning déterministe que courses.spec (lardons + tagliatelles + …).
// Le `semaine` d'origine n'est pas significatif : ouvrirCourses le remplace
// par l'ANCRE du cycle visé avant injection dans `cycle_planning`.
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
// planning injecté dans le cache du CYCLE affiché (#257 : `cycle_planning` +
// `cycle_affiche`, pas `planning_courant`) et les drapeaux de sync purgés —
// comme le beforeEach de courses.spec, mais au niveau contexte (un par
// « appareil »). Le garde-fou « local fait foi si le backend est vide pour
// cette ancre » (lib/sync.ts) préserve l'injection tant que `semaine` du
// planning injecté vaut bien l'ancre du cycle (ANCRE_LUNDI).
async function ouvrirCourses(browser: Browser, planning: Planning): Promise<Page> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  await context.addInitScript(
    ([cyclePlanningJSON, cycleAfficheJSON]) => {
      for (const c of [
        "planning_courant_maj",
        "planning_dirty",
        "courses_cochees",
        "courses_cochees_maj",
        "courses_dirty",
      ]) {
        localStorage.removeItem(c);
      }
      localStorage.setItem("cycle_planning", cyclePlanningJSON as string);
      localStorage.setItem("cycle_affiche", cycleAfficheJSON as string);
    },
    [
      JSON.stringify({ ...planning, semaine: ANCRE_LUNDI }),
      JSON.stringify({ ancre: ANCRE_LUNDI, longueur: 7 }),
    ]
  );
  const page = await context.newPage();
  gardesCrash.push(attacherGardeCrash(page)); // garde anti-crash React (multi-contexte)
  await page.goto("/courses");
  // Attendre que la liste soit rendue (page hydratée → abonnement Realtime posé).
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeVisible();
  return page;
}

// Gardes anti-crash des pages créées à la main (la fixture auto ne couvre que la
// `page` par défaut, inutilisée ici). Vérifiées puis réinitialisées après chaque
// test. Cf. e2e/fixtures.ts.
const gardesCrash: { erreurs: string[] }[] = [];
test.afterEach(() => {
  const erreurs = gardesCrash.flatMap((g) => g.erreurs);
  gardesCrash.length = 0;
  expect(erreurs, `Crash React détecté : ${erreurs.join(" | ")}`).toEqual([]);
});

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  // Jour de courses du foyer remis à lundi (#257) : sinon une ancre héritée
  // d'une autre spec ferait diverger l'ancre injectée ci-dessus de celle que
  // hydraterCycle() calcule réellement au montage.
  await reinitialiserJourCoursesDistant(request);
});

test("une coche posée sur un appareil apparaît en temps réel sur l'autre (US-20, RG-32)", async ({
  browser,
}) => {
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);

  // Laisser à l'abonnement Realtime de B le temps de s'établir avant d'émettre.
  await deviceB.waitForTimeout(2000);

  // A coche « lardons ».
  await deviceA.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(deviceA.getByRole("checkbox", { name: /lardons/ })).toBeChecked();

  // B la voit cochée SANS rechargement (temps réel).
  await expect(deviceB.getByRole("checkbox", { name: /lardons/ })).toBeChecked({
    timeout: 15_000,
  });

  // A décoche → B la voit décochée, toujours en temps réel.
  await deviceA.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(deviceB.getByRole("checkbox", { name: /lardons/ })).not.toBeChecked({
    timeout: 15_000,
  });

  await deviceA.context().close();
  await deviceB.context().close();
});

test("un article manuel ajouté par un appareil apparaît en temps réel sur l'autre (#216)", async ({
  browser,
}) => {
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);
  await deviceB.waitForTimeout(2000);

  await deviceA.getByRole("button", { name: "Ajouter un article" }).click();
  await deviceA.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  await deviceA.getByRole("button", { name: "Enregistrer" }).click();
  await expect(deviceA.getByRole("checkbox", { name: /Sacs poubelle/ })).toBeVisible();

  // B le voit apparaître SANS rechargement (temps réel article_manuel).
  await expect(deviceB.getByRole("checkbox", { name: /Sacs poubelle/ })).toBeVisible({
    timeout: 15_000,
  });

  // A supprime → B le voit disparaître, toujours en temps réel.
  await deviceA.getByRole("button", { name: "Supprimer « Sacs poubelle »" }).click();
  await expect(deviceB.getByRole("checkbox", { name: /Sacs poubelle/ })).toHaveCount(0, {
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

  // A coche lardons, B coche tagliatelles — en parallèle.
  await deviceA.getByRole("checkbox", { name: /lardons/ }).click();
  await deviceB.getByRole("checkbox", { name: /tagliatelles/ }).click();

  // Chacun finit par voir LES DEUX coches : aucune n'a écrasé l'autre.
  for (const page of [deviceA, deviceB]) {
    await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeChecked({
      timeout: 15_000,
    });
    await expect(page.getByRole("checkbox", { name: /tagliatelles/ })).toBeChecked({
      timeout: 15_000,
    });
  }

  await deviceA.context().close();
  await deviceB.context().close();
});
