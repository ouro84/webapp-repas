// Parcours e2e — cycle de courses non calendaire (#257).
//
// Le « jour de courses » du foyer (réglage de /profil, section « Mon foyer »)
// ancre la fenêtre de 7 jours affichée par /courses (lib/cycles.ts —
// ancreCourante), en lieu et place de la semaine ISO fixe. Deux parcours :
//  1. Le DÉFAUT (lundi) ne régresse pas : sans planning généré, l'état vide
//     de /courses s'affiche normalement (aucun crash).
//  2. Changer le jour vers jeudi ré-ancre la liste : le libellé « Courses
//     du … » apparaît pour un cycle chargé, et la navigation
//     ‹ Cycle suivant › ne plante jamais (avec ou sans contenu sur le cycle
//     visé).
//
// Foyer PARTAGÉ (compte de test) : le jour de courses est remis à lundi en
// beforeEach ET afterAll pour ne pas faire diverger l'ancre vue par les
// autres specs (courses.spec, coches-realtime.spec…).
//
// Déterminisme (revue) : le test 2 injectait initialement une VRAIE
// génération sur /planning puis un `page.goto("/courses")` immédiat. La
// persistance du planning est débouncée (800 ms, lib/sync.ts) et il n'y a pas
// de flush au déchargement de page : un `page.goto` ~150 ms après le clic
// « Générer » abandonne le contexte JS avant que le push n'ait eu lieu → le
// backend restait vide → /courses rendait l'état VIDE (pas de « Courses
// du… », pas de bouton « Cycle suivant ») → timeout d'assertion. Échec
// fiable (bloquant CI), pas un flake. Le test injecte désormais directement
// un planning déterministe dans `cycle_planning` (miroir de
// `injecterCyclePlanning` dans courses.spec.ts), sans dépendre d'une
// génération réelle ni d'une course avec le débounce de synchronisation.

import { test, expect } from "./fixtures";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";
import { ancreParDefaut } from "../lib/cycles";
import type { Planning } from "../types";

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
  // Exerce réellement le sélecteur de /profil (definirJourCoursesFoyer de
  // bout en bout), contrairement à reinitialiserJourCoursesDistant qui ne
  // sert qu'à la remise à zéro.
  await page.goto("/profil");
  const radioJeudi = page.getByRole("radio", { name: "jeudi" });
  await radioJeudi.click();
  // Confirme l'écriture avant de continuer (definirJourCoursesFoyer + le
  // rafraîchissement qui suit sont asynchrones) — sinon /courses pourrait
  // encore lire l'ancien jour de courses côté base au montage.
  await expect(radioJeudi).toHaveAttribute("aria-checked", "true");

  // Ancre du cycle jeudi calculée dans le test — c'est exactement ce que
  // hydraterCycle() calculera au montage de /courses désormais que le jour
  // de courses du foyer vaut 4 (cf. ci-dessus). `ancreParDefaut` (pas
  // `ancreCourante`) pour inclure le décalage WEEK-END appliqué par
  // hydraterCycle (#257) — sinon l'injection ne matcherait pas le samedi/dimanche.
  const ancreJeudi = ancreParDefaut(new Date(), 4);

  // Planning synthétique déterministe, injecté directement dans le cache du
  // cycle (localStorage `cycle_planning` + `cycle_affiche`), à la même ancre
  // que celle calculée ci-dessus. Le backend a été vidé par
  // nettoyerEtatDistant (beforeEach) : le garde-fou « local fait foi si le
  // backend est vide pour cette ancre » (lib/sync.ts#chargerCycleDansCache)
  // préserve donc cette injection — à condition qu'elle porte la MÊME ancre,
  // d'où le calcul explicite ci-dessus plutôt qu'une valeur en dur.
  const planning: Planning = {
    semaine: ancreJeudi,
    jours: [
      {
        jour: "lundi",
        diner: {
          id: "test-cycle-jeudi",
          nom: "Test cycle jeudi",
          tempsPreparation: "rapide",
          ingredients: [
            {
              nom: "carottes",
              quantite: 1,
              unite: "piece",
              categorie: "legumes-fruits",
              fondDePlacard: false,
            },
          ],
        },
      },
    ],
  };
  await page.addInitScript(
    ([planningJSON, cycleAfficheJSON]) => {
      localStorage.setItem("cycle_planning", planningJSON as string);
      localStorage.setItem("cycle_affiche", cycleAfficheJSON as string);
    },
    [
      JSON.stringify(planning),
      JSON.stringify({ ancre: ancreJeudi, longueur: 7 }),
    ]
  );

  // `addInitScript` rejoue à chaque chargement complet : un `page.goto` est
  // donc sûr ici (contrairement à une génération réelle en attente de push).
  await page.goto("/courses");
  await expect(page.getByText(/Courses du/)).toBeVisible();

  // La navigation cycle (‹ Cycle précédent / Cycle suivant ›) n'est rendue
  // que pour un cycle CHARGÉ (liste non vide, cf. app/courses/page.tsx) :
  // sa présence ici prouve que le jour de courses « jeudi » ré-ancre bien la
  // fenêtre affichée, et pas seulement le lundi par défaut du test 1.
  const boutonPrecedent = page.getByRole("button", { name: "Cycle précédent" });
  const boutonSuivant = page.getByRole("button", { name: "Cycle suivant" });
  await expect(boutonPrecedent).toBeVisible();
  await expect(boutonSuivant).toBeVisible();

  // Cliquer ne doit jamais planter, que le cycle suivant ait ou non du
  // contenu — le planning injecté ci-dessus ne couvre que l'ancre jeudi
  // (backend vide, aucun autre cycle en cache), donc le cycle suivant
  // retombe légitimement en état vide. Le titre h1 « Liste de courses » est
  // commun aux deux états (chargé et vide) : c'est l'assertion robuste,
  // contrairement à un `/Courses du/` qui ne s'affiche que dans l'état chargé.
  await boutonSuivant.click();
  await expect(
    page.getByRole("heading", { name: "Liste de courses" })
  ).toBeVisible();
});

test("« Générer mon cycle » remplit la liste depuis l'état vide (#259)", async ({
  page,
}) => {
  // Génération RÉELLE (catalogue global) → fiable en CI (staging seedé), pas en
  // local sur prod. Défaut lundi + backend vidé (beforeEach) ⇒ /courses état vide.
  await page.goto("/courses");
  await expect(page.getByText("Aucun repas planifié sur ce cycle")).toBeVisible();

  // Un clic remplit tout le cycle sans quitter /courses (D3 « Générer mon cycle »).
  await page.getByRole("button", { name: "Générer mon cycle" }).click();

  // La liste se peuple : compteur de progression + au moins un article cochable.
  await expect(page.getByText(/coché.? sur [1-9]/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main li").first()).toBeVisible();
});
