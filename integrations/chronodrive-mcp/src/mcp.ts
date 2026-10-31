// Point d'entrée du MCP stdio de l'exécuteur Chronodrive (#308), lancé par Hermes sur le NAS :
// `node /opt/data/chronodrive-mcp/src/mcp.ts`. stdout est le canal JSON-RPC : aucun log n'y part
// (journal sur stderr seulement). RG-82 : outils listés dans src/outils.ts, aucun outil de commande.
// Lecture seule par défaut : `ajouter_au_panier` n'écrit que si `CHRONODRIVE_LECTURE_SEULE` vaut
// exactement `'0'` ; absente, vide ou toute autre valeur, il est refusé sans appel API.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { fabriqueClient } from "./client.ts";
import { cheminCache, Correspondances } from "./correspondances.ts";
import { creerServeur } from "./outils.ts";

// Client et cache créés au premier outil qui en a besoin : `initialize` et `tools/list` répondent
// sans identifiants ni réseau. Un échec n'est pas mémorisé, l'appel suivant réessaie. Le client est
// recréé quand `chronodrive.env` change (mtime vérifié à chaque appel d'outil) : le processus vit
// aussi longtemps que la gateway Hermes.
let cache: Correspondances | null = null;

const serveur = creerServeur({
  client: fabriqueClient(),
  cache: () => (cache ??= new Correspondances(cheminCache())),
  lectureSeule: process.env.CHRONODRIVE_LECTURE_SEULE !== "0",
});

process.on("exit", () => {
  try {
    cache?.fermer();
  } catch {
    // Fermeture en fin de processus : rien à faire de plus.
  }
});

await serveur.connect(new StdioServerTransport());
