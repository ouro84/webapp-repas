// Serveur MCP distant d'OMQ (#305, US-50/51, RG-71, RG-78, ADR-11).
//
// Streamable HTTP via mcp-handler v2 (sans état). Toute requête exige un jeton
// OAuth 2.1 émis par Supabase OAuth Server : `withMcpAuth` répond 401 avec
// `WWW-Authenticate: Bearer resource_metadata=…` (RFC 9728) sinon. Le quota
// par utilisateur (`limiteMcp`, préfixe `rl:mcp`) s'applique après l'auth.
// Le proxy laisse passer cette route sans session à cookies (`sansSession`).

import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { verifierJetonMcp } from "@/lib/mcp/auth"
import { enregistrerOutilsEcriture, enregistrerOutilsLecture } from "@/lib/mcp/serveur"
import { limiteMcp } from "@/lib/rate-limit"
import { version } from "@/package.json"

const serveur = createMcpHandler(
  (server) => {
    enregistrerOutilsLecture(server)
    enregistrerOutilsEcriture(server) // #306, US-52
  },
  { serverInfo: { name: "omq", version } }
)

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

const handler = withMcpAuth(avecQuota, verifierJetonMcp, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
})

export { handler as GET, handler as POST, handler as DELETE }
