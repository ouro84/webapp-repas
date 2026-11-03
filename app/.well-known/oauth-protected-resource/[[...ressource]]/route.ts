// Metadata « Protected Resource » RFC 9728 du serveur MCP (#305, ADR-11).
//
// Servie aux deux chemins que les clients MCP sondent :
// /.well-known/oauth-protected-resource et sa variante suffixée
// /.well-known/oauth-protected-resource/api/mcp (celle que pointe le
// `WWW-Authenticate` de /api/mcp). `resource` vaut l'URL de /api/mcp, sauf pour
// le suffixe `api/mcp/executeur` (#330) qui désigne l'endpoint de l'exécuteur de
// panier : tout autre suffixe garde /api/mcp. Le serveur d'autorisation est
// Supabase Auth (émetteur `<SUPABASE_URL>/auth/v1`).

import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler"
import { emetteurOAuth } from "@/lib/mcp/auth"

// Ressources MCP connues, par suffixe d'URL après /oauth-protected-resource/.
// Une `Map` et non un littéral : `RESSOURCES["constructor"]` renverrait un membre
// hérité d'Object.
const RESSOURCES = new Map<string, string>([
  ["api/mcp", "/api/mcp"],
  ["api/mcp/executeur", "/api/mcp/executeur"],
])

const PREFIXE = "/.well-known/oauth-protected-resource/"

type Contexte = { params?: Promise<{ ressource?: string[] }> }

// Suffixe demandé : segments du catch-all Next quand le contexte est fourni,
// sinon (appel direct, tests) lu dans l'URL.
async function suffixeDemande(req: Request, ctx?: Contexte): Promise<string> {
  if (ctx?.params) return ((await ctx.params).ressource ?? []).join("/")
  const { pathname } = new URL(req.url)
  return pathname.startsWith(PREFIXE) ? pathname.slice(PREFIXE.length).replace(/\/+$/, "") : ""
}

export async function GET(req: Request, ctx?: Contexte): Promise<Response> {
  const chemin = RESSOURCES.get(await suffixeDemande(req, ctx)) ?? "/api/mcp"
  return protectedResourceHandler({
    authServerUrls: [emetteurOAuth()],
    resourceUrl: `${getPublicOrigin(req)}${chemin}`,
  })(req)
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
