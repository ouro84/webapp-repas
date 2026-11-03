// Serveur MCP distant d'OMQ (#305, US-50/51, RG-71, RG-78, ADR-11).
//
// Auth, quota et 429 vivent dans la fabrique partagée `creerRouteMcp`
// (`lib/mcp/route.ts`). Les outils du run de panier sont sur /api/mcp/executeur
// (#330).

import { enregistrerOutilsEcriture, enregistrerOutilsLecture } from "@/lib/mcp/serveur"
import { creerRouteMcp } from "@/lib/mcp/route"

const handler = creerRouteMcp(
  (server) => {
    enregistrerOutilsLecture(server)
    enregistrerOutilsEcriture(server) // #306, US-52
  },
  "omq",
  "/.well-known/oauth-protected-resource/api/mcp"
)

export { handler as GET, handler as POST, handler as DELETE }
