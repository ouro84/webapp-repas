// Rate-limiting des routes API mutantes (audit F-04, #191).
//
// Limiteur distribué Upstash Redis (sliding window), nécessaire car en serverless
// Vercel un compteur en mémoire ne tient pas (instances éphémères/multiples).
//
// ⚠️ NO-OP quand les variables d'env Upstash sont absentes : c'est le cas en CI
// (les e2e génèrent plusieurs plannings et n'ont pas les secrets) et en dev local
// si non configuré → la limite est alors inactive (autorise tout). En production,
// poser UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN dans les variables
// d'env Vercel pour l'activer.
//
// FAIL-OPEN : si Upstash est injoignable (réseau), on autorise quand même (+ log)
// plutôt que de bloquer une action légitime — cohérent avec la philosophie du
// proxy (#169). Le rate-limit est une protection best-effort, pas une garantie.

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

// Instance mémoïsée au niveau module (réutilisée entre invocations chaudes).
// null si non configuré → no-op.
const limiteur =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        // 10 requêtes par fenêtre glissante de 60 s et par utilisateur.
        limiter: Ratelimit.slidingWindow(10, "60 s"),
        prefix: "rl:generer",
        analytics: false,
      })
    : null

/**
 * Vérifie le quota pour un identifiant (ici l'`user.id`, plus fiable que l'IP
 * derrière les proxies Vercel). Renvoie `{ autorise: true }` si le limiteur est
 * désactivé (env absente) ou indisponible (fail-open).
 */
export async function limiteGeneration(
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
