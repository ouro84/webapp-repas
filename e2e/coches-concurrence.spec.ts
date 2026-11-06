// Coches concurrentes à deux appareils sur le moteur horodaté (#362 phase 2,
// RG-10, RG-32, RG-41).
//
// Deux « appareils » du même foyer (deux contextes navigateur, même session) :
// 1. A coche puis décoche « tomate » en moins de 300 ms pendant que B la coche.
//    Une fois les files vidées, A, B et la ligne `etat_courses_article` en base
//    disent la même chose (dernier commit gagnant sur `updated_at`), et rien ne
//    le défait ensuite (écho tardif, relecture périmée).
// 2. A, hors ligne, coche un article ajouté à la main : pas de toast, la coche
//    attend dans la file persistée (`coches_manuels_en_attente`) ; au retour du
//    réseau, elle part et B la voit cochée.
//
// Même préparation que coches-realtime.spec : planning injecté dans
// `cycle_planning` à l'ancre du jour de courses lundi (remis par
// `reinitialiserJourCoursesDistant`). Le planning étant injecté (jamais
// persisté), la recette à tomates peut être une fixture locale : la coche
// s'écrit sous la clé `tomate|piece`, sans lien avec le catalogue.
//
// Contextes en `reducedMotion: "reduce"` : `avecTransition` saute alors la View
// Transition, et un clic rapproché ne se perd pas sur le calque
// `::view-transition` (cf. e2e.md). Le sujet ici est la synchro, pas l'animation.

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { APIRequestContext, Browser, Page, WebSocket } from "@playwright/test";
import { recetteFixture } from "../tests/fixtures/recettes";
import { jetonTest, nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers";
import { semaineISO } from "../lib/semaines";
import { ancreParDefaut } from "../lib/cycles";
import type { Jour, Planning, Recette } from "../types";

const ANCRE_LUNDI = ancreParDefaut(new Date(), 1);
// Clé de coche d'un ingrédient = `nom (minuscules)|unité` (lib/courses.ts).
const CLE_TOMATE = "tomate|piece";
const ARTICLE_MANUEL = "Papier toilette";

// Recette locale : aucune fixture partagée ne contient de tomate.
const SALADE_DE_TOMATES: Recette = {
  id: "salade-de-tomates-e2e",
  nom: "Salade de tomates",
  tempsPreparation: "rapide",
  ingredients: [
    { nom: "tomate", quantite: 4, unite: "piece", categorie: "legumes-fruits", fondDePlacard: false },
    { nom: "huile d'olive", quantite: 1, unite: "cas", categorie: "epicerie", fondDePlacard: true },
  ],
};

function planningDeterministe(): Planning {
  const choisies = [
    recetteFixture("omelette-aux-champignons"),
    recetteFixture("tagliatelles-au-parmesan"),
    recetteFixture("quiche-aux-lardons"),
    SALADE_DE_TOMATES,
  ];
  const jours: Jour[] = ["lundi", "mardi", "mercredi", "jeudi"];
  return {
    semaine: semaineISO(),
    jours: choisies.map((recette, i) => ({ jour: jours[i]!, diner: recette })),
  };
}

// Résout quand le canal temps réel dont le topic commence par `realtime:<prefixe>`
// confirme son abonnement `postgres_changes` (même protocole que
// `abonnementRealtimePret` d'alerte-planning.spec : sérialiseur 2.0.0 de
// realtime-js, trames `[join_ref, ref, topic, event, payload]`). À poser AVANT
// le `goto`. Rejette après `delaiMs` ou si la page se ferme avant le signal.
function abonnementPret(
  page: Page,
  prefixe: "coches:" | "articles-manuels:",
  delaiMs = 30_000
): Promise<void> {
  const promesse = new Promise<void>((resoudre, rejeter) => {
    const ecouteurs: Array<() => void> = [];
    const nettoyer = () => {
      clearTimeout(minuteur);
      page.off("websocket", surWebSocket);
      page.off("close", surFermeture);
      for (const retirer of ecouteurs) retirer();
    };
    const surFermeture = () => {
      nettoyer();
      rejeter(new Error(`Page fermée avant l'abonnement temps réel « realtime:${prefixe} ».`));
    };
    const minuteur = setTimeout(() => {
      nettoyer();
      rejeter(
        new Error(
          `Abonnement temps réel « realtime:${prefixe} » non confirmé après ${delaiMs} ms ` +
            "(trame attendue : `system`, `extension: postgres_changes`, `status: ok`)."
        )
      );
    }, delaiMs);
    const surWebSocket = (ws: WebSocket) => {
      const surTrame = ({ payload }: { payload: string | Buffer }) => {
        if (typeof payload !== "string") return;
        try {
          type Charge = { extension?: string; status?: string };
          const brut: unknown = JSON.parse(payload);
          const [topic, event, charge] = Array.isArray(brut)
            ? [brut[2] as string, brut[3] as string, brut[4] as Charge]
            : [
                (brut as { topic?: string }).topic,
                (brut as { event?: string }).event,
                (brut as { payload?: Charge }).payload,
              ];
          if (
            topic?.startsWith(`realtime:${prefixe}`) &&
            event === "system" &&
            charge?.extension === "postgres_changes" &&
            charge.status === "ok"
          ) {
            nettoyer();
            resoudre();
          }
        } catch {
          // Trame non JSON (heartbeat binaire, etc.) : ignorée.
        }
      };
      ws.on("framereceived", surTrame);
      ecouteurs.push(() => ws.off("framereceived", surTrame));
    };
    page.on("websocket", surWebSocket);
    page.on("close", surFermeture);
  });
  promesse.catch(() => {});
  return promesse;
}

// Gardes anti-crash des pages créées à la main (cf. e2e/fixtures.ts).
const gardesCrash: { erreurs: string[] }[] = [];
test.afterEach(() => {
  const erreurs = gardesCrash.flatMap((g) => g.erreurs);
  gardesCrash.length = 0;
  expect(erreurs, `Crash React détecté : ${erreurs.join(" | ")}`).toEqual([]);
});

// Ouvre /courses dans un contexte neuf (même session) avec le planning injecté
// et les clés de synchro purgées, puis attend la liste rendue et les deux
// abonnements temps réel (coches d'ingrédients, articles manuels) confirmés.
async function ouvrirCourses(browser: Browser, planning: Planning): Promise<Page> {
  const context = await browser.newContext({
    storageState: "e2e/.auth/user.json",
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ([cyclePlanningJSON, cycleAfficheJSON]) => {
      for (const c of [
        "planning_courant_maj",
        "planning_dirty",
        "planning_confirme",
        "planning_a_relire",
        "courses_cochees",
        "courses_cochees_maj",
        "coches_en_attente",
        "coches_maj",
        "coches_manuels_en_attente",
        "coches_manuels_maj",
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
  gardesCrash.push(attacherGardeCrash(page));
  const coches = abonnementPret(page, "coches:");
  const articles = abonnementPret(page, "articles-manuels:");
  await page.goto("/courses");
  await expect(page.getByRole("checkbox", { name: /tomate/ })).toBeVisible();
  await Promise.all([coches, articles]);
  return page;
}

// File du moteur vide : plus aucune écriture de coche en attente ni en vol.
async function attendreFileVide(page: Page, cle: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((c) => localStorage.getItem(c), cle), { timeout: 20_000 })
    .toBeNull();
}

// `coche` de la ligne en base (ligne absente = décochée).
async function cocheEnBase(
  request: APIRequestContext,
  session: { url: string; headers: Record<string, string> },
  chemin: string
): Promise<boolean> {
  const reponse = await request.get(`${session.url}/rest/v1/${chemin}`, {
    headers: session.headers,
  });
  if (!reponse.ok()) throw new Error(`Lecture REST impossible : HTTP ${reponse.status()}`);
  const lignes = (await reponse.json()) as { coche: boolean }[];
  return lignes[0]?.coche ?? false;
}

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
  await reinitialiserJourCoursesDistant(request);
});

test.afterAll(async ({ request }) => {
  // Articles manuels et coches laissés par ces tests : le compte est partagé.
  await nettoyerEtatDistant(request);
});

test("coche et décoche concurrentes du même article : A, B et la base finissent d'accord (#362)", async ({
  browser,
  request,
}) => {
  const session = await jetonTest(request);
  const cheminTomate =
    `etat_courses_article?ancre=eq.${ANCRE_LUNDI}` +
    `&cle=eq.${encodeURIComponent(CLE_TOMATE)}&select=coche`;
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);
  try {
    const tomateA = deviceA.getByRole("checkbox", { name: /tomate/ });
    const tomateB = deviceB.getByRole("checkbox", { name: /tomate/ });

    // A coche puis décoche en moins de 300 ms, B coche en même temps. Le délai
    // fixe est le sujet du test (deux gestes rapprochés), pas une attente d'état.
    await Promise.all([
      (async () => {
        await tomateA.click();
        await deviceA.waitForTimeout(100);
        await tomateA.click();
      })(),
      tomateB.click(),
    ]);

    // Stabilisation : files vidées des deux côtés (toutes les écritures
    // commitées), puis même état chez A, chez B et en base.
    await attendreFileVide(deviceA, "coches_en_attente");
    await attendreFileVide(deviceB, "coches_en_attente");
    const lireEtats = async () => ({
      a: await tomateA.isChecked(),
      b: await tomateB.isChecked(),
      base: await cocheEnBase(request, session, cheminTomate),
    });
    let final = false;
    await expect(async () => {
      const { a, b, base } = await lireEtats();
      expect({ a, b }).toEqual({ a: base, b: base });
      final = base;
    }).toPass({ timeout: 20_000 });

    // Et rien ne défait la convergence ensuite (écho tardif, relecture
    // périmée) : l'état reste le même sur quelques secondes.
    for (let i = 0; i < 4; i += 1) {
      await deviceA.waitForTimeout(750);
      expect(await lireEtats()).toEqual({ a: final, b: final, base: final });
    }
  } finally {
    await deviceA.context().close();
    await deviceB.context().close();
  }
});

test("coche d'un article manuel hors ligne : pas de toast, enregistrée au retour du réseau (#362)", async ({
  browser,
  request,
}) => {
  const session = await jetonTest(request);
  const cheminArticle =
    `article_manuel?ancre=eq.${ANCRE_LUNDI}` +
    `&libelle=eq.${encodeURIComponent(ARTICLE_MANUEL)}&select=coche`;
  const planning = planningDeterministe();
  const deviceA = await ouvrirCourses(browser, planning);
  const deviceB = await ouvrirCourses(browser, planning);
  try {
    const nom = new RegExp(ARTICLE_MANUEL);
    // Article ajouté par A, en ligne ; B le voit arriver par le temps réel.
    await deviceA.getByRole("button", { name: "Ajouter un article" }).click();
    await deviceA.getByLabel("Article", { exact: true }).fill(ARTICLE_MANUEL);
    await deviceA.getByRole("button", { name: "Enregistrer" }).click();
    await expect(deviceA.getByRole("checkbox", { name: nom })).toBeVisible();
    await expect(deviceB.getByRole("checkbox", { name: nom })).toBeVisible({ timeout: 15_000 });
    // Toasts de l'ajout éventuels disparus avant de vérifier l'absence de toast.
    await expect(deviceA.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });

    // A hors ligne coche l'article : coché à l'écran, mis en file, sans toast.
    await deviceA.context().setOffline(true);
    await deviceA.getByRole("checkbox", { name: nom }).click();
    await expect(deviceA.getByRole("checkbox", { name: nom })).toBeChecked();
    await expect
      .poll(() => deviceA.evaluate(() => localStorage.getItem("coches_manuels_en_attente")))
      .not.toBeNull();
    await expect(deviceA.locator("[data-sonner-toast]")).toHaveCount(0);
    expect(await cocheEnBase(request, session, cheminArticle)).toBe(false);
    await expect(deviceB.getByRole("checkbox", { name: nom })).not.toBeChecked();

    // Retour du réseau : la file est rejouée, la base et B suivent.
    await deviceA.context().setOffline(false);
    await attendreFileVide(deviceA, "coches_manuels_en_attente");
    await expect.poll(() => cocheEnBase(request, session, cheminArticle)).toBe(true);
    await expect(deviceB.getByRole("checkbox", { name: nom })).toBeChecked({ timeout: 15_000 });
    await expect(deviceA.getByRole("checkbox", { name: nom })).toBeChecked();
    await expect(deviceA.locator("[data-sonner-toast]")).toHaveCount(0);
  } finally {
    await deviceA.context().close();
    await deviceB.context().close();
  }
});
