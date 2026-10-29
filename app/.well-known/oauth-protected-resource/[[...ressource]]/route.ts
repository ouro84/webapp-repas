// Metadata « Protected Resource » RFC 9728 du serveur MCP (#305, ADR-11).
//
// Servie aux deux chemins que les clients MCP sondent :
// /.well-known/oauth-protected-resource et sa variante suffixée
// /.well-known/oauth-protected-resource/api/mcp (celle que pointe le
// `WWW-Authenticate` de /api/mcp). `resource` vaut toujours l'URL de /api/mcp ;
// le serveur d'autorisation est Supabase Auth (émetteur `<SUPABASE_URL>/auth/v1`).

import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler"
import { emetteurOAuth } from "@/lib/mcp/auth"

export function GET(req: Request): Response {
  return protectedResourceHandler({
    authServerUrls: [emetteurOAuth()],
    resourceUrl: `${getPublicOrigin(req)}/api/mcp`,
  })(req)
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
