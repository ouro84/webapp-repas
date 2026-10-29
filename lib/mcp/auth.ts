// Vérification du jeton OAuth 2.1 des requêtes MCP (#305, ADR-11).
//
// Le serveur d'autorisation est Supabase OAuth Server : le jeton d'accès est un
// JWT `authenticated` de l'utilisateur, signé ES256. `auth.getClaims()` le
// vérifie localement contre le JWKS du projet (mis en cache globalement par
// supabase-js) : aucune dépendance JWT supplémentaire.
//
// RG-71 : toute requête exige un jeton OAuth. On exige donc le claim
// `client_id`, propre aux jetons émis pour un client OAuth : un JWT de session
// web (sans `client_id`) n'ouvre pas le MCP. Jamais de `service_role` ici.

import type { AuthInfo } from "@modelcontextprotocol/server"
import { creerClientParJeton } from "@/lib/supabase/par-jeton"

/** Émetteur des jetons (champ `issuer` de la découverte RFC 8414 de Supabase). */
export function emetteurOAuth(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
}

/**
 * `verifyToken` de `withMcpAuth` : renvoie l'AuthInfo d'un jeton OAuth valide,
 * `undefined` sinon (absent, signature ou expiration invalide, rôle autre que
 * `authenticated`, `sub` ou `client_id` absent). Ne lève jamais : un refus
 * donne un 401 avec `WWW-Authenticate`, pas une 500.
 */
export async function verifierJetonMcp(
  _req: Request,
  jeton?: string
): Promise<AuthInfo | undefined> {
  if (!jeton) return undefined
  try {
    const { data, error } = await creerClientParJeton(jeton).auth.getClaims(jeton)
    if (error || !data) return undefined
    const claims = data.claims as Record<string, unknown>
    const { sub, role, client_id: clientId, exp, scope } = claims
    if (role !== "authenticated" || typeof sub !== "string" || typeof clientId !== "string") {
      return undefined
    }
    return {
      token: jeton,
      clientId,
      scopes: typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
      expiresAt: typeof exp === "number" ? exp : undefined,
      extra: { userId: sub },
    }
  } catch (erreur) {
    console.error("Vérification du jeton MCP impossible.", erreur)
    return undefined
  }
}
