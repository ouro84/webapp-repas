// Point d'entrée du MCP stdio `chronodrive-admin` (#320, RG-82), lancé par Hermes sur le NAS :
// `node /opt/data/chronodrive-mcp/src/mcp-admin.ts`. Un seul outil, `vider_panier`, listé dans le seul
// `platform_toolsets.telegram` (jamais WhatsApp ni la route `panier-omq`). stdout est le canal
// JSON-RPC : aucun log n'y part (journal sur stderr seulement).
// Lecture seule par défaut : la confirmation du vidage n'agit que si `CHRONODRIVE_LECTURE_SEULE` vaut
// exactement `'0'` ; absente, vide ou toute autre valeur, elle est refusée sans appel API.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { creerServeurAdmin } from "./admin.ts";
import { fabriqueClient } from "./client.ts";

// Client créé au premier appel d'outil : `initialize` et `tools/list` répondent sans identifiants
// ni réseau (`fabriqueClient`, src/client.ts).
const serveur = creerServeurAdmin({
  client: fabriqueClient(),
  lectureSeule: process.env.CHRONODRIVE_LECTURE_SEULE !== "0",
});

await serveur.connect(new StdioServerTransport());
