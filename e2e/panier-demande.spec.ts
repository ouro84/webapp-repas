// Parcours #308 (US-53, RG-80→84) — socle de la demande de panier, de bout en
// bout : bouton (route POST /api/panier/demande, session à cookies) → webhook
// signé vers l'exécuteur du foyer → outils MCP prendre_demande_panier et
// rapporter_panier joués par un « exécuteur » (jeton OAuth) → état lu par
// etat_panier.
//
// L'exécuteur est un récepteur HTTP local (127.0.0.1, port libre) dans le
// process Playwright : le serveur Next local lui POSTe le webhook. Il note
// chaque requête et répond 202 ou 500 selon le mode réglé par le test.
//
// ⚠️ Comptes JETABLES (email unique par run), clients DCR créés sur staging.
// L'exécuteur s'enregistre et le temps se « recule » en service_role
// (SUPABASE_SERVICE_ROLE_KEY de .env.local, swappé sur staging par le runner) :
// les clients n'ont aucune écriture sur ces tables.
// #320 : le panier vise le cycle AFFICHÉ (courant ou à venir), la base refuse un
// cycle terminé (OMQ04, RG-81) et `etat_panier(p_ancre)` isole le rapport par cycle.
// Prérequis staging : migrations 20261031120000_demande_panier et
// 20261101120000_panier_multi_cycle appliquées,
// OAuth Server + DCR, site_url = http://localhost:3000.

import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from "@playwright/test";
import { test, expect } from "./fixtures";
import { appelerOutilMcp, autoriser, connecter, inscrire, jetonMotDePasse } from "./oauth";
import {
  demandesPanierActives,
  deplacerDemandePanier,
  enregistrerExecuteurPanier,
  lireEnvLocal,
  supprimerDemandesPanier,
  supprimerExecuteurPanier,
  vieillirDemandePanier,
} from "./helpers";
import { MESSAGE_INJOIGNABLE, MESSAGES_PANIER } from "../lib/panier";
import { cycleDecale, joursDuCycle } from "../lib/cycles";

const RUN = Date.now();
const EMAIL_A = `claude-e2e-panier-a-${RUN}@example.com`;
const EMAIL_B = `claude-e2e-panier-b-${RUN}@example.com`;
const CORPS_WEBHOOK = '{"evenement":"demande_panier"}';
// Secret au format Standard Webhooks : la clé HMAC est le base64 décodé (RG-81).
const SECRET = `whsec_${randomBytes(32).toString("base64")}`;

// Message de la carte quand l'exécuteur ne répond pas (RG-81), sans le motif
// technique (« réponse HTTP 500 ») qui reste en base.
const MESSAGE_CARTE_INJOIGNABLE = "Ton exécuteur n’a pas répondu. Vérifie qu’il est allumé, puis réessaie.";

const RAPPORT = {
  ajoutes: [{ article: "lait", produit: "Lait demi-écrémé 1 L", marque: "Lactel", quantite: 2 }],
  a_choisir: [{ article: "farine", raison: "plusieurs formats", candidats: ["T45 1 kg", "T55 1 kg"] }],
  introuvables: [{ article: "estragon" }],
};

test.describe.configure({ mode: "serial" });

// --- Exécuteur factice ---

type RequeteRecue = { headers: IncomingHttpHeaders; corps: string };
const recues: RequeteRecue[] = [];
let modeReponse: 202 | 500 = 202;
let serveur: Server;

// --- Comptes : A (foyer avec exécuteur), B (autre foyer) ---

let pageA: Page;
let pageB: Page;
let jetonA = "";
let jetonB = "";
let foyerA = "";
const contextes: BrowserContext[] = [];

async function demarrerRecepteur(): Promise<string> {
  serveur = createServer((req, res) => {
    let corps = "";
    req.setEncoding("utf8");
    req.on("data", (morceau: string) => (corps += morceau));
    req.on("end", () => {
      recues.push({ headers: req.headers, corps });
      res.writeHead(modeReponse, { "content-type": "application/json" });
      res.end(modeReponse === 202 ? '{"ok":true}' : '{"erreur":"panne simulée"}');
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/webhook`;
}

// Vérification Standard Webhooks, comme Hermes (et envoyer-webhook.mjs du spike).
function signatureAttendue(id: string, horodatage: string, corps: string): string {
  const cle = SECRET.startsWith("whsec_") ? Buffer.from(SECRET.slice(6), "base64") : Buffer.from(SECRET);
  return `v1,${createHmac("sha256", cle).update(`${id}.${horodatage}.${corps}`).digest("base64")}`;
}

// Un seul login par mot de passe et par compte, réutilisé par les lectures
// REST : l'Auth de staging limite les connexions (429 en CI avec 4 workers).
const sessions = new Map<string, string>();

async function sessionDe(request: APIRequestContext, email: string): Promise<string> {
  let jeton = sessions.get(email);
  if (!jeton) {
    jeton = await jetonMotDePasse(request, email);
    sessions.set(email, jeton);
  }
  return jeton;
}

async function foyerDe(request: APIRequestContext, email: string): Promise<string> {
  const jeton = await sessionDe(request, email);
  const r = await request.get(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/profiles?select=foyer_id`, {
    headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), Authorization: `Bearer ${jeton}` },
  });
  expect(r.ok()).toBe(true);
  const [{ foyer_id }] = (await r.json()) as Array<{ foyer_id: string }>;
  expect(foyer_id).toBeTruthy();
  return foyer_id;
}

type Derniere = {
  id: string;
  ancre: string;
  statut: string;
  cause_echec: string | null;
  motif_echec: string | null;
  rapport: unknown;
  rapport_tardif: boolean;
} | null;

async function etatPanier(
  request: APIRequestContext,
  email: string,
  ancre?: string
): Promise<{ executeur: boolean; derniere: Derniere; active: Derniere }> {
  const jeton = await sessionDe(request, email);
  const r = await request.post(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/etat_panier`, {
    headers: {
      apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
    },
    data: ancre ? { p_ancre: ancre } : {},
  });
  expect(r.ok()).toBe(true);
  return r.json();
}

// Une demande précise, lue sous RLS (lecture seule pour le foyer).
async function lireDemande(request: APIRequestContext, email: string, id: string): Promise<Derniere> {
  const jeton = await sessionDe(request, email);
  const r = await request.get(
    `${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/demande_panier?id=eq.${id}&select=id,ancre,statut,cause_echec,motif_echec,rapport,rapport_tardif`,
    { headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), Authorization: `Bearer ${jeton}` } }
  );
  expect(r.ok()).toBe(true);
  const lignes = (await r.json()) as Derniere[];
  return lignes[0] ?? null;
}

// Le « clic » : la route avec la session à cookies du compte A. Le statut et
// le corps brut sont dans l'erreur si la réponse n'est pas du JSON (page
// d'erreur Next, proxy), plutôt qu'un « Unexpected token » muet.
async function demander(corps?: { ancre: string }): Promise<{ statut: number; corps: { demande_id?: string; error?: string } }> {
  const r = await pageA.request.post("/api/panier/demande", corps ? { data: corps } : undefined);
  const statut = r.status();
  const brut = await r.text();
  try {
    return { statut, corps: JSON.parse(brut) };
  } catch {
    throw new Error(`POST /api/panier/demande : HTTP ${statut}, corps non JSON : ${brut.slice(0, 500)}`);
  }
}

async function demanderOk(ancre?: string): Promise<string> {
  const { statut, corps } = await demander(ancre ? { ancre } : undefined);
  expect(statut).toBe(202);
  expect(corps.demande_id).toBeTruthy();
  return corps.demande_id!;
}

function texte(appel: Awaited<ReturnType<typeof appelerOutilMcp>>): string {
  return appel.resultat?.content.map((c) => c.text).join("") ?? "";
}

async function prendre(request: APIRequestContext, jeton: string) {
  const appel = await appelerOutilMcp(request, jeton, "prendre_demande_panier");
  expect(appel.statut).toBe(200);
  expect(appel.resultat?.isError).toBeFalsy();
  return appel.resultat!.structuredContent as { demande: { id: string; ancre: string } | null };
}

function rapporter(request: APIRequestContext, jeton: string, demandeId: string, statut = "terminee", motif?: string) {
  return appelerOutilMcp(request, jeton, "rapporter_panier", {
    demande_id: demandeId,
    statut,
    ...(motif ? { motif } : {}),
    ...RAPPORT,
  });
}

/** Une demande prise puis rapportée « terminee » ; renvoie son id et son ancre. */
async function demandeTerminee(request: APIRequestContext): Promise<{ id: string; ancre: string }> {
  const id = await demanderOk();
  const { demande } = await prendre(request, jetonA);
  expect(demande?.id).toBe(id);
  expect((await rapporter(request, jetonA, id)).resultat?.isError).toBeFalsy();
  return { id, ancre: demande!.ancre };
}

/**
 * Déplace la demande sur le cycle SUIVANT et y génère un planning (sans liste,
 * la carte n'est pas montée). Renvoie l'ancre du cycle suivant.
 */
async function demandeDuCycleSuivant(request: APIRequestContext, demande: { id: string; ancre: string }): Promise<string> {
  const suivant = cycleDecale(demande.ancre, 1);
  await deplacerDemandePanier(request, demande.id, suivant);
  const generation = await appelerOutilMcp(request, jetonA, "generer_cycle", { ancre: suivant, remplacer: true });
  expect(generation.resultat?.isError).toBeFalsy();
  return suivant;
}

test.beforeAll(async ({ browser, request }) => {
  const urlWebhook = await demarrerRecepteur();
  await Promise.all([inscrire(request, EMAIL_A), inscrire(request, EMAIL_B)]);

  for (const email of [EMAIL_A, EMAIL_B]) {
    const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    contextes.push(contexte);
    const page = await contexte.newPage();
    await connecter(page, email);
    const { access_token } = await autoriser(page, request, `E2E OMQ panier ${email === EMAIL_A ? "A" : "B"} ${RUN}`);
    if (email === EMAIL_A) {
      pageA = page;
      jetonA = access_token;
    } else {
      pageB = page;
      jetonB = access_token;
    }
  }

  // Un planning sur le cycle courant pour chaque compte : sans lui, /courses
  // montre l’état vide et la carte n’est jamais montée (le test « aucun
  // exécuteur » passerait alors à vide).
  for (const jeton of [jetonA, jetonB]) {
    const generation = await appelerOutilMcp(request, jeton, "generer_cycle");
    expect(generation.resultat?.isError).toBeFalsy();
  }

  foyerA = await foyerDe(request, EMAIL_A);
  await enregistrerExecuteurPanier(request, foyerA, urlWebhook, SECRET);
});

test.beforeEach(() => {
  modeReponse = 202;
  recues.length = 0;
});

// Chaque test repart sans demande active : celles qui restent sont reculées
// au-delà des délais d'expiration (RG-83), clôturées au prochain appel de RPC.
test.afterEach(async ({ request }) => {
  // beforeAll en échec : rien à nettoyer, et ne pas masquer sa vraie erreur.
  if (!foyerA) return;
  for (const { id, statut } of await demandesPanierActives(request, foyerA)) {
    await vieillirDemandePanier(request, id, statut === "en_attente" ? "cree_le" : "pris_le", 60);
  }
});

test.afterAll(async ({ request }) => {
  await Promise.all(contextes.splice(0).map((c) => c.close()));
  if (serveur) {
    // Le fetch de Next garde ses connexions ouvertes (keep-alive) : les couper,
    // sinon close() attend leur expiration.
    serveur.closeAllConnections();
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
  // beforeAll en échec : rien à nettoyer, et ne pas masquer sa vraie erreur.
  if (!foyerA) return;
  // Supprimer l'exécuteur nettoie staging et exerce le trigger qui supprime
  // son secret Vault.
  expect(await supprimerExecuteurPanier(request, foyerA)).toBe(0);
});

// --- Carte « Panier Chronodrive » sur /courses (#308, US-53) ---

function carteDe(page: Page): Locator {
  return page.getByRole("region", { name: "Panier Chronodrive" });
}

// /courses dans son état CHARGÉ, carte rendue. La carte n'est montée que dans
// l'état chargé (le compteur « n coché(s) sur m » n'existe qu'avec une liste) ;
// elle lit seulement `etat_panier` (ancre du cycle affiché), la page lit le jour
// de courses du foyer (`foyers?select=jour_courses`) pour savoir quel cycle
// afficher. On attend donc la liste, la réception COMPLÈTE de l'état du panier
// et des lectures du jour de courses (corps compris : `waitForResponse` résout
// dès les en-têtes), puis deux frames pour laisser React rendre. Après ce
// helper, la présence ou l'absence de la carte se lit sans attente : c'est ce
// qui rend l'assertion d'absence probante.
async function ouvrirCourses(page: Page): Promise<void> {
  const lecturesJour: Request[] = [];
  const noterLecture = (req: Request) => {
    if (req.url().includes("/rest/v1/foyers") && req.url().includes("jour_courses")) lecturesJour.push(req);
  };
  page.on("request", noterLecture);
  try {
    const etatLu = page.waitForResponse((r) => r.url().includes("/rpc/etat_panier"), { timeout: 30_000 });
    await page.goto("/courses");
    await expect(page.getByText(/^\d+ cochés? sur \d+/)).toBeVisible();
    const reponseEtat = await etatLu;
    expect(reponseEtat.ok()).toBe(true);
    await reponseEtat.finished();
    // La page a lu le jour de courses avant de choisir le cycle (donc avant de
    // monter la carte) : au moins une lecture est partie, on attend leur corps.
    expect(lecturesJour.length).toBeGreaterThan(0);
    for (const req of lecturesJour) {
      const reponse = await req.response();
      expect(reponse?.ok()).toBe(true);
      await reponse!.finished();
    }
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  } finally {
    page.off("request", noterLecture);
  }
}

// Captures de contrôle visuel, HORS CI : `CAPTURES_PANIER=<dossier absolu hors
// du dépôt>` active le test et donne le dossier de sortie (jamais
// test-results/, publié en CI). Le test crée l'état dont il a besoin (aucune
// demande au départ) et nettoie derrière lui : il ne dépend pas de l'ordre.
const CAPTURES_PANIER = process.env.CAPTURES_PANIER ?? "";
const FORMATS = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
] as const;

/** Dossier de sortie validé : absolu et hors du dépôt, sinon refusé. */
function dossierCaptures(): string {
  if (!isAbsolute(CAPTURES_PANIER)) {
    throw new Error(`CAPTURES_PANIER doit être un chemin absolu : « ${CAPTURES_PANIER} »`);
  }
  const depuisDepot = relative(process.cwd(), resolve(CAPTURES_PANIER));
  if (!depuisDepot.startsWith("..") && !isAbsolute(depuisDepot)) {
    throw new Error(`CAPTURES_PANIER ne doit pas être dans le dépôt : « ${CAPTURES_PANIER} »`);
  }
  return CAPTURES_PANIER;
}

/**
 * Ramène la page sur le cycle courant par le relais `?ancre=` (#279) : le
 * cycle affiché est mémorisé (localStorage), et un rechargement montrerait
 * d'abord le cycle suivant, le temps de l'hydratation.
 */
async function revenirAuCycle(page: Page, ancre: string): Promise<void> {
  await page.goto(`/courses?ancre=${ancre}`);
  await expect(page).toHaveURL(/\/courses$/);
  await expect(
    carteDe(page).getByRole("button", { name: /^(Remplir mon panier|Compléter mon panier|Panier en cours…)$/ })
  ).toBeVisible();
}

async function capturer(
  dossier: string,
  etat: string,
  attendre: (carte: Locator) => Promise<void>
): Promise<void> {
  for (const taille of FORMATS) {
    for (const theme of ["light", "dark"] as const) {
      await pageA.setViewportSize(taille);
      // Le thème par défaut est « système » : il suit prefers-color-scheme.
      await pageA.emulateMedia({ colorScheme: theme });
      await ouvrirCourses(pageA);
      const carte = carteDe(pageA);
      await attendre(carte);
      // Aucun débordement horizontal, même à 320 px.
      expect(await pageA.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(taille.width);
      // Le bouton, s'il existe, tient sur une ligne (libellé non tronqué).
      const boutons = carte.getByRole("button", { name: /panier/i });
      if ((await boutons.count()) > 0) {
        // Le contenu (spinner compris, ou la place qu'il prendra pendant
        // l'envoi : 14 px + 6 px d'écart sous `sm:`) tient dans la pilule, sans
        // retour à la ligne. Mesure par Range : `scrollWidth` compterait la
        // zone tactile `after:-inset-1`.
        const mesure = await boutons.first().evaluate((b) => {
          const plage = document.createRange();
          plage.selectNodeContents(b);
          const style = getComputedStyle(b);
          const spinner = b.querySelector("svg") ? 0 : 20;
          return {
            contenu: Math.ceil(plage.getBoundingClientRect().width) + spinner,
            disponible: b.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            hauteur: Math.round(b.getBoundingClientRect().height),
          };
        });
        expect(
          mesure.contenu <= mesure.disponible && mesure.hauteur < 50,
          `bouton sur une ligne (${etat}, ${taille.width} px) : ${JSON.stringify(mesure)}`
        ).toBe(true);
      }
      await carte.screenshot({
        path: join(dossier, `${etat}-${taille.width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
}

test("captures de la carte (hors CI, CAPTURES_PANIER)", async ({ request }) => {
  test.skip(!CAPTURES_PANIER, "contrôle visuel manuel : CAPTURES_PANIER=<dossier>");
  test.setTimeout(480_000);
  const dossier = dossierCaptures();
  await supprimerDemandesPanier(request, foyerA);
  let courant = "";
  try {
    await capturer(dossier, "disponible", async (carte) => {
      await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();
    });

    // Vraiment `en_cours` : prise par l'exécuteur.
    const enCours = await demanderOk();
    const prise = (await prendre(request, jetonA)).demande;
    expect(prise?.id).toBe(enCours);
    courant = prise!.ancre;
    await capturer(dossier, "en-cours", async (carte) => {
      await expect(carte.getByRole("button", { name: "Panier en cours…" })).toBeDisabled();
    });

    expect((await rapporter(request, jetonA, enCours)).resultat?.isError).toBeFalsy();
    await capturer(dossier, "rapport", async (carte) => {
      await expect(carte.getByText("1 ajouté · 1 à choisir · 1 introuvable")).toBeVisible();
      // Aucun article coché : « Remplir », pas « Compléter » (RG-83).
      await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();
    });
    await capturer(dossier, "rapport-deplie", async (carte) => {
      await carte.getByText("Ajoutés au panier").click();
      await expect(carte.getByText("Lait demi-écrémé 1 L · Lactel × 2")).toBeVisible();
    });

    modeReponse = 500;
    expect((await demander()).statut).toBe(502);
    modeReponse = 202;
    await capturer(dossier, "echec", async (carte) => {
      await expect(carte.getByText(MESSAGE_CARTE_INJOIGNABLE)).toBeVisible();
    });

    // Échec rapporté par l'exécuteur, avec ce qu'il a ajouté avant la panne.
    const partielle = await demanderOk();
    expect((await prendre(request, jetonA)).demande?.id).toBe(partielle);
    const motif = "Session Chronodrive expirée, connexion impossible.";
    expect((await rapporter(request, jetonA, partielle, "echec", motif)).resultat?.isError).toBeFalsy();
    await capturer(dossier, "echec-rapport-partiel", async (carte) => {
      await expect(carte.getByText(`Ton exécuteur a signalé un problème : ${motif}`)).toBeVisible();
      await expect(carte.getByText("1 ajouté · 1 à choisir · 1 introuvable")).toBeVisible();
    });

    // Cycle terminé (#320) : bouton grisé, motif sous le bouton.
    const { ancre: actuelle } = await demandeTerminee(request);
    courant = actuelle;
    const passe = cycleDecale(actuelle, -2);
    expect(
      (await appelerOutilMcp(request, jetonA, "generer_cycle", { ancre: passe, remplacer: true })).resultat?.isError
    ).toBeFalsy();
    await capturer(dossier, "cycle-termine", async (carte) => {
      await pageA.goto(`/courses?ancre=${passe}`);
      await expect(carte.getByText(MESSAGES_PANIER.OMQ04)).toBeVisible();
      await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toHaveAttribute("aria-disabled", "true");
    });

    // « Compléter » (#320) : compte-rendu sur ce cycle et un article coché. Un
    // clic pendant la View Transition de la liste se perd : on clique jusqu'à
    // observer le nombre de coches attendu (cf. e2e.md).
    await revenirAuCycle(pageA, actuelle);
    const cochees = pageA.getByTestId("categories-courses").getByRole("checkbox", { checked: true });
    const cocherJusqua = async (coches: number) => {
      await expect(async () => {
        if ((await cochees.count()) !== coches) {
          const cible = coches > 0
            ? pageA.getByTestId("categories-courses").getByRole("checkbox", { checked: false })
            : cochees;
          await cible.first().click({ timeout: 2_000 });
        }
        await expect(cochees).toHaveCount(coches, { timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    };
    try {
      await cocherJusqua(1);
      await capturer(dossier, "completer", async (carte) => {
        await expect(carte.getByRole("button", { name: "Compléter mon panier" })).toBeEnabled();
      });
    } finally {
      await revenirAuCycle(pageA, actuelle);
      await cocherJusqua(0);
    }

    const suivant = await demandeDuCycleSuivant(request, await demandeTerminee(request));
    await capturer(dossier, "cycle-suivant", async (carte) => {
      // Relais `?ancre=` plutôt que « Cycle suivant » : un clic pendant
      // l'hydratation d'un rechargement partirait du cycle mémorisé.
      await pageA.goto(`/courses?ancre=${suivant}`);
      await expect(carte.getByText("1 ajouté · 1 à choisir · 1 introuvable")).toBeVisible();
      await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();
    });
  } finally {
    modeReponse = 202;
    if (courant) await revenirAuCycle(pageA, courant);
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageA.emulateMedia({ colorScheme: null });
    // Les demandes actives sont d'abord vieillies par afterEach ; ici, on
    // repart d'un foyer sans historique pour les tests suivants.
    await supprimerDemandesPanier(request, foyerA);
  }
});

test("clic → webhook signé reçu, corps sans donnée (RG-81)", async () => {
  const debut = Math.floor(Date.now() / 1000);
  await demanderOk();

  expect(recues).toHaveLength(1);
  const [{ headers, corps }] = recues;
  // Aucune donnée métier dans le corps, octet pour octet (RG-80, RG-81).
  expect(corps).toBe(CORPS_WEBHOOK);
  expect(headers["content-type"]).toBe("application/json");
  const id = headers["webhook-id"] as string;
  const horodatage = headers["webhook-timestamp"] as string;
  expect(id).toMatch(/^msg_[0-9a-f-]{36}$/);
  expect(Math.abs(Number(horodatage) - debut)).toBeLessThan(300);
  // Signature calculée dans Postgres, vérifiée ici en Node avec le secret.
  expect(headers["webhook-signature"]).toBe(signatureAttendue(id, horodatage, corps));
});

// L'index unique partiel est la garantie « une seule demande active ». Le
// verrou consultatif par foyer sérialise les deux créations : la seconde voit
// la première par le contrôle préalable (message OMQ02 propre). La branche
// `unique_violation` n'est donc pas exercée ici : la provoquer exigerait de
// contourner le verrou, ce qui ne se fait pas de façon fiable en e2e.
test("deux créations concurrentes → une 202, une 409 (RG-83)", async () => {
  const resultats = await Promise.all([demander(), demander()]);
  expect(resultats.map((r) => r.statut).sort()).toEqual([202, 409]);
  expect(resultats.find((r) => r.statut === 409)!.corps.error).toBe(MESSAGES_PANIER.OMQ02);
  // Un seul webhook : la demande refusée n'a rien envoyé.
  expect(recues).toHaveLength(1);
});

test("prendre puis rapporter → terminee, rapport lu par etat_panier (RG-84)", async ({ request }) => {
  const demandeId = await demanderOk();

  const { demande } = await prendre(request, jetonA);
  expect(demande?.id).toBe(demandeId);
  expect(demande?.ancre).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const rapport = await rapporter(request, jetonA, demandeId);
  expect(rapport.resultat?.isError).toBeFalsy();
  expect(rapport.resultat?.structuredContent).toEqual({ statut: "terminee", rapport_tardif: false });

  const etat = await etatPanier(request, EMAIL_A);
  expect(etat.executeur).toBe(true);
  expect(etat.derniere).toMatchObject({
    id: demandeId,
    ancre: demande!.ancre,
    statut: "terminee",
    cause_echec: null,
    rapport: RAPPORT,
    rapport_tardif: false,
  });

  // Un second rapport sur une demande close est refusé (OMQ03).
  const doublon = await rapporter(request, jetonA, demandeId);
  expect(doublon.resultat?.isError).toBe(true);
  expect(texte(doublon)).toBe(MESSAGES_PANIER.OMQ03);
});

test("prendre sans demande → { demande: null } (RG-81)", async ({ request }) => {
  expect(await prendre(request, jetonA)).toEqual({ demande: null });
});

test("exécuteur en 500 → 502, demande echec/injoignable, nouvelle demande possible (RG-81)", async ({ request }) => {
  modeReponse = 500;
  const { statut, corps } = await demander();
  expect(statut).toBe(502);
  expect(corps.error).toBe(MESSAGE_INJOIGNABLE);
  expect(recues).toHaveLength(1);

  // Motif lisible par le foyer (§5.8), pas la cause brute.
  const { derniere } = await etatPanier(request, EMAIL_A);
  expect(derniere).toMatchObject({ statut: "echec", cause_echec: "injoignable", motif_echec: "réponse HTTP 500" });

  modeReponse = 202;
  const nouvelle = await demanderOk();
  expect(nouvelle).not.toBe(derniere!.id);
  expect(recues).toHaveLength(2);
});

test("rapport en échec → echec/executeur avec le motif de l'exécuteur (RG-84)", async ({ request }) => {
  const demandeId = await demanderOk();
  expect((await prendre(request, jetonA)).demande?.id).toBe(demandeId);

  const motif = "Session Chronodrive expirée, connexion impossible.";
  const rapport = await rapporter(request, jetonA, demandeId, "echec", motif);
  expect(rapport.resultat?.isError).toBeFalsy();
  expect(rapport.resultat?.structuredContent).toEqual({ statut: "echec", rapport_tardif: false });
  expect(await lireDemande(request, EMAIL_A, demandeId)).toMatchObject({
    statut: "echec",
    cause_echec: "executeur",
    motif_echec: motif,
    rapport: RAPPORT,
  });
});

test("en_attente vieillie de 6 min → echec/non_prise à la lecture (RG-83)", async ({ request }) => {
  const demandeId = await demanderOk();
  await vieillirDemandePanier(request, demandeId, "cree_le", 6);

  // La lecture de l'état déclenche l'expiration paresseuse. Reculer `cree_le`
  // la rend plus ancienne que les demandes des tests précédents : on la relit
  // donc par son id plutôt que par `etat_panier.derniere`.
  await etatPanier(request, EMAIL_A);
  expect(await lireDemande(request, EMAIL_A, demandeId)).toMatchObject({ statut: "echec", cause_echec: "non_prise" });
  // Expirée, elle ne se prend plus.
  expect(await prendre(request, jetonA)).toEqual({ demande: null });
});

test("rapport tardif : accepté sans demande plus récente, refusé après une nouvelle demande (RG-83)", async ({
  request,
}) => {
  // 1. Run trop long, mais aucune demande plus récente : accepté, marqué tardif.
  const premiere = await demanderOk();
  expect((await prendre(request, jetonA)).demande?.id).toBe(premiere);
  await vieillirDemandePanier(request, premiere, "pris_le", 31);

  const tardif = await rapporter(request, jetonA, premiere);
  expect(tardif.resultat?.isError).toBeFalsy();
  expect(tardif.resultat?.structuredContent).toEqual({ statut: "terminee", rapport_tardif: true });
  expect((await etatPanier(request, EMAIL_A)).derniere).toMatchObject({
    id: premiere,
    statut: "terminee",
    cause_echec: null,
    rapport: RAPPORT,
    rapport_tardif: true,
  });

  // 2. Run trop long, et le foyer a relancé une demande entre-temps : refusé.
  const deuxieme = await demanderOk();
  expect((await prendre(request, jetonA)).demande?.id).toBe(deuxieme);
  await vieillirDemandePanier(request, deuxieme, "pris_le", 31);
  const troisieme = await demanderOk(); // expire la deuxième, puis la remplace

  const refuse = await rapporter(request, jetonA, deuxieme);
  expect(refuse.resultat?.isError).toBe(true);
  expect(texte(refuse)).toBe(MESSAGES_PANIER.OMQ03);
  expect((await etatPanier(request, EMAIL_A)).derniere).toMatchObject({ id: troisieme, statut: "en_attente" });
});

test("isolation foyer : un autre compte ne prend ni ne rapporte la demande (RG-71)", async ({ request }) => {
  const demandeId = await demanderOk();

  // B (autre foyer) : rien à prendre, rapport refusé, rien de visible.
  expect(await prendre(request, jetonB)).toEqual({ demande: null });
  const refuse = await rapporter(request, jetonB, demandeId);
  expect(refuse.resultat?.isError).toBe(true);
  expect(texte(refuse)).toBe(MESSAGES_PANIER.OMQ03);
  expect(await etatPanier(request, EMAIL_B)).toEqual({ executeur: false, derniere: null, active: null });
  // Ni par lecture directe de la table, sous RLS (RG-71).
  expect(await lireDemande(request, EMAIL_B, demandeId)).toBeNull();

  // La demande de A est intacte : A la prend toujours.
  expect((await prendre(request, jetonA)).demande?.id).toBe(demandeId);
});

test("UI : bouton visible, clic → « Panier en cours… », webhook reçu (RG-81, RG-83)", async () => {
  await ouvrirCourses(pageA);
  const carte = carteDe(pageA);
  // Témoin positif de la séquence d'ouvrirCourses : lue SANS attente, la carte
  // est déjà là (même lecture instantanée que le test « aucun exécuteur »).
  expect(await carte.count()).toBe(1);
  const bouton = carte.getByRole("button", { name: "Remplir mon panier" });
  await expect(bouton).toBeEnabled();

  await bouton.click();
  await expect(pageA.getByText("C’est parti : ton panier se remplit.")).toBeVisible();
  // La demande est active : le bouton reste désactivé, avec l'heure de lancement.
  await expect(carte.getByRole("button", { name: "Panier en cours…" })).toBeDisabled();
  await expect(carte.getByText(/^Lancé à \d{2} h \d{2}$/)).toBeVisible();
  // La route répond après l'envoi du webhook : il est déjà reçu.
  expect(recues).toHaveLength(1);
  expect(recues[0].corps).toBe(CORPS_WEBHOOK);
});

test("UI : compte-rendu affiché après rapporter_panier (RG-82, RG-84)", async ({ request }) => {
  const demandeId = await demanderOk();
  expect((await prendre(request, jetonA)).demande?.id).toBe(demandeId);
  expect((await rapporter(request, jetonA, demandeId)).resultat?.isError).toBeFalsy();

  await ouvrirCourses(pageA);
  const carte = carteDe(pageA);
  await expect(carte.getByText("1 ajouté · 1 à choisir · 1 introuvable")).toBeVisible();
  await expect(
    carte.getByText("Rappel : rien n’est commandé. Relis et valide ton panier dans l’appli Chronodrive.")
  ).toBeVisible();
  // Ce qui demande une action est déplié.
  await expect(carte.getByRole("heading", { name: "À choisir toi-même" })).toBeVisible();
  await expect(carte.getByText("farine", { exact: true })).toBeVisible();
  await expect(carte.getByText("T45 1 kg", { exact: true })).toBeVisible();
  await expect(carte.getByRole("heading", { name: "Introuvables" })).toBeVisible();
  await expect(carte.getByText("estragon", { exact: true })).toBeVisible();
  // Les articles ajoutés sont repliés par défaut.
  const ajoute = carte.getByText("Lait demi-écrémé 1 L · Lactel × 2");
  await expect(ajoute).toBeHidden();
  await carte.getByText("Ajoutés au panier").click();
  await expect(ajoute).toBeVisible();
  await expect(carte.getByText(/^Terminé à \d{2} h \d{2}$/)).toBeVisible();
  // Demande close, aucun article coché : « Remplir mon panier ». « Compléter »
  // exige au moins une coche (RG-83, test dédié en fin de fichier).
  await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();
  expect(await carte.getByRole("button", { name: "Compléter mon panier" }).count()).toBe(0);
});

test("UI : cycle suivant → bouton actif, clic → demande de CE cycle, webhook reçu (#320, RG-81, RG-84)", async ({ request }) => {
  // Sans historique : `etat_panier(p_ancre)` filtre par cycle, les demandes des
  // tests précédents sur le cycle courant se liraient sinon.
  await supprimerDemandesPanier(request, foyerA);
  const terminee = await demandeTerminee(request);
  const suivant = await demandeDuCycleSuivant(request, terminee);
  recues.length = 0;

  // Cycle courant : la demande est sur l'autre cycle, bouton principal sans rapport.
  await ouvrirCourses(pageA);
  const carte = carteDe(pageA);
  await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();
  expect(await carte.getByText("1 ajouté · 1 à choisir · 1 introuvable").count()).toBe(0);

  // Cycle suivant : le rapport de CE cycle, et un bouton actif (RG-81).
  await pageA.getByRole("button", { name: "Cycle suivant" }).click();
  await expect(carte.getByText("1 ajouté · 1 à choisir · 1 introuvable")).toBeVisible();
  const bouton = carte.getByRole("button", { name: "Remplir mon panier" });
  await expect(bouton).toBeEnabled();

  await bouton.click();
  await expect(pageA.getByText("C’est parti : ton panier se remplit.")).toBeVisible();
  await expect(carte.getByRole("button", { name: "Panier en cours…" })).toBeDisabled();
  expect(recues).toHaveLength(1);
  expect(recues[0].corps).toBe(CORPS_WEBHOOK);

  // La demande porte l'ancre du cycle affiché, pas celle du cycle courant.
  const surSuivant = await etatPanier(request, EMAIL_A, suivant);
  expect(surSuivant.active).toMatchObject({ ancre: suivant, statut: "en_attente" });
  expect((await etatPanier(request, EMAIL_A, terminee.ancre)).derniere).toBeNull();

  // Retour au cycle courant : les tests suivants ouvrent /courses sur le
  // cycle mémorisé, qui doit être le courant.
  await revenirAuCycle(pageA, terminee.ancre);
});

test("UI : cycle passé → bouton grisé, motif affiché, aucun appel (#320, RG-81)", async ({ request }) => {
  await supprimerDemandesPanier(request, foyerA);
  const { ancre } = await demandeTerminee(request);
  // `demandeTerminee` passe par la route : le faux exécuteur a reçu son webhook.
  recues.length = 0;
  // Deux cycles en arrière : terminé même si le cycle affiché par défaut est le
  // suivant (week-end, `ancreParDefaut`).
  const passe = cycleDecale(ancre, -2);
  const generation = await appelerOutilMcp(request, jetonA, "generer_cycle", { ancre: passe, remplacer: true });
  expect(generation.resultat?.isError).toBeFalsy();

  const appels: string[] = [];
  const noter = (req: Request) => {
    if (req.url().includes("/api/panier/demande")) appels.push(req.url());
  };
  pageA.on("request", noter);
  try {
    // Relais `?ancre=` : atteint le cycle passé sans dépendre du cycle mémorisé.
    await pageA.goto(`/courses?ancre=${passe}`);
    await expect(pageA.getByText(/^\d+ cochés? sur \d+/)).toBeVisible();
    const carte = carteDe(pageA);
    const bouton = carte.getByRole("button", { name: "Remplir mon panier" });
    await expect(bouton).toHaveAttribute("aria-disabled", "true");
    await expect(carte.getByText(MESSAGES_PANIER.OMQ04)).toBeVisible();
    // Le motif est relié au bouton (lecteurs d'écran).
    await expect(bouton).toHaveAccessibleDescription(MESSAGES_PANIER.OMQ04);

    // `force` : Playwright attend sinon un bouton « activé » et considère
    // `aria-disabled="true"` comme désactivé (timeout). Le clic doit être sans effet.
    await bouton.click({ force: true });
    // Vérification d'absence : laisser passer les événements (un POST déclenché
    // par erreur partirait après le clic) avant d'affirmer qu'aucun appel n'a eu lieu.
    await pageA.waitForTimeout(300);
    expect(appels).toHaveLength(0);
    expect(recues).toHaveLength(0);
  } finally {
    pageA.off("request", noter);
    await revenirAuCycle(pageA, ancre);
  }
});

test("UI : échec affiché quand l’exécuteur répond 500, bouton réactivé (RG-81)", async () => {
  modeReponse = 500;
  await ouvrirCourses(pageA);
  const carte = carteDe(pageA);
  // Libellé de départ selon l'historique laissé par les tests précédents
  // (relance après un compte-rendu) ; après l'échec, toujours le principal.
  await carte.getByRole("button", { name: /^(Remplir mon panier|Compléter mon panier)$/ }).click();
  const bouton = carte.getByRole("button", { name: "Remplir mon panier" });
  // 502 : c'est la carte qui porte le message, en mots simples (le motif brut
  // « réponse HTTP 500 » reste en base). Le toast aurait été émis AVANT la
  // relecture qui affiche ce message : son absence ici est probante.
  await expect(carte.getByText(MESSAGE_CARTE_INJOIGNABLE)).toBeVisible();
  await expect(carte.getByText(/^Terminé à \d{2} h \d{2}$/)).toBeVisible();
  expect(await pageA.getByText(MESSAGE_INJOIGNABLE).count()).toBe(0);
  await expect(bouton).toBeEnabled();
  expect(recues).toHaveLength(1);
});

test("UI : aucun exécuteur → pas de carte (RG-81)", async ({ request }) => {
  expect((await etatPanier(request, EMAIL_B)).executeur).toBe(false);
  // B a un planning sur le cycle courant. Après ouvrirCourses, la liste est
  // chargée, l'état du panier et le jour de courses sont reçus et React a rendu :
  // la même séquence montre la carte à A (témoin du premier test UI). Lecture
  // instantanée, sans poll, comme pour A.
  await ouvrirCourses(pageB);
  expect(await carteDe(pageB).count()).toBe(0);
  expect(await pageB.getByRole("button", { name: /^(Remplir|Compléter) mon panier$/ }).count()).toBe(0);
  expect(await pageB.getByText("Panier Chronodrive").count()).toBe(0);
});

// --- Panier multi-cycle (#320, RG-81, RG-84, RG-85) ---

test("route : { ancre d'un cycle terminé } → 409 OMQ04 sans webhook ; ancre mal formée → 400 ; cycle à venir → 202 (#320, RG-81)", async ({
  request,
}) => {
  await supprimerDemandesPanier(request, foyerA);
  const { ancre } = await demandeTerminee(request);
  recues.length = 0;

  // Appel direct de la route, sans passer par l'UI : c'est la base qui refuse.
  const refus = await demander({ ancre: cycleDecale(ancre, -2) });
  expect(refus.statut).toBe(409);
  expect(refus.corps.error).toBe(MESSAGES_PANIER.OMQ04);
  // Une date en milieu d'un cycle terminé (ancre −2 + 3 jours) désigne ce cycle :
  // la route la résout en ancre avant la RPC, sinon la garde de la base la lirait
  // comme une ancre (cycle décalé de 3 jours) et pourrait l'accepter.
  const milieu = joursDuCycle(cycleDecale(ancre, -2), 7)[3];
  const refusMilieu = await demander({ ancre: milieu });
  expect(refusMilieu.statut).toBe(409);
  expect(refusMilieu.corps.error).toBe(MESSAGES_PANIER.OMQ04);
  const invalide = await demander({ ancre: "pas-une-date" });
  expect(invalide.statut).toBe(400);
  expect(invalide.corps.error).toBe("Cycle invalide.");
  expect(recues).toHaveLength(0);
  expect((await etatPanier(request, EMAIL_A)).active).toBeNull();

  // Un cycle à venir est accepté : la demande porte son ancre, le webhook part.
  const futur = cycleDecale(ancre, 1);
  const id = await demanderOk(futur);
  expect(recues).toHaveLength(1);
  expect(await lireDemande(request, EMAIL_A, id)).toMatchObject({ ancre: futur, statut: "en_attente" });
});

test("etat_panier(p_ancre) : la demande d'un cycle n'apparaît pas sur un autre, l'active reste celle du foyer (#320, RG-83, RG-84)", async ({
  request,
}) => {
  await supprimerDemandesPanier(request, foyerA);
  const terminee = await demandeTerminee(request);
  const suivant = cycleDecale(terminee.ancre, 1);
  await deplacerDemandePanier(request, terminee.id, suivant);

  expect((await etatPanier(request, EMAIL_A, suivant)).derniere).toMatchObject({
    id: terminee.id,
    ancre: suivant,
    statut: "terminee",
  });
  expect((await etatPanier(request, EMAIL_A, terminee.ancre)).derniere).toBeNull();
  // Sans ancre : la dernière demande du foyer, comme avant #320.
  expect((await etatPanier(request, EMAIL_A)).derniere).toMatchObject({ id: terminee.id });

  // Une demande active sur le cycle courant se lit aussi depuis l'autre cycle,
  // sans y remplacer son rapport.
  const active = await demanderOk();
  const surSuivant = await etatPanier(request, EMAIL_A, suivant);
  expect(surSuivant.active?.id).toBe(active);
  expect(surSuivant.derniere?.id).toBe(terminee.id);
});

test("MCP lancer_demande_panier : cycle terminé refusé, cycle suivant → webhook reçu, demande en_attente sur ce cycle (#320, RG-85)", async ({
  request,
}) => {
  await supprimerDemandesPanier(request, foyerA);
  const { ancre } = await demandeTerminee(request);
  recues.length = 0;

  const refus = await appelerOutilMcp(request, jetonA, "lancer_demande_panier", { ancre: cycleDecale(ancre, -2) });
  expect(refus.resultat?.isError).toBe(true);
  expect(texte(refus)).toBe(MESSAGES_PANIER.OMQ04);
  expect(recues).toHaveLength(0);

  const suivant = cycleDecale(ancre, 1);
  const appel = await appelerOutilMcp(request, jetonA, "lancer_demande_panier", { ancre: suivant });
  expect(appel.resultat?.isError).toBeFalsy();
  expect(appel.resultat?.structuredContent).toMatchObject({ ancre: suivant });
  const demandeId = (appel.resultat?.structuredContent as { demande_id: string }).demande_id;
  expect(recues).toHaveLength(1);
  expect(recues[0].corps).toBe(CORPS_WEBHOOK);
  expect(await lireDemande(request, EMAIL_A, demandeId)).toMatchObject({ ancre: suivant, statut: "en_attente" });

  // Une seule demande active par foyer (RG-83) : un second lancement est refusé.
  const second = await appelerOutilMcp(request, jetonA, "lancer_demande_panier", { ancre: suivant });
  expect(second.resultat?.isError).toBe(true);
  expect(texte(second)).toBe(MESSAGES_PANIER.OMQ02);
  expect(recues).toHaveLength(1);
});

// Dernier du fichier : il coche un article dans l'UI (il le décoche avant de
// finir), une coche restante changerait le libellé des tests suivants.
test("UI : « Compléter mon panier » seulement avec un article coché, « Remplir » après décochage (#320, RG-83)", async ({
  request,
}) => {
  await supprimerDemandesPanier(request, foyerA);
  await demandeTerminee(request);
  await ouvrirCourses(pageA);
  const carte = carteDe(pageA);
  await expect(carte.getByRole("button", { name: "Remplir mon panier" })).toBeEnabled();

  const liste = pageA.getByTestId("categories-courses");
  const cochees = liste.getByRole("checkbox", { checked: true });
  try {
    // L'écho de la synchro des coches peut faire revenir brièvement l'ancien
    // libellé juste après le clic : on attend l'état stable (coches et libellé
    // lus ensemble), pas un instantané.
    const libelleStable = async (attendu: "Remplir mon panier" | "Compléter mon panier", coches: number) => {
      const autre = attendu === "Remplir mon panier" ? "Compléter mon panier" : "Remplir mon panier";
      await expect(async () => {
        await expect(cochees).toHaveCount(coches, { timeout: 1_000 });
        await expect(carte.getByRole("button", { name: attendu })).toBeEnabled({ timeout: 1_000 });
        await expect(carte.getByRole("button", { name: autre })).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
    };

    // Un clic pendant la View Transition de la liste tombe sur son calque et se
    // perd : on clique jusqu'à observer le nombre de coches attendu.
    const cocherJusqua = async (coches: number) => {
      await expect(async () => {
        if ((await cochees.count()) !== coches) {
          const cible = coches > 0 ? liste.getByRole("checkbox", { checked: false }) : cochees;
          await cible.first().click({ timeout: 2_000 });
        }
        await expect(cochees).toHaveCount(coches, { timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    };

    await cocherJusqua(1);
    await libelleStable("Compléter mon panier", 1);

    await cocherJusqua(0);
    await libelleStable("Remplir mon panier", 0);
  } finally {
    // Échec en cours de route : ne rien laisser de coché. On décoche puis on
    // attend l'état observé (plus aucune case cochée), sans boucle à l'aveugle.
    await expect(async () => {
      if ((await cochees.count()) > 0) await cochees.first().click();
      await expect(cochees).toHaveCount(0, { timeout: 1_000 });
    })
      .toPass({ timeout: 10_000 })
      .catch((erreur) => console.warn("Nettoyage des coches impossible :", erreur));
  }
});
