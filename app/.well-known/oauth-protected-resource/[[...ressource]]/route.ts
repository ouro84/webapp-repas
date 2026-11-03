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
const RESSOURCES: Record<string, string> = {
  "api/mcp": "/api/mcp",
  "api/mcp/executeur": "/api/mcp/executeur",
}

const PREFIXE = "/.well-known/oauth-protected-resource/"

export function GET(req: Request): Response {
  const { pathname } = new URL(req.url)
  const suffixe = pathname.startsWith(PREFIXE) ? pathname.slice(PREFIXE.length).replace(/\/+$/, "") : ""
  const chemin = RESSOURCES[suffixe] ?? "/api/mcp"
  return protectedResourceHandler({
    authServerUrls: [emetteurOAuth()],
    resourceUrl: `${getPublicOrigin(req)}${chemin}`,
  })(req)
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
