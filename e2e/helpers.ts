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

  // PostgREST exige un filtre pour DELETE ; user_id=not.is.null couvre toutes
  // les lignes visibles (la RLS restreint déjà au propriétaire). Les slots du
  // planning partent en cascade.
  await request.delete(`${url}/rest/v1/planning?user_id=not.is.null`, {
    headers,
  });
  await request.delete(`${url}/rest/v1/etat_courses?user_id=not.is.null`, {
    headers,
  });
}
