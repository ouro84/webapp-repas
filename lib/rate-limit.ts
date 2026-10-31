// Rate-limiting des routes API mutantes (audit F-04, #191).
//
// Limiteur distribué Upstash Redis (sliding window), nécessaire car en serverless
// Vercel un compteur en mémoire ne tient pas (instances éphémères/multiples).
//
// ⚠️ NO-OP quand les variables d'env Upstash sont absentes : c'est le cas en CI
// (les e2e génèrent plusieurs plannings et n'ont pas les secrets) et en dev local
// si non configuré → la limite est alors inactive (autorise tout). En production,
// l'intégration Upstash du Marketplace Vercel pose KV_REST_API_URL +
// KV_REST_API_TOKEN ; les noms UPSTASH_REDIS_REST_URL / _TOKEN (compte Upstash
// direct) restent acceptés et prioritaires.
//
// FAIL-OPEN : si Upstash est injoignable (réseau), on autorise quand même (+ log)
// plutôt que de bloquer une action légitime — cohérent avec la philosophie du
// proxy (#169). Le rate-limit est une protection best-effort, pas une garantie.

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

type Fenetre = Parameters<typeof Ratelimit.slidingWindow>[1]

// Fabrique d'un limiteur à fenêtre glissante, mémoïsé au niveau module
// (réutilisé entre invocations chaudes). null si non configuré → no-op.
function creerLimiteur(prefixe: string, requetes: number, fenetre: Fenetre): Ratelimit | null {
  if (!url || !token) return null
  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(requetes, fenetre),
    prefix: prefixe,
    analytics: false,
  })
}

// Génération : 10 requêtes par fenêtre glissante de 60 s et par utilisateur.
const limiteurGeneration = creerLimiteur("rl:generer", 10, "60 s")
// Serveur MCP (#305, RG-78) : 60 requêtes par minute et par utilisateur — un
// assistant enchaîne initialize, tools/list et plusieurs appels par question.
const limiteurMcp = creerLimiteur("rl:mcp", 60, "60 s")
// Demande de panier (#308, RG-81) : 5 requêtes par minute et par utilisateur —
// chaque demande déclenche un webhook vers l'exécuteur du foyer.
const limiteurPanier = creerLimiteur("rl:panier", 5, "60 s")

async function verifier(
  limiteur: Ratelimit | null,
  identifiant: string
): Promise<{ autorise: boolean }> {
  if (!limiteur) return { autorise: true }
  try {
    const { success } = await limiteur.limit(identifiant)
    return { autorise: success }
  } catch (erreur) {
    console.error("Rate-limit indisponible (fail-open).", erreur)
    return { autorise: true }
  }
}

/**
 * Vérifie le quota pour un identifiant (ici l'`user.id`, plus fiable que l'IP
 * derrière les proxies Vercel). Renvoie `{ autorise: true }` si le limiteur est
 * désactivé (env absente) ou indisponible (fail-open).
 */
export async function limiteGeneration(
  identifiant: string
): Promise<{ autorise: boolean }> {
  return verifier(limiteurGeneration, identifiant)
}

/**
 * Quota du serveur MCP par utilisateur (claim `sub` du jeton OAuth, préfixe
 * `rl:mcp` distinct de la génération). Mêmes règles : no-op sans env, fail-open.
 */
export async function limiteMcp(identifiant: string): Promise<{ autorise: boolean }> {
  return verifier(limiteurMcp, identifiant)
}

/**
 * Quota de la demande de panier par utilisateur (préfixe `rl:panier`). Mêmes
 * règles : no-op sans env, fail-open.
 */
export async function limitePanier(identifiant: string): Promise<{ autorise: boolean }> {
  return verifier(limiteurPanier, identifiant)
}
