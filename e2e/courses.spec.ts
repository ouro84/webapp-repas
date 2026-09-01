// Parcours critiques n°2 — la liste de courses (US-03, RG-05)
// et n°3 — les articles cochables en magasin (US-05, RG-10 à RG-14).
// Session authentifiée via le projet "setup" (storageState).
//
// Depuis #257, /courses affiche le CYCLE de courses (planning projeté en
// mémoire, clé localStorage dédiée `cycle_planning`), plus `planning_courant`
// (semaine ISO fixe) — cf. lib/sync.ts. Les fixtures déterministes sont donc
// injectées dans `cycle_planning` (+ `cycle_affiche` pour l'ancre/longueur),
// avec `semaine` posé à l'ANCRE du cycle courant (jour de courses foyer =
// lundi par défaut, remis par `reinitialiserJourCoursesDistant`) : le garde-fou
// « local fait foi si le backend est vide pour cette ancre » (#257, lib/sync.ts)
// ne préserve l'injection que si elle porte la MÊME ancre que celle calculée
// par `hydraterCycle()` au montage.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";
import { semaineISO, semaineParDefaut } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";
import type { Jour, Planning } from "../types";

// Ancre du cycle avec le jour de courses par DÉFAUT (lundi, ISO 1) — c'est
// l'ancre que `hydraterCycle()` calculera au montage tant que le foyer de test
// n'a pas été réglé sur un autre jour (cf. reinitialiserJourCoursesDistant,
// appelé ci-dessous en beforeEach). `ancreParDefaut` (pas `ancreCourante`) car
// hydraterCycle applique le décalage WEEK-END (samedi/dimanche → cycle suivant,
// #257) : l'injection doit porter la MÊME ancre, sinon le garde-fou « local fait
// foi » la rejette le week-end (ancre injectée ≠ ancre calculée).
const ANCRE_LUNDI = ancreParDefaut(new Date(), 1);

test.beforeEach(async ({ page, request }) => {
  // État distant vierge (#6) : sinon un planning persisté réapparaîtrait à
  // l'hydratation (casse l'état vide attendu par le test « après génération »).
  await nettoyerEtatDistant(request);
  // Jour de courses du foyer remis à lundi (#257) : sinon une ancre héritée
  // d'une autre spec (ex. cycle-courses.spec) ferait diverger l'ancre calculée
  // ici de celle injectée dans les fixtures ci-dessous.
  await reinitialiserJourCoursesDistant(request);
  // Les clés de sync locales sont purgées avant chaque chargement ; les tests
  // posent eux-mêmes cycle_planning/cycle_affiche via leur propre addInitScript.
  await page.addInitScript(() => {
    for (const c of [
      "planning_courant_maj",
      "planning_dirty",
      "courses_cochees_maj",
      "courses_dirty",
      "semaine_affichee",
    ]) {
      localStorage.removeItem(c);
    }
  });
});

// Injecte un planning directement dans le cache du CYCLE affiché (#257) :
// `cycle_planning` (bypass la projection réseau normalement faite par
// chargerCycleDansCache) + `cycle_affiche` (ancre/longueur), pour que
// useCycleAffiche/useCyclePlanning résolvent sans attendre l'hydratation
// réseau. Le `semaine` du planning DOIT valoir l'ancre visée (c'est ainsi que
// /courses identifie le planning projeté, cf. lib/cycles.ts#planningDuCycle).
async function injecterCyclePlanning(
  page: Page,
  planning: Planning,
  ancre: string = ANCRE_LUNDI
): Promise<void> {
  await page.addInitScript(
    ([cyclePlanningJSON, cycleAfficheJSON]) => {
      localStorage.setItem("cycle_planning", cyclePlanningJSON as string);
      localStorage.setItem("cycle_affiche", cycleAfficheJSON as string);
    },
    [
      JSON.stringify({ ...planning, semaine: ancre }),
      JSON.stringify({ ancre, longueur: 7 }),
    ]
  );
}

// Planning déterministe injecté en localStorage (découplage, issue #29).
// Composition agrégée attendue (fixtures figées) : 7 articles à acheter —
// Produits frais : crème fraîche (briquette), oeufs (9), parmesan (50 g),
// pâte brisée ; Légumes & Fruits : champignons de Paris ; Épicerie :
// tagliatelles ; Viandes & Poissons : lardons — et 4 au fond de placard
// (beurre, huile d'olive, poivre, sel).
function planningDeterministe(): Planning {
  const choisies = [
    recetteFixture("omelette-aux-champignons"),
    recetteFixture("tagliatelles-au-parmesan"),
    recetteFixture("quiche-aux-lardons"),
  ];
  const jours: Jour[] = ["lundi", "mardi", "mercredi"];
  return {
    // Semaine : non significative ici (le planning est injecté directement
    // dans cycle_planning, pas reconstruit depuis le stockage par semaine) —
    // injecterCyclePlanning la remplace par l'ANCRE du cycle visé.
    semaine: semaineISO(),
    jours: choisies.map((recette, i) => ({ jour: jours[i]!, diner: recette })),
  };
}

test("après génération d'un planning, la liste de courses n'est pas vide", async ({
  page,
}) => {
  // Parcours réel : générer le planning puis naviguer vers les courses.
  await page.addInitScript(() => localStorage.removeItem("planning_courant"));
  await page.goto("/planning");
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  // Depuis #257, /courses NE lit PLUS `planning_courant` (local) mais PROJETTE
  // le planning depuis la BASE (chargerCycleDansCache). Il faut donc attendre
  // que le push débounce (800 ms) ait persisté le planning généré AVANT de
  // naviguer, sinon /courses hydrate un backend encore vide → liste vide (mirroir
  // de foyer-clonage.spec, même contrainte).
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");

  await expect(
    page.getByRole("heading", { name: "Liste de courses" })
  ).toBeVisible();
  // Le compteur de progression confirme une liste non vide (« 0 coché sur 38 … », US-05).
  await expect(page.getByText(/^0 coché sur [1-9]\d*/)).toBeVisible();
  // Au moins une catégorie et plusieurs lignes d'ingrédients.
  await expect(page.locator("main section h2").first()).toBeVisible();
  expect(await page.locator("main li").count()).toBeGreaterThan(0);
});

test("les catégories d'ingrédients et le fond de placard sont visibles", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  // Les sections de catégories attendues pour ces recettes (RG-05, étape 5).
  for (const categorie of ["Viandes & Poissons", "Produits frais", "Épicerie"]) {
    await expect(
      page.getByRole("heading", { name: categorie })
    ).toBeVisible();
  }

  // La section fond de placard et sa consigne (F-09).
  await expect(
    page.getByRole("heading", { name: "Fond de placard" })
  ).toBeVisible();
  await expect(page.getByText("À vérifier avant d'acheter")).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-05 — articles cochables (RG-10 à RG-14)
// ---------------------------------------------------------------------------

test("cocher un article le raye, l'envoie en fin de catégorie et persiste au rechargement", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  const produitsFrais = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Produits frais" }) });

  // Avant : « crème fraîche » est en tête de sa catégorie (ordre alphabétique).
  await expect(produitsFrais.locator("li").first()).toContainText("crème fraîche");

  // Cocher (RG-10) : la ligne entière est cliquable via le label.
  await page.getByRole("checkbox", { name: /crème fraîche/ }).click();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).toBeChecked();

  // RG-11 : rayé + déplacé en fin de catégorie. RG-14 : compteur à 1 sur 7.
  await expect(produitsFrais.locator("li").last()).toContainText("crème fraîche");
  await expect(
    produitsFrais.locator("li").last().locator("span").first()
  ).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByText(/^1 coché sur 7/)).toBeVisible();

  // RG-12 : la coche survit à un rechargement de page.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).toBeChecked();
  await expect(page.getByText(/^1 coché sur 7/)).toBeVisible();

  // Décocher : retour à la place alphabétique, compteur à 0.
  await page.getByRole("checkbox", { name: /crème fraîche/ }).click();
  await expect(page.getByRole("checkbox", { name: /crème fraîche/ })).not.toBeChecked();
  await expect(produitsFrais.locator("li").first()).toContainText("crème fraîche");
  await expect(page.getByText(/^0 coché sur 7/)).toBeVisible();
});

test("le fond de placard est cochable mais n'entre pas dans la progression (RG-14)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("checkbox", { name: /beurre/ }).click();

  // Coché visuellement… mais le compteur d'articles à acheter reste à 0.
  await expect(page.getByRole("checkbox", { name: /beurre/ })).toBeChecked();
  await expect(page.getByText(/^0 coché sur 7/)).toBeVisible();
});

test("« Tout décocher » retire toutes les coches, fond de placard compris", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  // Le bouton n'apparaît qu'à partir de la première coche.
  await expect(page.getByRole("button", { name: "Tout décocher" })).toHaveCount(0);

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /beurre/ }).click();
  await expect(page.getByRole("checkbox", { name: /beurre/ })).toBeChecked();
  await expect(page.getByText(/^1 coché sur 7/)).toBeVisible();

  await page.getByRole("button", { name: "Tout décocher" }).click();

  await expect(page.getByText(/^0 coché sur 7/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /lardons/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /beurre/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Tout décocher" })).toHaveCount(0);
});

test("une section de catégorie se replie et se déplie (US-05)", async ({ page }) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  const enTete = page.getByRole("button", { name: "Épicerie" });
  const tagliatelles = page.getByRole("checkbox", { name: /tagliatelles/ });

  await expect(tagliatelles).toBeVisible();
  await enTete.click();
  await expect(enTete).toHaveAttribute("aria-expanded", "false");
  await expect(tagliatelles).toHaveCount(0); // section repliée : liste démontée
  await enTete.click();
  await expect(tagliatelles).toBeVisible();
});

test("une catégorie entièrement cochée glisse en bas de liste, titre rayé (#111)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  // Titres de section dans l'ordre du DOM (catégories normales puis fond de
  // placard, toujours en dernier). « Viandes & Poissons » n'a qu'un article
  // (lardons) → cocher cet article termine la catégorie.
  const titres = page.locator("main section h2 button");

  // Ordre canonique initial (RG-05).
  await expect(titres).toHaveText([
    "Viandes & Poissons",
    "Légumes & Fruits",
    "Produits frais",
    "Épicerie",
    "Fond de placard",
  ]);

  // RG-39 : cocher le dernier (seul) article de Viandes → la catégorie glisse
  // en bas des catégories normales, juste avant le fond de placard.
  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(titres).toHaveText([
    "Légumes & Fruits",
    "Produits frais",
    "Épicerie",
    "Viandes & Poissons",
    "Fond de placard",
  ]);

  // RG-39 : titre rayé, et la section reste ouverte (article visible).
  const viandes = page.getByRole("button", { name: "Viandes & Poissons" });
  await expect(viandes).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeVisible();

  // RG-39 : décocher fait remonter la catégorie à sa place canonique, sans rayé.
  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(titres).toHaveText([
    "Viandes & Poissons",
    "Légumes & Fruits",
    "Produits frais",
    "Épicerie",
    "Fond de placard",
  ]);
  await expect(viandes).toHaveCSS("text-decoration-line", "none");
});

test("régénérer le planning réinitialise toutes les coches (RG-13)", async ({
  page,
}) => {
  // /courses lit le cycle projeté ; /planning lit `planning_courant` (par
  // semaine). Pour que /planning propose « Régénérer » (et non « Générer »), on
  // injecte AUSSI un planning_courant à la semaine que /planning affiche par
  // défaut (semaineParDefaut) — sinon /planning serait vide (#257 : deux stores
  // distincts, cf. lib/sync.ts). Le cycle_planning injecté sert la coche initiale.
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify({ ...planningDeterministe(), semaine: semaineParDefaut() })
  );
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.getByText(/^1 coché sur 7/)).toBeVisible();

  // Génération complète depuis la page planning (vraies recettes, liste
  // non déterministe) : les coches doivent être effacées (RG-13). La
  // régénération vise semaineParDefaut, que le cycle par défaut recouvre
  // (ancreParDefaut, cf. ANCRE_LUNDI) : le cycle affiché récupère donc bien ce
  // planning fraîchement régénéré (projeté depuis la base).
  await page.goto("/planning");
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  // Attendre la persistance (le cycle /courses projette depuis la BASE, #257).
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await page.goto("/courses");
  await expect(page.getByText(/^0 coché sur [1-9]\d*/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-13 — synchronisation multi-device des coches (#6 PR3). L'état coché est
// persisté en base ; un device au cache vide le retrouve à l'hydratation.
// ---------------------------------------------------------------------------
test("l'état coché est resynchronisé depuis la base sur un device au cache vide (US-13)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeChecked();

  // Attendre la persistance des coches en base (drapeau dirty effacé).
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("courses_dirty")))
    .toBeNull();

  // Simuler un autre device : vider le cache local des coches puis recharger
  // (l'addInitScript du beforeEach ne touche pas aux clés de coches).
  await page.evaluate(() => {
    localStorage.removeItem("courses_cochees");
    localStorage.removeItem("courses_cochees_maj");
    localStorage.removeItem("courses_dirty");
  });
  await page.reload();

  // La coche est restaurée depuis la base (hydratation des coches).
  await expect(page.getByRole("checkbox", { name: /lardons/ })).toBeChecked();
});

test("les libellés s'accordent en nombre selon la quantité (US-08)", async ({
  page,
}) => {
  // Planning forgé : un ingrédient pièce au singulier (1), un au pluriel (3),
  // un nom de masse invariable (200 g). La page lit le planning brut depuis
  // localStorage — pas besoin que la recette existe dans le dataset (#29).
  const planning: Planning = {
    semaine: semaineISO(), // remplacé par l'ancre dans injecterCyclePlanning
    jours: [
      {
        jour: "lundi",
        diner: {
          id: "test-accord",
          nom: "Test accord",
          tempsPreparation: "rapide",
          ingredients: [
            { nom: "carottes", quantite: 1, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
            { nom: "tomates", quantite: 3, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
            { nom: "beurre", quantite: 200, unite: "g", categorie: "produits-frais", fondDePlacard: false },
          ],
        },
      },
    ],
  };
  await injecterCyclePlanning(page, planning);
  await page.goto("/courses");

  // Quantité 1 → singulier ; quantité 3 → pluriel ; masse → invariable.
  await expect(page.getByText("carotte", { exact: true })).toBeVisible();
  await expect(page.getByText("tomates", { exact: true })).toBeVisible();
  await expect(page.getByText("beurre", { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-47 — article manuel de la liste de courses (#216, RG-40 à RG-43)
// ---------------------------------------------------------------------------

test("ajoute un article manuel, visible dans sa catégorie et cochable (RG-42/43)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  // Catégorie laissée au défaut ("Autre") : pas de section « Autre » dans le
  // planning déterministe → une nouvelle section doit apparaître.
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByRole("heading", { name: "Autre" })).toBeVisible();
  const checkbox = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await checkbox.click();
  await expect(checkbox).toBeChecked();
});

test("modifie un article manuel en place, conserve l'état coché (RG-43 bis)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const checkbox = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await checkbox.click();
  await expect(checkbox).toBeChecked();

  await page.getByRole("button", { name: "Modifier « Sacs poubelle »" }).click();
  const champLibelle = page.getByLabel("Article", { exact: true });
  await expect(champLibelle).toHaveValue("Sacs poubelle");
  await champLibelle.fill("Sacs poubelle 50L");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  // Même ligne : nouveau libellé, coche conservée (pas de suppression/recréation).
  // Nom EXACT (pas /Sacs poubelle/, substring que « Sacs poubelle 50L » matcherait aussi).
  await expect(page.getByRole("checkbox", { name: "Sacs poubelle", exact: true })).toHaveCount(0);
  const modifie = page.getByRole("checkbox", { name: /Sacs poubelle 50L/ });
  await expect(modifie).toBeVisible();
  await expect(modifie).toBeChecked();
});

test("supprime un article manuel (RG-42)", async ({ page }) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Piles AA");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("checkbox", { name: /Piles AA/ })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer « Piles AA »" }).click();
  await expect(page.getByRole("checkbox", { name: /Piles AA/ })).toHaveCount(0);
});

test("un article manuel survit à la régénération du planning, contrairement aux coches de recette (RG-41)", async ({
  page,
}) => {
  // Même montage que « régénérer réinitialise les coches » (RG-13) : planning
  // injecté à la fois pour /planning (planning_courant) et /courses (cycle_planning).
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify({ ...planningDeterministe(), semaine: semaineParDefaut() })
  );
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const articleManuel = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await articleManuel.click();
  await expect(articleManuel).toBeChecked();

  await page.getByRole("checkbox", { name: /lardons/ }).click();
  // Le compteur RG-14 inclut l'article manuel dans le total (8 = 7 ingrédients
  // + 1 article manuel, ni l'un ni l'autre au fond de placard) : 2 cochés
  // (manuel + lardons).
  await expect(page.getByText(/^2 cochés sur 8/)).toBeVisible();

  await page.goto("/planning");
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await page.goto("/courses");
  // RG-13 : les coches d'ingrédients dérivés sont réinitialisées. Le total
  // n'est plus déterministe (« Régénérer » pioche dans le vrai catalogue, pas
  // les 3 fixtures) — seul le compte de cochés (1, l'article manuel survivant)
  // est prévisible, comme le total dans « régénère (RG-13) » ci-dessus.
  await expect(page.getByText(/^1 coché sur [1-9]\d*/)).toBeVisible();
  // L'article manuel, LUI, n'est jamais touché par la régénération (RG-41) :
  // présent ET toujours coché.
  const articleApresRegeneration = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await expect(articleApresRegeneration).toBeVisible();
  await expect(articleApresRegeneration).toBeChecked();
});

test("« Tout décocher » décoche l'article manuel SANS le supprimer (RG-41)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const articleManuel = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await articleManuel.click();
  await page.getByRole("checkbox", { name: /lardons/ }).click();

  await page.getByRole("button", { name: "Tout décocher" }).click();

  await expect(articleManuel).toBeVisible(); // toujours là…
  await expect(articleManuel).not.toBeChecked(); // …mais décoché.
});

// ============================================================================
// Lisibilité du déplacement (RG-11 / RG-39) — les premiers utilisateurs
// croyaient qu'un article coché avait DISPARU.
//
// On ne teste PAS ici la durée/courbe du glissement ni la présence de la
// pulsation d'atterrissage : timing-dépendant donc flaky, et sans valeur de
// régression. Ce qui est verrouillé, c'est le contrat FONCTIONNEL (ordre du
// DOM, texte, accessibilité) — le contrat visuel se vérifie à l'œil.
// ============================================================================

test("une catégorie terminée est annoncée et comptée dans l'en-tête (RG-39)", async ({
  page,
}) => {
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  const repere = page.getByText(/catégories? terminées?, descendues? en bas de la liste/);

  // Rien de terminé : le <p> est monté mais vide (réservation de hauteur).
  await expect(repere).toHaveCount(0);

  // « Viandes & Poissons » n'a qu'un article (lardons) : le cocher termine la
  // catégorie, qui glisse hors de vue sur mobile → d'où ce repère persistant.
  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(
    page.getByText("1 catégorie terminée, descendue en bas de la liste")
  ).toBeVisible();

  // Réversible (RG-39) : décocher retire le repère.
  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(repere).toHaveCount(0);
});

test("le réordonnancement fonctionne sous mouvement réduit (RG-11 / RG-39)", async ({
  page,
}) => {
  // Garde de la garde JS de `avecTransition()` : sous reduced motion aucune
  // View Transition n'est démarrée (et donc aucune pulsation). RG-11 et RG-39
  // sont FONCTIONNELS, pas décoratifs — le réordonnancement doit rester correct
  // et instantané. `emulateMedia` plutôt que `test.use` : la préférence est lue
  // par matchMedia AU MOMENT du clic, pas au chargement.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  // RG-11 : l'article coché passe en fin de sa catégorie.
  const produitsFrais = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Produits frais" }),
  });
  await page.getByRole("checkbox", { name: /crème fraîche/ }).click();
  await expect(produitsFrais.locator("li").last()).toContainText("crème fraîche");

  // RG-39 : la catégorie terminée glisse en bas des catégories normales.
  await page.getByRole("checkbox", { name: /lardons/ }).click();
  await expect(page.locator("main section h2 button")).toHaveText([
    "Légumes & Fruits",
    "Produits frais",
    "Épicerie",
    "Viandes & Poissons",
    "Fond de placard",
  ]);
});

test("cocher puis tout décocher un article manuel ne lève aucune erreur non gérée", async ({
  page,
}) => {
  // `basculerCocheArticleManuel` et `viderCochesArticlesManuels` RETHROW après
  // revert : sans `.catch` côté page, un échec produit un rejet non géré
  // (bruit Sentry, coche qui revient sans explication). La fixture anti-crash
  // de e2e/fixtures.ts ne filtre QUE les signatures React — d'où cette écoute
  // dédiée.
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(e.message));

  await injecterCyclePlanning(page, planningDeterministe());
  await page.goto("/courses");

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Article", { exact: true }).fill("Sacs poubelle");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const articleManuel = page.getByRole("checkbox", { name: /Sacs poubelle/ });
  await articleManuel.click();
  await expect(articleManuel).toBeChecked();
  await articleManuel.click();
  await expect(articleManuel).not.toBeChecked();

  // Attendre l'état AVANT de cliquer ailleurs : « Tout décocher » n'est rendu
  // que si `aDesCoches` est vrai — cliquer pendant que la coche se pose fait
  // remonter le bouton et Playwright perd sa cible (« element was detached »).
  await articleManuel.click();
  await expect(articleManuel).toBeChecked();

  await page.getByRole("button", { name: "Tout décocher" }).click();
  await expect(articleManuel).not.toBeChecked();

  expect(erreurs).toEqual([]);
});
