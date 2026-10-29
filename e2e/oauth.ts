// Helpers e2e du flux OAuth 2.1 + MCP (#305) contre STAGING.
//
// Joue le rôle d'un assistant IA : enregistrement dynamique (DCR) d'un client
// public, autorisation PKCE S256 dans le navigateur (écran /oauth/consent),
// échange du code contre un jeton, puis appels JSON-RPC à /api/mcp.
// Chaque run crée un client DCR sur staging (ils s'accumulent, comme les
// comptes jetables).

import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect } from "./fixtures";
import { E2E_PASSWORD, lireEnvLocal, marquerOnboardingCompletDistant } from "./helpers";

export const REDIRECTION = "http://127.0.0.1:9999/callback";

function urlSupabase(): string {
  return lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
}

function base64url(octets: Buffer): string {
  return octets.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function genererPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function enregistrerClientOAuth(
  request: APIRequestContext,
  nom: string
): Promise<{ clientId: string }> {
  const r = await request.post(`${urlSupabase()}/auth/v1/oauth/clients/register`, {
    headers: { "Content-Type": "application/json" },
    data: {
      client_name: nom,
      redirect_uris: [REDIRECTION],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  if (!r.ok()) throw new Error(`DCR impossible : HTTP ${r.status()} — ${await r.text()}`);
  const { client_id: clientId } = (await r.json()) as { client_id: string };
  return { clientId };
}

export function urlAutorisation(clientId: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECTION,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${urlSupabase()}/auth/v1/oauth/authorize?${params}`;
}

/** Intercepte la redirection finale vers le client (aucun serveur sur :9999). */
export function capturerRedirection(page: Page): Promise<URL> {
  return new Promise((resolve) => {
    void page.route("http://127.0.0.1:9999/**", async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
    });
  });
}

async function postToken(request: APIRequestContext, form: Record<string, string>): Promise<APIResponse> {
  return request.post(`${urlSupabase()}/auth/v1/oauth/token`, { form });
}

export async function echangerCode(
  request: APIRequestContext,
  clientId: string,
  code: string,
  verifier: string
): Promise<{ access_token: string; refresh_token: string }> {
  const r = await postToken(request, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECTION,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (!r.ok()) throw new Error(`Échange du code impossible : HTTP ${r.status()} — ${await r.text()}`);
  return (await r.json()) as { access_token: string; refresh_token: string };
}

export function rafraichir(
  request: APIRequestContext,
  clientId: string,
  refreshToken: string
): Promise<APIResponse> {
  return postToken(request, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
}

type ResultatOutil = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
};

let idJsonRpc = 0;

async function postMcp(
  request: APIRequestContext,
  jeton: string | null,
  methode: string,
  params: unknown
): Promise<APIResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  return request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: ++idJsonRpc, method: methode, params },
  });
}

/** Corps JSON-RPC d'une réponse MCP, servie en JSON ou en SSE (`data:`). */
async function lireJsonRpc(reponse: APIResponse): Promise<{ result?: ResultatOutil }> {
  const texte = await reponse.text();
  const ligne = texte.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(ligne ? ligne.slice(5) : texte);
}

export async function appelerOutilMcp(
  request: APIRequestContext,
  jeton: string | null,
  nom: string,
  args: Record<string, unknown> = {}
): Promise<{ statut: number; resultat?: ResultatOutil; reponse: APIResponse }> {
  await postMcp(request, jeton, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-omq", version: "1" },
  });
  const reponse = await postMcp(request, jeton, "tools/call", { name: nom, arguments: args });
  if (reponse.status() !== 200) return { statut: reponse.status(), reponse };
  return { statut: 200, resultat: (await lireJsonRpc(reponse)).result, reponse };
}

/** Jeton de session web (mot de passe) d'un compte — pour préparer des données. */
export async function jetonMotDePasse(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post(`${urlSupabase()}/auth/v1/token?grant_type=password`, {
    headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (!r.ok()) throw new Error(`Auth REST de ${email} impossible : HTTP ${r.status()}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

/** Enregistre la semaine `semaine` d'un compte (RPC sauvegarder_planning) avec ces dîners. */
export async function enregistrerPlanning(
  request: APIRequestContext,
  jeton: string,
  semaine: string,
  diners: Array<{ jour: string; recetteId: string }>
): Promise<void> {
  const r = await request.post(`${urlSupabase()}/rest/v1/rpc/sauvegarder_planning`, {
    headers: {
      apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
    },
    data: {
      p_semaine: semaine,
      p_slots: diners.map(({ jour, recetteId }) => ({
        recette_id: recetteId,
        jour,
        type_repas: "diner",
        personnes: 2,
        restes: false,
      })),
    },
  });
  if (!r.ok()) throw new Error(`sauvegarder_planning impossible : HTTP ${r.status()} — ${await r.text()}`);
}

/** Recettes du catalogue global (id, nom), lues avec le jeton d'un compte. */
export async function recettesCatalogue(
  request: APIRequestContext,
  jeton: string,
  nombre: number
): Promise<Array<{ id: string; nom: string }>> {
  const r = await request.get(
    `${urlSupabase()}/rest/v1/recette?select=id,nom&foyer_id=is.null&order=nom&limit=${nombre}`,
    { headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), Authorization: `Bearer ${jeton}` } }
  );
  if (!r.ok()) throw new Error(`Lecture du catalogue impossible : HTTP ${r.status()}`);
  return (await r.json()) as Array<{ id: string; nom: string }>;
}

// --- Parcours partagés par oauth-mcp.spec et mcp-ecriture.spec (#306) ---

export async function inscrire(request: APIRequestContext, email: string, onboarde = true): Promise<void> {
  const r = await request.post(`${lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/signup`, {
    headers: { apikey: lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  if (onboarde) await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

export async function remplirLogin(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function connecter(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await remplirLogin(page, email);
  await page.waitForURL("**/planning");
}

// Écran de consentement : boutons ciblés dans sa section, car le bandeau
// cookies porte lui aussi un bouton « Refuser ».
export function consentement(page: Page, nomClient: string) {
  return page.getByRole("region", { name: new RegExp(`^Autoriser ${nomClient}\\s\\?$`) });
}

// Déroule une autorisation complète pour `email` (déjà connecté sur `page`) et
// renvoie le client et les jetons obtenus.
export async function autoriser(page: Page, request: APIRequestContext, nomClient: string) {
  const { clientId } = await enregistrerClientOAuth(request, nomClient);
  const { verifier, challenge } = genererPkce();
  const redirection = capturerRedirection(page);
  await page.goto(urlAutorisation(clientId, challenge, "etat-1"));
  await expect(consentement(page, nomClient)).toContainText(
    `${nomClient} pourra, en ton nom et seulement pour ton foyer`
  );
  await consentement(page, nomClient).getByRole("button", { name: "Autoriser" }).click();
  const retour = await redirection;
  expect(retour.searchParams.get("state")).toBe("etat-1");
  const code = retour.searchParams.get("code");
  expect(code).toBeTruthy();
  const jetons = await echangerCode(request, clientId, code!, verifier);
  return { clientId, ...jetons };
}
