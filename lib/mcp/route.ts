// Fabrique de route MCP partagée par /api/mcp et /api/mcp/executeur (#305, #330,
// RG-71, RG-78, ADR-11).
//
// Streamable HTTP via mcp-handler v2 (sans état). Toute requête exige un jeton
// OAuth 2.1 émis par Supabase OAuth Server : `withMcpAuth` répond 401 avec
// `WWW-Authenticate: Bearer resource_metadata=…` (RFC 9728) sinon. Le quota
// par utilisateur (`limiteMcp`, préfixe `rl:mcp`) s'applique après l'auth.
// Le proxy laisse passer ces routes sans session à cookies (`sansSession`).

import { createMcpHandler, withMcpAuth } from "mcp-handler"
import type { McpServer } from "@modelcontextprotocol/server"
import { verifierJetonMcp } from "@/lib/mcp/auth"
import { limiteMcp } from "@/lib/rate-limit"
import { version } from "@/package.json"

/**
 * Construit le handler d'une route MCP. `enregistrer` pose les outils,
 * `nom` est le `serverInfo.name`, `cheminRessource` le chemin de la metadata
 * RFC 9728 pointé par le `WWW-Authenticate` du 401.
 */
export function creerRouteMcp(
  enregistrer: (server: McpServer) => void,
  nom: string,
  cheminRessource: string
): (req: Request) => Promise<Response> {
  const serveur = createMcpHandler(enregistrer, { serverInfo: { name: nom, version } })

  async function avecQuota(req: Request): Promise<Response> {
    const userId = req.auth?.extra?.userId
    if (typeof userId === "string" && !(await limiteMcp(userId)).autorise) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Trop de requêtes en peu de temps. Patiente une minute puis réessaie." },
          id: null,
        },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    }
    return serveur(req)
  }

  return withMcpAuth(avecQuota, verifierJetonMcp, { required: true, resourceMetadataPath: cheminRessource })
}
