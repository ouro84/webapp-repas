// Helpers e2e partagés.
//
// Lecture de .env.local (Playwright ne charge pas les env Next) + nettoyage de
// l'état distant du compte de test (planning + coches) pour repartir d'une base
// vierge — nécessaire depuis la sync multi-device (#6) : sans ça, un planning
// persisté en base par un test précédent réapparaîtrait à l'hydratation et
// casserait l'état vide attendu.

import { readFileSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_EMAIL ?? "claude-e2e-test@example.com";
export const E2E_PASSWORD =
  process.env.E2E_PASSWORD ?? "E2E-Test-Claude-2026!";

// Lit une variable dans .env.local.
export function lireEnvLocal(cle: string): string {
  const ligne = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));
  if (!ligne) throw new Error(`${cle} introuvable dans .env.local`);
  return ligne.slice(cle.length + 1).trim().replace(/^"|"$/g, "");
}

/**
 * Supprime le planning et les coches du compte de test côté base (RLS
 * propriétaire → ne touche que ses propres lignes). Authentification REST par
 * mot de passe, comme auth.setup. À appeler en beforeEach des specs qui
 * dépendent d'un état distant vierge (#6, US-13).
 */
export async function nettoyerEtatDistant(
  request: APIRequestContext
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  if (!auth.ok()) {
    throw new Error(
      `Auth REST du compte de test impossible : HTTP ${auth.status()}`
    );
  }
  const { access_token: jeton } = (await auth.json()) as {
    access_token: string;
  };
  const headers = { apikey: anon, Authorization: `Bearer ${jeton}` };

  // PostgREST exige un filtre pour DELETE ; foyer_id=not.is.null couvre toutes
  // les lignes visibles (la RLS « foyer » #56 restreint déjà au foyer du compte
  // de test). Les slots du planning partent en cascade.
  await request.delete(`${url}/rest/v1/planning?foyer_id=not.is.null`, {
    headers,
  });
  // Coches par-article (#56 PR4) : la table etat_courses (blob) a été remplacée.
  await request.delete(
    `${url}/rest/v1/etat_courses_article?foyer_id=not.is.null`,
    { headers }
  );
}

/**
 * Supprime les réglages de génération du compte de test (#45) via DELETE REST.
 * À appeler en beforeEach ET afterAll de reglages.spec : le compte étant
 * partagé, un réglage non nettoyé ferait diverger les specs qui supposent le
 * comportement par défaut (ex. « génération = 2 personnes »).
 */
export async function nettoyerReglagesDistants(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/reglages?user_id=not.is.null`, {
    headers,
  });
}

// Jeton d'accès du compte de test (auth REST par mot de passe).
async function jetonTest(request: APIRequestContext): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  if (!auth.ok()) {
    throw new Error(
      `Auth REST du compte de test impossible : HTTP ${auth.status()}`
    );
  }
  const { access_token: jeton } = (await auth.json()) as {
    access_token: string;
  };
  return { url, headers: { apikey: anon, Authorization: `Bearer ${jeton}` } };
}

/**
 * Supprime tous les masquages de recettes du compte de test (#105) via DELETE
 * REST. Le masquage (« suppression » d'une recette par défaut) persiste en base
 * pour l'utilisateur : sans nettoyage, une recette du catalogue masquée par un
 * test resterait absente du vivier pour les runs suivants (génération faussée).
 * À appeler en beforeEach ET afterAll de recettes.spec.
 */
export async function nettoyerMasquagesDistants(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/recette_masquee?foyer_id=not.is.null`, {
    headers,
  });
}

/**
 * Réinitialise l'identité du profil du compte de test (#22) : prénom et couleur
 * d'avatar remis à null via PATCH REST. Le compte étant partagé, un prénom
 * résiduel ferait dériver l'avatar de la nav d'un run à l'autre. NE touche PAS
 * onboarding_complete (laissé à true → pas de redirection onboarding en PR2).
 * À appeler en beforeEach ET afterAll de profil.spec.
 */
export async function reinitialiserProfilDistant(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  // RLS UPDATE « ma propre ligne » → ne touche que le profil du compte de test
  // (le filtre est requis par PostgREST). Grant au niveau colonne : prenom /
  // couleur_avatar sont modifiables par le rôle authenticated.
  await request.patch(`${url}/rest/v1/profiles?user_id=not.is.null`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { prenom: null, couleur_avatar: null },
  });
}

/**
 * Supprime les recettes de test du run (nom contenant le suffixe) via DELETE
 * REST — teardown de recettes.spec. Remplace la suppression via clics UI, qui
 * dépassait le timeout afterAll (re-render de la liste → « element detached »).
 * Filtre par suffixe : sans effet sur d'éventuels runs CI concurrents.
 */
export async function nettoyerRecettesDistantes(
  request: APIRequestContext,
  suffixe: string
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  // RLS « propriétaire » : seules les recettes perso du compte de test sont
  // supprimées (les globales user_id=null sont épargnées). recette_ingredient
  // part en cascade.
  await request.delete(
    `${url}/rest/v1/recette?nom=like.*${encodeURIComponent(suffixe)}*`,
    { headers }
  );
}
