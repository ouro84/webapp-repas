import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock Upstash : on capture la configuration de chaque limiteur construit et on
// pilote la réponse de `limit`. Le module est réimporté à chaque test (vi.resetModules)
// car les limiteurs sont mémoïsés au chargement, selon les variables d'env.
const constructions: Array<{ prefix: string; limiter: unknown }> = []
const limit = vi.fn()

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow(requetes: number, fenetre: string) {
      return { requetes, fenetre }
    }
    constructor(options: { prefix: string; limiter: unknown }) {
      constructions.push({ prefix: options.prefix, limiter: options.limiter })
    }
    limit = limit
  }
  return { Ratelimit }
})
vi.mock("@upstash/redis", () => ({ Redis: class {} }))

async function charger() {
  vi.resetModules()
  return import("./rate-limit")
}

beforeEach(() => {
  constructions.length = 0
  limit.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

// En environnement de test (et en CI), les variables UPSTASH_* sont absentes →
// le limiteur est NO-OP et autorise tout. C'est le comportement dont dépendent
// les e2e (qui génèrent plusieurs plannings sans déclencher de 429).
describe("limiteGeneration (sans Upstash configuré)", () => {
  it("autorise quand le limiteur est désactivé (env absente)", async () => {
    const { limiteGeneration } = await charger()
    const r1 = await limiteGeneration("utilisateur-a")
    const r2 = await limiteGeneration("utilisateur-a")
    expect(r1.autorise).toBe(true)
    expect(r2.autorise).toBe(true)
  })

  it("autorise pour n'importe quel identifiant", async () => {
    const { limiteGeneration } = await charger()
    const { autorise } = await limiteGeneration("autre-utilisateur")
    expect(autorise).toBe(true)
  })
})

describe("limiteMcp (#305, RG-78)", () => {
  it("limiteMcp : NO-OP sans variables Upstash", async () => {
    const { limiteMcp } = await charger()
    expect(await limiteMcp("u1")).toEqual({ autorise: true })
    expect(constructions).toHaveLength(0)
  })

  it("limiteMcp : préfixe rl:mcp et 60 requêtes / 60 s", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.test")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "jeton")
    const { limiteMcp } = await charger()
    limit.mockResolvedValue({ success: false })
    expect(await limiteMcp("u1")).toEqual({ autorise: false })
    expect(limit).toHaveBeenCalledWith("u1")
    expect(constructions).toContainEqual({
      prefix: "rl:mcp",
      limiter: { requetes: 60, fenetre: "60 s" },
    })
  })

  it("limiteMcp : fail-open si Upstash lève", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.test")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "jeton")
    const espion = vi.spyOn(console, "error").mockImplementation(() => {})
    const { limiteMcp } = await charger()
    limit.mockRejectedValue(new Error("réseau"))
    expect(await limiteMcp("u1")).toEqual({ autorise: true })
    expect(espion).toHaveBeenCalled()
    espion.mockRestore()
  })

  it("limiteGeneration inchangé (rl:generer, 10/60 s)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.test")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "jeton")
    const { limiteGeneration } = await charger()
    limit.mockResolvedValue({ success: true })
    expect(await limiteGeneration("u1")).toEqual({ autorise: true })
    expect(constructions).toContainEqual({
      prefix: "rl:generer",
      limiter: { requetes: 10, fenetre: "60 s" },
    })
  })
})

describe("variables d'environnement (intégration Vercel Marketplace)", () => {
  it("active le limiteur avec KV_REST_API_URL / KV_REST_API_TOKEN (noms posés par l'intégration Upstash de Vercel)", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://upstash.test")
    vi.stubEnv("KV_REST_API_TOKEN", "jeton")
    const { limiteMcp } = await charger()
    limit.mockResolvedValue({ success: false })
    expect(await limiteMcp("u1")).toEqual({ autorise: false })
    expect(constructions.map((c) => c.prefix)).toEqual(["rl:generer", "rl:mcp"])
  })
})
