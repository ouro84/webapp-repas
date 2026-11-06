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
// ✅ RESTAURÉ en PR2 (#259) : /courses re-câble le temps réel du planning côté
// CYCLE (lib/sync.ts → synchroniserAbonnementPlanningCycle : un abonnement par
// semaine ISO touchée par le cycle affiché). À réception d'un changement, la
// projection du cycle est re-pull et sa signature comparée → l'alerte US-21 se
// déclenche à nouveau « en magasin » (levée du test.fixme de PR1 #257).

import { test, expect } from "./fixtures";
import type { Browser, Page, WebSocket } from "@playwright/test";
import { nettoyerEtatDistant } from "./helpers";

// Ouvre une page authentifiée dans un contexte neuf (un « appareil »).
async function ouvrirAppareil(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  return context.newPage();
}

test.beforeEach(async ({ request }) => {
  await nettoyerEtatDistant(request);
});

test("un membre en magasin est alerté quand le planning change à la maison (US-21)", async ({
  browser,
}) => {
  // --- Appareil A : génère un planning puis part « en magasin » (courses) ---
  const a = await ouvrirAppareil(browser);
  // #357 : abonnement du cycle (`/courses`) confirmé par Supabase, pas une attente fixe.
  const abonnementCycleA = abonnementRealtimePret(a, "planning-cycle:");
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
  // Abonnement temps réel de A (côté courses) confirmé avant que B ne régénère.
  await abonnementCycleA;

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

// Résout quand Supabase Realtime confirme un abonnement `postgres_changes`
// (message `system` « ok ») sur un topic `realtime:<prefixe>…` :
//  - `planning:` = planning de la semaine (`/planning`, `planning:<foyer>:<semaine>`) ;
//  - `planning-cycle:` = planning du cycle (`/courses`, #259).
// À appeler AVANT `goto` : le WebSocket s'ouvre au chargement, et `page.on("websocket")`
// ne rejoue pas une connexion déjà ouverte. Signal réel plutôt qu'une attente fixe.
// Rejette après `delaiMs` avec un message qui nomme le protocole attendu, ou dès que
// la page se ferme avant le signal (#357 : sinon la promesse restait en suspens et
// l'appelant n'échouait qu'au timeout du test), et retire ses écouteurs (WebSocket
// et page) dès que le signal est reçu, le délai écoulé ou la page fermée.
function abonnementRealtimePret(
  page: Page,
  prefixe: "planning:" | "planning-cycle:",
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
      rejeter(
        new Error(
          `Page fermée avant la confirmation de l'abonnement temps réel « realtime:${prefixe} ».`
        )
      );
    };
    const minuteur = setTimeout(() => {
      nettoyer();
      rejeter(
        new Error(
          `Abonnement temps réel « realtime:${prefixe} » non confirmé après ${delaiMs} ms : ` +
            "trame attendue = message `system` avec `extension: postgres_changes` et " +
            "`status: ok` (serialiseur 2.0.0 de realtime-js : [join_ref, ref, topic, event, payload])."
        )
      );
    }, delaiMs);
    const surWebSocket = (ws: WebSocket) => {
      const surTrame = ({ payload }: { payload: string | Buffer }) => {
        if (typeof payload !== "string") return;
        try {
          type Charge = { extension?: string; status?: string };
          const brut: unknown = JSON.parse(payload);
          // Sérialiseur 2.0.0 de realtime-js : [join_ref, ref, topic, event, payload] ;
          // 1.0.0 : objet { topic, event, payload }.
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
  // Un rejet après la fin d'un test qui a échoué plus tôt ne doit pas planter le worker ;
  // l'appelant qui attend la promesse reçoit bien l'erreur.
  promesse.catch(() => {});
  return promesse;
}

// #355 : A a une édition en attente (son push a échoué, réseau coupé) quand B
// modifie un AUTRE créneau. La relecture US-21 de A rejoue son édition sur le
// planning de B au lieu de l'écraser, puis la repousse : les deux survivent.
// Pourquoi un push en échec et pas un push retardé : un `sauvegarder_planning`
// retardé (toute la semaine) partirait quand même avec l'ancien planning et
// écraserait en base le créneau de B, quoi que fasse le client ensuite.
test("une édition en attente survit à la modification d’un autre créneau par un autre membre (#355)", async ({
  browser,
}) => {
  const dirty = (p: Page) => p.evaluate(() => localStorage.getItem("planning_dirty"));

  // --- A génère le planning et attend sa persistance ---
  const a = await ouvrirAppareil(browser);
  const abonnementA = abonnementRealtimePret(a, "planning:");
  await a.goto("/planning");
  await a.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(a.locator("main ul > li")).toHaveCount(7);
  await expect.poll(() => dirty(a)).toBeNull();

  // --- B ouvre le même planning ---
  const b = await ouvrirAppareil(browser);
  await b.goto("/planning");
  await expect(b.locator("main ul > li")).toHaveCount(7);
  // Abonnement temps réel du planning de A confirmé par Supabase.
  await abonnementA;

  // --- A : stepper lundi dîner 2 → 3, push coupé (reste en attente) ---
  await a.route("**/rest/v1/rpc/sauvegarder_planning", (route) => route.abort());
  const pushEchoue = a.waitForEvent("requestfailed", (r) =>
    r.url().includes("/rpc/sauvegarder_planning")
  );
  const lundiA = a.locator("main ul > li").nth(0);
  await lundiA.getByRole("button", { name: "Plus de personnes pour le dîner de lundi" }).click();
  await expect(lundiA).toContainText("3 pers.");
  await pushEchoue;
  await a.unroute("**/rest/v1/rpc/sauvegarder_planning");
  expect(await dirty(a)).toBe("1");

  // --- B : stepper mardi déjeuner 2 → 1, poussé ---
  const mardiB = b.locator("main ul > li").nth(1);
  await mardiB.getByRole("button", { name: "Moins de personnes pour le déjeuner de mardi" }).click();
  await expect(mardiB).toContainText("1 pers.");
  await expect.poll(() => dirty(b)).toBeNull();

  // --- A : alerte, acquittement, les deux créneaux affichés ---
  const alerte = a.getByText(/le planning de la semaine vient d/i);
  await expect(alerte).toBeVisible({ timeout: 20_000 });
  await a.getByRole("button", { name: /OK, j.ai compris/ }).click();
  await expect(alerte).toHaveCount(0);
  await expect(lundiA).toContainText("3 pers.");
  const mardiA = a.locator("main ul > li").nth(1);
  await expect(mardiA).toContainText("1 pers.");

  // --- A repousse la fusion ; après rechargement, les deux persistent ---
  await expect.poll(() => dirty(a)).toBeNull();
  await a.reload();
  await expect(a.locator("main ul > li")).toHaveCount(7);
  await expect(a.locator("main ul > li").nth(0)).toContainText("3 pers.");
  await expect(a.locator("main ul > li").nth(1)).toContainText("1 pers.");

  await a.context().close();
  await b.context().close();
});
