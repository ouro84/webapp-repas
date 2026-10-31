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
// Prérequis staging : migration 20261031120000_demande_panier appliquée,
// OAuth Server + DCR, site_url = http://localhost:3000.

import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { appelerOutilMcp, autoriser, connecter, inscrire, jetonMotDePasse } from "./oauth";
import {
  demandesPanierActives,
  enregistrerExecuteurPanier,
  lireEnvLocal,
  supprimerExecuteurPanier,
  vieillirDemandePanier,
} from "./helpers";
import { MESSAGE_INJOIGNABLE, MESSAGES_PANIER } from "../lib/panier";

const RUN = Date.now();
const EMAIL_A = `claude-e2e-panier-a-${RUN}@example.com`;
const EMAIL_B = `claude-e2e-panier-b-${RUN}@example.com`;
const CORPS_WEBHOOK = '{"evenement":"demande_panier"}';
// Secret au format Standard Webhooks : la clé HMAC est le base64 décodé (RG-81).
const SECRET = `whsec_${randomBytes(32).toString("base64")}`;

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

async function foyerDe(request: APIRequestContext, email: string): Promise<string> {
  const jeton = await jetonMotDePasse(request, email);
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

async function etatPanier(request: APIRequestContext, email: string): Promise<{ executeur: boolean; derniere: Derniere }> {
  const jeton = await jetonMotDePasse(request, email);
  const r = await request.post(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/etat_panier`, {
    headers: {
      apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
    },
    data: {},
  });
  expect(r.ok()).toBe(true);
  return r.json();
}

// Une demande précise, lue sous RLS (lecture seule pour le foyer).
async function lireDemande(request: APIRequestContext, email: string, id: string): Promise<Derniere> {
  const jeton = await jetonMotDePasse(request, email);
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
async function demander(): Promise<{ statut: number; corps: { demande_id?: string; error?: string } }> {
  const r = await pageA.request.post("/api/panier/demande");
  const statut = r.status();
  const brut = await r.text();
  try {
    return { statut, corps: JSON.parse(brut) };
  } catch {
    throw new Error(`POST /api/panier/demande : HTTP ${statut}, corps non JSON : ${brut.slice(0, 500)}`);
  }
}

async function demanderOk(): Promise<string> {
  const { statut, corps } = await demander();
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
      jetonB = access_token;
    }
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
  expect(await etatPanier(request, EMAIL_B)).toEqual({ executeur: false, derniere: null });
  // Ni par lecture directe de la table, sous RLS (RG-71).
  expect(await lireDemande(request, EMAIL_B, demandeId)).toBeNull();

  // La demande de A est intacte : A la prend toujours.
  expect((await prendre(request, jetonA)).demande?.id).toBe(demandeId);
});
