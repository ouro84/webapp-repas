// Serveur MCP dédié au run de l'exécuteur de panier (#330, RG-83, RG-85).
//
// Trois outils seulement (prise signée, coche sur le cycle de la demande prise,
// rapport), derrière la même auth OAuth et le même quota que /api/mcp. Pourquoi :
// un run léger a sauté la prise et inventé une ancre sur l'endpoint général ;
// l'exécuteur n'y voit plus rien d'autre que son parcours.

import { enregistrerOutilsExecuteur } from "@/lib/mcp/serveur"
import { creerRouteMcp } from "@/lib/mcp/route"

const handler = creerRouteMcp(
  enregistrerOutilsExecuteur,
  "omq-executeur",
  "/.well-known/oauth-protected-resource/api/mcp/executeur"
)

export { handler as GET, handler as POST, handler as DELETE }
