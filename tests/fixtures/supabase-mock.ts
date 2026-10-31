// Client Supabase factice pour les tests des fonctions à client injecté (#304).
//
// Chaque `from(table)` renvoie un builder chaînable qui ENREGISTRE chaque appel
// de méthode (`select`, `eq`, `gte`…) et se résout — par `await`,
// `maybeSingle()` ou `single()` — sur la réponse configurée pour la table. Une
// réponse peut être une fonction de l'appel enregistré, pour répondre selon un
// filtre (ex. `eq("semaine", …)`). `rpc(nom, args)` est enregistré de même.

import type { ClientSupabase } from "@/lib/supabase/types"

export type ReponseMock = {
  data: unknown
  error: { message: string; code?: string } | null
  count?: number | null
}
export type AppelTable = { table: string; ops: Array<[string, ...unknown[]]> }
export type AppelRpc = { nom: string; args: unknown }
export type ConfigMock = {
  tables?: Record<string, ReponseMock | ((appel: AppelTable) => ReponseMock)>
  rpc?: Record<string, ReponseMock | ((args: unknown) => ReponseMock)>
}

export function creerSupabaseMock(config: ConfigMock = {}): {
  client: ClientSupabase
  appels: AppelTable[]
  rpcs: AppelRpc[]
} {
  const appels: AppelTable[] = []
  const rpcs: AppelRpc[] = []
  const repondre = (appel: AppelTable): ReponseMock => {
    const r = config.tables?.[appel.table] ?? { data: null, error: null }
    return typeof r === "function" ? r(appel) : r
  }
  const client = {
    from(table: string) {
      const appel: AppelTable = { table, ops: [] }
      appels.push(appel)
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_cible, prop) {
            if (prop === "then") {
              return (
                ok: (v: ReponseMock) => unknown,
                ko: (e: unknown) => unknown
              ) => Promise.resolve(repondre(appel)).then(ok, ko)
            }
            return (...args: unknown[]) => {
              appel.ops.push([String(prop), ...args])
              return prop === "maybeSingle" || prop === "single"
                ? Promise.resolve(repondre(appel))
                : builder
            }
          },
        }
      )
      return builder
    },
    rpc(nom: string, args: unknown) {
      rpcs.push({ nom, args })
      const r = config.rpc?.[nom] ?? { data: null, error: null }
      return Promise.resolve(typeof r === "function" ? r(args) : r)
    },
  }
  return { client: client as unknown as ClientSupabase, appels, rpcs }
}

/** Valeur du premier filtre `[op, colonne, valeur]` enregistré sur l'appel. */
export function filtre(appel: AppelTable, op: string, colonne: string): unknown {
  const trouve = appel.ops.find(([o, c]) => o === op && c === colonne)
  return trouve?.[2]
}
