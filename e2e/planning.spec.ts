// Parcours critique n°1 — le planning (US-01, US-04).
// Session authentifiée via le projet "setup" (storageState).
//
// Chaque test repart d'un état vierge : localStorage purgé ET planning/coches
// distants supprimés (#6 — sinon l'hydratation depuis la base ferait
// réapparaître un planning d'un test précédent et casserait l'état vide).
//
// NB : l'édition du planning (personnes US-07, annulation US-09, fiche US-10,
// responsive #64) a été scindée dans planning-edition.spec.ts (perf CI : les
// deux moitiés tournent en parallèle sur des comptes dédiés).

import { test, expect } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { nettoyerEtatDistant } from "./helpers";
import { semaineParDefaut } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";

// Ancre du cycle par défaut (jour de courses lundi) — celle que hydraterCycle
// calcule au montage de /courses (#257 ; inclut le décalage week-end).
const ANCRE = ancreParDefaut(new Date(), 1);

test.beforeEach(async ({ page, request }) => {
  // Base vierge pour le compte de test (planning + coches).
  await nettoyerEtatDistant(request);
  // Purge le cache local AVANT le chargement de la page (toutes les clés de sync,
  // y compris celles du cycle #257 — sinon un cycle d'un test précédent fuiterait).
  await page.addInitScript(() => {
    for (const c of [
      "planning_courant",
      "planning_courant_maj",
      "planning_dirty",
      "courses_cochees",
      "courses_cochees_maj",
      "courses_dirty",
      "semaine_affichee",
      "cycle_planning",
      "cycle_affiche",
    ]) {
      localStorage.removeItem(c);
    }
  });
  await page.goto("/planning");
});

test("l'utilisateur arrive sur un état initial clair avec un bouton de génération", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Mon planning de la semaine" })
  ).toBeVisible();
  await expect(page.getByText("Aucun planning pour cette semaine")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Générer mon planning" })
  ).toBeVisible();
});

test("la génération affiche un planning de 7 jours avec leurs 14 repas", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();

  // Confirmation utilisateur (toast sonner).
  await expect(page.getByText("Planning généré")).toBeVisible();

  // Vue mobile (RG-08) : une carte par jour, lundi → dimanche.
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);
  await expect(jours.first()).toContainText("Lundi");
  await expect(jours.last()).toContainText("Dimanche");

  // 14 repas : un déjeuner ET un dîner chaque jour (#3) — un bouton de
  // remplacement par slot.
  await expect(
    page.getByRole("button", { name: /^Changer le/ }).filter({ visible: true })
  ).toHaveCount(14);

  // Les déjeuners de semaine existent désormais (US-01, RG-01).
  await expect(
    page.getByRole("button", { name: "Changer le déjeuner de lundi" })
  ).toBeVisible();

  // Le numéro de semaine s'affiche dans le navigateur (« Semaine du … »).
  await expect(page.getByText(/^Semaine du /).first()).toBeVisible();

  // Accès contextuel aux réglages de génération depuis le planning (#206).
  const lienReglages = page.getByRole("link", { name: "Réglages de génération" });
  await expect(lienReglages).toBeVisible();
  await expect(lienReglages).toHaveAttribute("href", "/reglages");
});

// ---------------------------------------------------------------------------
// US-14 — navigation entre semaines + génération de la semaine affichée (#5).
// Assertions relatives pour rester robustes à la date du run.
// ---------------------------------------------------------------------------
test("naviguer vers une autre semaine et y générer un planning (US-14)", async ({
  page,
}) => {
  const label = page.getByText(/^Semaine du /).first();
  const depart = (await label.innerText()).trim();

  // Avancer d'une semaine (navigation asynchrone → on attend le changement).
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect.poll(async () => (await label.innerText()).trim()).not.toBe(depart);
  const cible = (await label.innerText()).trim();

  // Générer pour la semaine affichée.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.getByText(/^Planning généré — Semaine du /)).toBeVisible();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  // La semaine affichée reste la cible.
  await expect(page.getByText(cible).first()).toBeVisible();
});

test("l'historique : un planning généré est retrouvé en revenant sur sa semaine (US-14)", async ({
  page,
}) => {
  // Générer la semaine par défaut, attendre la persistance.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();
  const defaut = (await page.getByText(/^Semaine du /).first().innerText()).trim();

  // Avancer (semaine future vide), puis revenir → le planning est retrouvé.
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect.poll(async () => (await page.getByText(/^Semaine du /).first().innerText()).trim()).not.toBe(defaut);
  await expect(page.locator("main ul > li")).toHaveCount(0); // semaine vide

  await page.getByRole("button", { name: "Semaine précédente" }).click();
  await expect.poll(async () => (await page.getByText(/^Semaine du /).first().innerText()).trim()).toBe(defaut);
  await expect(page.locator("main ul > li")).toHaveCount(7); // planning retrouvé depuis la base
});

test("modifier une semaine passée demande confirmation (US-14, RG-24)", async ({
  page,
}) => {
  const label = page.getByText(/^Semaine du /).first();

  // Reculer DEUX fois pour atterrir à coup sûr sur une semaine PASSÉE, quel que
  // soit le jour du run (le défaut peut être la semaine prochaine le week-end).
  for (let i = 0; i < 2; i++) {
    const avant = (await label.innerText()).trim();
    await page.getByRole("button", { name: "Semaine précédente" }).click();
    await expect.poll(async () => (await label.innerText()).trim()).not.toBe(avant);
  }
  // On est sur une semaine passée : le navigateur affiche un libellé « passé »
  // (« Semaine dernière » / « Il y a N semaines »), pas « Cette semaine ».
  await expect(
    page.getByText(/^(Semaine dernière|Il y a \d+ semaines)$/)
  ).toBeVisible();

  // Générer cette semaine passée (vide → aucune confirmation, rien à écraser).
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.getByText(/^Planning généré — Semaine du /)).toBeVisible();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();
  const planningAvant = await page.locator("main ul").innerText();

  const modale = page.getByRole("dialog", { name: "Modifier une semaine passée ?" });

  // Régénérer un planning passé → confirmation. Annuler le laisse intact.
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(modale).toBeVisible();
  await modale.getByRole("button", { name: "Annuler" }).click();
  await expect(modale).not.toBeVisible();
  await expect(page.getByText("Planning régénéré")).toHaveCount(0);
  expect(await page.locator("main ul").innerText()).toBe(planningAvant);

  // Confirmer régénère réellement.
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect(modale).toBeVisible();
  await modale.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByText("Planning régénéré")).toBeVisible();

  // Modifier un slot d'une semaine passée demande aussi confirmation.
  await page
    .locator("main ul > li")
    .first()
    .getByRole("button", { name: "Changer le dîner de lundi" })
    .click();
  await expect(modale).toBeVisible();
  await modale.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByText("Recette remplacée")).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-12 — marquer un repas en « restes » (RG-22). Planning déterministe injecté.
// ---------------------------------------------------------------------------
test("marquer un repas en « restes » l'exclut de la liste de courses (US-12)", async ({
  page,
}) => {
  const omelette = recetteFixture("omelette-aux-champignons");
  const jourNormal = { jour: "lundi", diner: omelette };
  // planning_courant (fixture) pilote la carte /planning et son bouton restes ;
  // cycle_planning alimente la projection /courses. Depuis #257, /courses lit le
  // CYCLE (projeté depuis la base) et un planning fixture (id slug) n'est pas
  // persistable → on reflète l'état « restes » dans le cycle via page.evaluate
  // (le pont /planning→base→/courses n'existe pas pour une fixture).
  await page.addInitScript(
    ([pc, cp, ca]) => {
      localStorage.setItem("planning_courant", pc as string);
      localStorage.setItem("cycle_planning", cp as string);
      localStorage.setItem("cycle_affiche", ca as string);
    },
    [
      JSON.stringify({ semaine: semaineParDefaut(), jours: [jourNormal] }),
      JSON.stringify({ semaine: ANCRE, jours: [jourNormal] }),
      JSON.stringify({ ancre: ANCRE, longueur: 7 }),
    ]
  );
  await page.goto("/planning");

  const carteLundi = page.locator("main ul > li").first();

  // Au départ, les œufs de l'omelette sont dans la liste de courses.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: /œufs/ })).toBeVisible();

  // Marquer le dîner de lundi en « restes » (bouton de la card, sur /planning).
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  await carteLundi
    .getByRole("button", { name: "Marquer le dîner de lundi en restes" })
    .click();
  await expect(page.getByText("Repas marqué « Restes »")).toBeVisible();
  await expect(
    carteLundi.getByRole("button", { name: "Cuisiner le dîner de lundi" })
  ).toBeVisible();
  // Reflète le « restes » dans le cycle projeté (fixture non persistable, #257) :
  // hydraterCycle relira ce cycle local au prochain montage de /courses.
  await page.evaluate(
    (cp) => localStorage.setItem("cycle_planning", cp),
    JSON.stringify({
      semaine: ANCRE,
      jours: [{ jour: "lundi", diner: omelette, restes: { diner: true } }],
    })
  );

  // Les œufs ont disparu de la liste de courses (RG-22). Le SEUL repas étant en
  // restes, la liste devient vide → /courses passe en état VIDE (« Aucun repas
  // planifié sur ce cycle »), dont le lien de retour est « Aller au planning »
  // et non « ← Planning » (celui-ci n'existe qu'à l'état chargé). On revient donc
  // par la nav, robuste dans les deux états.
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: /œufs/ })).toHaveCount(0);
  await expect(page.getByText("Aucun repas planifié sur ce cycle")).toBeVisible();

  // « Cuisiner » restaure le repas → les œufs reviennent.
  await page.getByRole("navigation").getByRole("link", { name: "Planning" }).click();
  await page.waitForURL("**/planning");
  await carteLundi
    .getByRole("button", { name: "Cuisiner le dîner de lundi" })
    .click();
  await page.evaluate(
    (cp) => localStorage.setItem("cycle_planning", cp),
    JSON.stringify({ semaine: ANCRE, jours: [jourNormal] })
  );
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: /œufs/ })).toBeVisible();
});

// ---------------------------------------------------------------------------
// US-13 — synchronisation multi-device (#6). Le planning généré est persisté
// en base ; un device au cache vide le retrouve à l'hydratation.
// ---------------------------------------------------------------------------
test("le planning généré est resynchronisé depuis la base sur un device au cache vide (US-13)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const liste = page.locator("main ul");
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const planningGenere = await liste.innerText();

  // Attendre que l'écriture en base soit effective (drapeau dirty effacé).
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  // Simuler un autre device : l'addInitScript du beforeEach repurge le cache
  // local à chaque chargement → au reload, localStorage est vide et le planning
  // est réhydraté depuis la base.
  await page.reload();

  await expect(page.locator("main ul > li")).toHaveCount(7);
  await expect.poll(async () => liste.innerText()).toBe(planningGenere);
});

test("l'utilisateur peut remplacer un repas sans toucher au reste du planning", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);

  const carteLundi = jours.first();
  const carteMardi = jours.nth(1);
  const lundiAvant = await carteLundi.innerText();
  const mardiAvant = await carteMardi.innerText();

  await carteLundi
    .getByRole("button", { name: "Changer le dîner de lundi" })
    .click();

  // Confirmation utilisateur, puis : lundi a changé, mardi est intact.
  await expect(page.getByText("Recette remplacée")).toBeVisible();
  await expect
    .poll(async () => carteLundi.innerText())
    .not.toBe(lundiAvant);
  expect(await carteMardi.innerText()).toBe(mardiAvant);
});

// ---------------------------------------------------------------------------
// US-06 — sélection manuelle d'une recette (RG-15).
// Les assertions restent découplées du contenu de data/recettes.json : les
// noms de recettes sont lus dynamiquement dans le sélecteur (issue #29).
// ---------------------------------------------------------------------------

test("sélectionner manuellement une recette remplace le slot visé, le reste est intact", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  const jours = page.locator("main ul > li");
  await expect(jours).toHaveCount(7);

  const carteLundi = jours.first();
  const carteMardi = jours.nth(1);
  const mardiAvant = await carteMardi.innerText();

  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();

  // Le sélecteur s'ouvre, titré du slot visé, recherche en tête.
  const selecteur = page.getByRole("dialog");
  await expect(selecteur).toBeVisible();
  await expect(
    selecteur.getByRole("heading", { name: "Dîner de lundi" })
  ).toBeVisible();

  // Choix dynamique : la première recette de la liste (nom lu, pas codé en dur).
  const premiereRecette = selecteur.locator("ul button").first();
  const nomChoisi = (await premiereRecette.locator("span").first().innerText()).trim();
  await premiereRecette.click();

  // Sélecteur fermé, slot remplacé par la recette choisie, mardi intact.
  await expect(selecteur).not.toBeVisible();
  await expect(page.getByText("Recette remplacée")).toBeVisible();
  await expect(carteLundi).toContainText(nomChoisi);
  expect(await carteMardi.innerText()).toBe(mardiAvant);

  // Doublon éclairé (RG-15) : la recette posée sur lundi est signalée
  // quand on rouvre le sélecteur pour un autre slot.
  await carteMardi
    .getByRole("button", { name: "Sélectionner le dîner de mardi" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .locator("li", { hasText: nomChoisi })
      .getByText("déjà au planning")
  ).toBeVisible();
});

test("la recherche du sélecteur filtre la liste et gère l'absence de résultat", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);

  await page
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  const selecteur = page.getByRole("dialog");
  const lignes = selecteur.locator("ul button");
  const totalAvant = await lignes.count();
  expect(totalAvant).toBeGreaterThan(1);

  // Requête = nom complet de la dernière recette de la liste : le filtrage
  // doit réduire la liste et conserver cette recette.
  const nomCible = (
    await lignes.last().locator("span").first().innerText()
  ).trim();
  const recherche = selecteur.getByRole("searchbox", {
    name: "Rechercher une recette",
  });
  await recherche.fill(nomCible);

  await expect(selecteur.locator("ul button", { hasText: nomCible }).first()).toBeVisible();
  expect(await lignes.count()).toBeLessThan(totalAvant);

  // Aucun résultat → état vide explicite, pas de liste fantôme (RG-09).
  await recherche.fill("zzzzzzzz");
  await expect(selecteur.getByText(/^Aucune recette ne correspond à/)).toBeVisible();
  await expect(lignes).toHaveCount(0);
});

test("fermer le sélecteur avec Échap ne modifie pas le planning", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  // Attendre que le planning soit rendu avant de lire la carte (sinon innerText
  // peut courir avant l'apparition des cartes sur un backend distant lent).
  await expect(page.locator("main ul > li")).toHaveCount(7);
  const carteLundi = page.locator("main ul > li").first();
  const lundiAvant = await carteLundi.innerText();

  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await carteLundi.innerText()).toBe(lundiAvant);
});

test("une sélection manuelle conserve les coches de la liste de courses (RG-15/RG-12)", async ({
  page,
}) => {
  // Planning généré, puis un article coché côté courses.
  // Navigation par les LIENS de l'app (SPA) et non page.goto : un chargement
  // complet rejouerait l'init script du beforeEach, qui purge le planning.
  await page.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(page.locator("main ul > li")).toHaveCount(7);
  // Attendre la persistance : /courses projette le cycle depuis la BASE (#257),
  // pas depuis planning_courant local → sans ce flush, /courses hydrate un
  // backend encore vide (push débounce 800 ms) → liste vide → pas de coche.
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  const premierArticle = page.getByRole("checkbox").first();
  const nomArticle = await premierArticle.evaluate(
    (input) => input.closest("label")?.querySelector("span")?.textContent ?? ""
  );
  await premierArticle.click();
  await expect(page.getByRole("checkbox", { name: nomArticle }).first()).toBeChecked();

  // Sélection manuelle du dîner de lundi… en re-choisissant LA MÊME recette
  // (permis par RG-15) : les agrégats de la liste ne bougent pas, le test est
  // déterministe — on vérifie précisément l'absence de reset global (RG-13),
  // pas l'invalidation par quantité (couverte en unitaire, RG-12).
  await page.getByRole("link", { name: "← Planning" }).click();
  await page.waitForURL("**/planning");
  const carteLundi = page.locator("main ul > li").first();
  // Le nom du plat est désormais un bouton (ouvre la fiche, US-10) ; on lit
  // son libellé sans cliquer. La carte a 2 repas (déjeuner + dîner, #3) :
  // .last() vise le dîner (ordre slotsDuJour = déjeuner puis dîner).
  const nomRecetteLundi = (
    await carteLundi
      .getByRole("button", { name: /^Voir la recette/ })
      .last()
      .innerText()
  ).trim();
  await carteLundi
    .getByRole("button", { name: "Sélectionner le dîner de lundi" })
    .click();
  const selecteur = page.getByRole("dialog");
  await selecteur
    .getByRole("searchbox", { name: "Rechercher une recette" })
    .fill(nomRecetteLundi);
  await selecteur.locator("ul button", { hasText: nomRecetteLundi }).first().click();
  await expect(page.getByText("Recette remplacée")).toBeVisible();

  // La coche a survécu au remplacement (pas de réinitialisation, RG-13).
  await page.getByRole("link", { name: "Liste de courses →" }).click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("checkbox", { name: nomArticle }).first()).toBeChecked();
});
