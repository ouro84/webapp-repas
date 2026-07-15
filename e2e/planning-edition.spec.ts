// Parcours critique n°1 (suite) — édition du planning : nombre de personnes
// (US-07), annulation (US-09), fiche recette (US-10), responsive (#64).
//
// Scindé de planning.spec.ts (perf CI : exécution sur un compte dédié distinct,
// en parallèle de l'autre moitié) — MÊME beforeEach (état vierge) et MÊMES
// imports. Session authentifiée via le projet "setup" (storageState).

import { test, expect } from "./fixtures";
import { request as apiRequest, type Page } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant, nettoyerPreferencesDistantes } from "./helpers";
import { semaineParDefaut } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";
import type { Planning } from "../types";

// Nettoyage des préférences favoris/évités (#219) : le compte de test étant
// partagé, une préférence résiduelle sur une recette du catalogue biaiserait
// le tirage pondéré des générations des specs suivantes du même job.
test.afterAll(async () => {
  const contexte = await apiRequest.newContext();
  try {
    await nettoyerPreferencesDistantes(contexte);
  } finally {
    await contexte.dispose();
  }
});

// Ancre du cycle par défaut (jour de courses = lundi) — celle que hydraterCycle
// calcule au montage de /courses (#257). `ancreParDefaut` inclut le décalage
// week-end, comme la semaine visée par la génération (semaineParDefaut).
const ANCRE = ancreParDefaut(new Date(), 1);

// Depuis #257, /courses ne lit PLUS `planning_courant` (local) : il projette le
// planning du CYCLE (store `cycle_planning`), normalement rempli depuis la BASE.
// Un planning FIXTURE (id de recette = slug, pas un UUID) NE PEUT PAS être
// persisté (`sauvegarder_planning` rejette « invalid input syntax for type
// uuid ») → le pont /planning→base→/courses est impossible avec des fixtures.
// On injecte donc `cycle_planning` DIRECTEMENT à l'état voulu (comme
// courses.spec), qui est exactement ce que /courses projette. Le garde-fou
// « local fait foi si la base est vide pour cette ancre » (#257) préserve
// l'injection (la base est vidée par nettoyerEtatDistant). La mécanique du
// stepper sur /planning est couverte par ailleurs (persistance : test « stepper
// borné » ; mise à l'échelle affichée : fiche recette US-10).
async function injecterCycle(page: Page, planning: Planning): Promise<void> {
  await page.addInitScript(
    ([cp, ca]) => {
      localStorage.setItem("cycle_planning", cp as string);
      localStorage.setItem("cycle_affiche", ca as string);
    },
    [
      JSON.stringify({ ...planning, semaine: ANCRE }),
      JSON.stringify({ ancre: ANCRE, longueur: 7 }),
    ]
  );
}

test.beforeEach(async ({ page, request }) => {
  // Base vierge pour le compte de test (planning + coches).
  await nettoyerEtatDistant(request);
  // Purge le cache local AVANT le chargement de la page (toutes les clés de sync).
  await page.addInitScript(() => {
    for (const c of [
      "planning_courant",
      "planning_courant_maj",
      "planning_dirty",
      "courses_cochees",
      "courses_cochees_maj",
      "courses_dirty",
      "semaine_affichee",
    ]) {
      localStorage.removeItem(c);
    }
  });
  await page.goto("/planning");
});

// ---------------------------------------------------------------------------
// US-07 — nombre de personnes par repas (RG-16/17).
// ---------------------------------------------------------------------------

test("le stepper de personnes est borné et persiste au rechargement", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const carteLundi = page.locator("main ul > li").first();
  await expect(carteLundi).toContainText("2 pers."); // défaut RG-16

  const plus = carteLundi.getByRole("button", {
    name: "Plus de personnes pour le dîner de lundi",
  });
  const moins = carteLundi.getByRole("button", {
    name: "Moins de personnes pour le dîner de lundi",
  });

  // À 2, on peut monter ; descendre deux fois borne à 1 (bouton désactivé).
  await moins.click();
  await expect(carteLundi).toContainText("1 pers.");
  await expect(moins).toBeDisabled();

  // Remonter à 4 et vérifier la persistance.
  await plus.click();
  await plus.click();
  await plus.click();
  await expect(carteLundi).toContainText("4 pers.");

  // Persistance via aller-retour SPA (et non reload : l'addInitScript du
  // beforeEach re-purgerait le planning — cf. piège documenté CLAUDE.md).
  // Round-trip par la NAV (Recettes → Planning) plutôt que /courses : depuis
  // #257, /courses projette le cycle depuis la base et son lien « ← Planning »
  // n'existe qu'à l'état chargé — un cycle vide (planning pas encore poussé)
  // n'aurait pas ce lien. La nav découple ce test de l'état de /courses.
  await page.getByRole("navigation").getByRole("link", { name: "Recettes" }).click();
  await page.waitForURL("**/recettes");
  await page.getByRole("navigation").getByRole("link", { name: "Planning" }).click();
  await page.waitForURL("**/planning");
  await expect(page.locator("main ul > li").first()).toContainText("4 pers.");
});

test("modifier le nombre de personnes met à l'échelle la liste de courses (RG-17)", async ({
  page,
}) => {
  // Omelette (base 2 pers = 6 œufs) au dîner de lundi, slot fixé à 4 personnes :
  // la liste de courses doit mettre à l'échelle (×2 → 12 œufs). On injecte le
  // cycle directement à 4 pers (cf. injecterCycle, #257) plutôt que de piloter
  // le stepper /planning, dont l'effet ne transite plus vers /courses via un
  // planning fixture non persistable.
  const omelette = recetteFixture("omelette-aux-champignons");
  const planning: Planning = {
    semaine: ANCRE,
    // Le nombre de personnes est porté par le SLOT (JourPlanning.personnes),
    // pas par la recette (dont la base reste 2, RG-16).
    jours: [{ jour: "lundi", diner: omelette, personnes: { diner: 4 } }],
  };
  await injecterCycle(page, planning);
  await page.goto("/courses");
  await page.waitForURL("**/courses");

  // 6 œufs (recette, base 2 pers) → 12 à 4 personnes (RG-17).
  const ligneOeufs = page.locator("li", { hasText: "œufs" }).first();
  await expect(ligneOeufs).toContainText("12");
});

test("modifier les personnes invalide la coche de l'article touché, pas les autres (RG-12)", async ({
  page,
}) => {
  const omelette = recetteFixture("omelette-aux-champignons");
  // Phase 1 — cycle à 2 pers (œufs = 6) : on coche les œufs.
  await injecterCycle(page, {
    semaine: ANCRE,
    jours: [{ jour: "lundi", diner: omelette, personnes: { diner: 2 } }],
  });
  await page.goto("/courses");
  await page.getByRole("checkbox", { name: /œufs/ }).click();
  await expect(page.getByRole("checkbox", { name: /œufs/ })).toBeChecked();
  // La coche est persistée (par CLÉ+quantité, pas par id de recette → valide même
  // pour une fixture) : on attend le flush pour la relire après rechargement.
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("courses_dirty")))
    .toBeNull();

  // Phase 2 — le nombre de personnes passe à 4 (œufs = 12). Simulé par une
  // ré-injection du cycle à 4 pers (le pont stepper /planning → /courses via un
  // planning fixture n'est pas persistable, #257). La coche posée à l'ancienne
  // quantité (6) ne correspond plus → invalidée (RG-12, cf. lib/coches).
  await injecterCycle(page, {
    semaine: ANCRE,
    jours: [{ jour: "lundi", diner: omelette, personnes: { diner: 4 } }],
  });
  await page.reload();
  await expect(page.locator("li", { hasText: "œufs" }).first()).toContainText("12");
  await expect(page.getByRole("checkbox", { name: /œufs/ })).not.toBeChecked();
});

test("une génération complète remet tous les repas à 2 personnes (RG-16)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const carteLundi = page.locator("main ul > li").first();
  await carteLundi
    .getByRole("button", { name: "Plus de personnes pour le dîner de lundi" })
    .click();
  await expect(carteLundi).toContainText("3 pers.");

  await page.getByRole("button", { name: "Régénérer" }).click();
  // La régénération affiche un toast d'annulation « Planning régénéré » (US-09),
  // distinct du « Planning généré » de la première génération.
  await expect(page.getByText("Planning régénéré")).toBeVisible();
  await expect(page.locator("main ul > li").first()).toContainText("2 pers.");
});

// ---------------------------------------------------------------------------
// US-09 — annuler une régénération (RG-19). Valide en CI (instance staging
// seedée) ; en local, la génération peut échouer si la base n'est pas seedée.
// ---------------------------------------------------------------------------

test("annuler une régénération restaure le planning précédent à l'identique (US-09)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const liste = page.locator("main ul");
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const planningInitial = await liste.innerText();

  await page.getByRole("button", { name: "Régénérer" }).click();
  // Toast d'annulation avec son action « Annuler ».
  await expect(page.getByText("Planning régénéré")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();

  // Confirmation + planning restauré à l'identique (US-09, RG-19).
  await expect(page.getByText("Annulé")).toBeVisible();
  await expect.poll(async () => liste.innerText()).toBe(planningInitial);
});

test("annuler une régénération au clavier (Ctrl/Cmd+Z) restaure le planning (US-09, RG-19)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const liste = page.locator("main ul");
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const planningInitial = await liste.innerText();

  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.getByText("Planning régénéré")).toBeVisible();

  // Raccourci clavier (et non le bouton du toast) : le handler de la page écoute
  // Ctrl/Cmd+Z hors champ de saisie. En CI (Linux) → Control.
  await page.keyboard.press("Control+z");

  await expect(page.getByText("Annulé")).toBeVisible();
  await expect.poll(async () => liste.innerText()).toBe(planningInitial);
});

test("annuler une régénération restaure aussi les coches effacées (US-09, RG-13/RG-19)", async ({
  page,
}) => {
  // Navigation par les LIENS de l'app (SPA) : un page.goto rejouerait
  // l'addInitScript du beforeEach, qui purge le planning.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  // Attendre la persistance : /courses projette le cycle depuis la BASE (#257) →
  // sans ce flush, /courses hydrate un backend encore vide (push débounce 800 ms).
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  // Cocher un article côté courses.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  const premierArticle = page.getByRole("checkbox").first();
  const nomArticle = await premierArticle.evaluate(
    (input) => input.closest("label")?.querySelector("span")?.textContent ?? ""
  );
  await premierArticle.click();
  await expect(
    page.getByRole("checkbox", { name: nomArticle }).first()
  ).toBeChecked();

  // Régénérer efface les coches (RG-13) ; annuler doit les rendre (RG-19).
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(page.getByText("Planning régénéré")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Annulé")).toBeVisible();

  // La coche est de retour : l'undo est « à l'identique », pas planning seul.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(
    page.getByRole("checkbox", { name: nomArticle }).first()
  ).toBeChecked();
});

// ---------------------------------------------------------------------------
// US-10 — consulter la fiche d'une recette (RG-20). Planning déterministe
// injecté en localStorage : pas de dépendance au catalogue seedé.
// ---------------------------------------------------------------------------

test("la fiche d'une recette s'ouvre au clic sur le nom, à l'échelle du slot et groupée (US-10, RG-20)", async ({
  page,
}) => {
  // Omelette : œufs + champignons (à acheter), beurre + poivre (fond de placard).
  const planning = {
    // semaineParDefaut (jamais dans le passé → pas de garde de confirmation #5
    // RG-24) : la fiche se lit sur /planning, qui affiche cette semaine.
    semaine: semaineParDefaut(),
    jours: [{ jour: "lundi", diner: recetteFixture("omelette-aux-champignons") }],
  };
  await page.addInitScript(
    (contenu) => localStorage.setItem("planning_courant", contenu),
    JSON.stringify(planning)
  );
  await page.goto("/planning");

  const carteLundi = page.locator("main ul > li").first();
  // Passer le slot à 4 personnes (×2) avant d'ouvrir la fiche.
  const plus = carteLundi.getByRole("button", {
    name: "Plus de personnes pour le dîner de lundi",
  });
  await plus.click();
  await plus.click();
  await expect(carteLundi).toContainText("4 pers.");

  // Le nom du plat ouvre la fiche.
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toBeVisible();
  await expect(
    fiche.getByRole("heading", { name: "Omelette aux champignons" })
  ).toBeVisible();
  await expect(fiche).toContainText("pour 4 personnes");

  // Quantité mise à l'échelle (RG-20 via RG-17) : champignons 250 g → 500 g.
  await expect(fiche).toContainText("champignons de Paris");
  await expect(fiche).toContainText("500 g");

  // Ingrédients groupés (RG-14) : à acheter + fond de placard.
  await expect(fiche.getByRole("heading", { name: "À acheter" })).toBeVisible();
  await expect(
    fiche.getByRole("heading", { name: /^Fond de placard/ })
  ).toBeVisible();

  // Recette injectée HORS-BASE (id slug, absente du catalogue chargé) → pas de
  // raccourci « Modifier » : évite un lien mort (#137). Une recette par défaut
  // RÉELLE en propose un (cf. test suivant).
  await expect(fiche.getByText("Modifier la recette")).toHaveCount(0);

  // Fermeture native via Échap.
  await page.keyboard.press("Escape");
  await expect(fiche).not.toBeVisible();
});

test("la fiche d'une recette par défaut propose « Modifier » et mène au formulaire (#137)", async ({
  page,
}) => {
  // Génération RÉELLE (catalogue seedé) → CI-only. Toutes les recettes du
  // planning sont des recettes par défaut présentes dans le catalogue chargé →
  // la fiche doit proposer « Modifier la recette » (#137).
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.getByText("Planning généré")).toBeVisible();

  // Ouvre la fiche du premier repas (la carte lundi porte déjeuner + dîner).
  const carteLundi = page.locator("main ul > li").first();
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).first().click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toBeVisible();

  // Le raccourci « Modifier » est proposé et mène au formulaire d'édition
  // (sans enregistrer → aucune mutation : dup+masquage ne se déclenche qu'au save).
  const modifier = fiche.getByText("Modifier la recette");
  await expect(modifier).toBeVisible();
  await modifier.click();
  await expect(
    page.getByRole("heading", { name: "Modifier la recette" })
  ).toBeVisible();
});

test("la fiche permet de marquer une recette favorite/évitée, avec bascule directe et persistance (#219, RG-58/61/63)", async ({
  page,
}) => {
  // Génération RÉELLE (catalogue seedé) → CI-only : le toggle écrit dans
  // recette_preference, table à clé étrangère vers `recette` — une fixture
  // hors-base (id slug) ferait échouer l'insertion (FK), cf. #257.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.getByText("Planning généré")).toBeVisible();

  const carteLundi = page.locator("main ul > li").first();
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).first().click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toBeVisible();

  // Neutre par défaut : aucun des deux toggles actif.
  await expect(
    fiche.getByRole("button", { name: "Marquer comme favorite" })
  ).toBeVisible();
  await expect(
    fiche.getByRole("button", { name: "Marquer comme évitée" })
  ).toBeVisible();

  // Favori (RG-58/61).
  await fiche.getByRole("button", { name: "Marquer comme favorite" }).click();
  await expect(
    fiche.getByRole("button", { name: "Retirer des favoris" })
  ).toBeVisible();

  // RG-63 : cliquer sur l'AUTRE bascule directement (favorite → évitée en un
  // clic, pas besoin de repasser par neutre).
  await fiche.getByRole("button", { name: "Marquer comme évitée" }).click();
  await expect(
    fiche.getByRole("button", { name: "Ne plus éviter" })
  ).toBeVisible();
  await expect(
    fiche.getByRole("button", { name: "Marquer comme favorite" })
  ).toBeVisible();

  // Persistance (RG-60, foyer) : ferme et rouvre la fiche.
  await page.keyboard.press("Escape");
  await expect(fiche).not.toBeVisible();
  await carteLundi.getByRole("button", { name: /^Voir la recette/ }).first().click();
  const ficheRouverte = page.getByRole("dialog");
  await expect(
    ficheRouverte.getByRole("button", { name: "Ne plus éviter" })
  ).toBeVisible();

  // Toggle off (RG-63) : cliquer sur l'état déjà actif revient au neutre.
  await ficheRouverte.getByRole("button", { name: "Ne plus éviter" }).click();
  await expect(
    ficheRouverte.getByRole("button", { name: "Marquer comme évitée" })
  ).toBeVisible();
});

test("la grille 7 colonnes n'apparaît qu'à partir du desktop (#64)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  // Mobile (viewport par défaut 390) : liste verticale (jours en toutes
  // lettres), la grille desktop (jours abrégés) est masquée.
  await expect(page.getByRole("heading", { name: "Lundi" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lun", exact: true })
  ).toBeHidden();

  // Desktop (≥ lg) : la grille 7 colonnes apparaît, la liste mobile disparaît.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Lun", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lundi" })).toBeHidden();
});
