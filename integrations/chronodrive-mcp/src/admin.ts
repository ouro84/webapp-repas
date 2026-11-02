// Serveur MCP `chronodrive-admin` (#320, RG-82) : un seul outil, `vider_panier`, hors du serveur
// `chronodrive` (celui du run webhook, sans aucun outil de retrait). Réservé à Telegram, sur demande
// explicite d'Arnaud. Jamais de commande, de créneau ni de paiement.
// stdout est le canal JSON-RPC du MCP : rien n'y est écrit ici. Pièges : .claude/rules/chronodrive.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Appelant } from "./catalogue.ts";
import { ErreurOutil, messagePourLeLlm } from "./outils.ts";
import { viderPanier } from "./panier.ts";
import { formaterBilan } from "./vider-panier.ts";

export const NOMS_OUTILS_ADMIN = ["vider_panier"] as const;

export const LECTURE_SEULE_ADMIN = "Lecture seule : CHRONODRIVE_LECTURE_SEULE ne vaut pas '0', rien n’est retiré.";

export type DependancesAdmin = {
  // Fabrique appelée à chaque appel d'outil : `initialize` et `tools/list` ne lisent ni identifiants
  // ni réseau (même contrat que `creerServeur`, src/outils.ts).
  client: () => Appelant;
  lectureSeule: boolean;
};

const DESCRIPTION = [
  "Vide le panier Chronodrive courant (retire toutes les lignes), en deux temps.",
  "À n'utiliser que sur demande explicite de l'utilisateur sur Telegram.",
  "Si un remplissage du panier est peut-être en cours (carte « Panier en cours… » sur /courses), demande d'abord à l'utilisateur et attends le compte-rendu.",
  "1. Appelle d'abord SANS `confirmation` : rien n'est retiré, l'outil renvoie les lignes du panier et un `jeton`. Montre ces lignes à l'utilisateur et attends un « oui » explicite.",
  "2. Seulement après ce « oui », rappelle avec `confirmation` = le `jeton` reçu. Si le panier a changé depuis l'aperçu, le vidage est refusé : refais un aperçu.",
  "Ne passe ni commande ni créneau, et ne paie rien.",
].join("\n");

// Aperçu (sans `confirmation`) : lecture + simulation, aucun DELETE. Confirmation : lecture seule
// refusée d'abord (aucun appel API), puis vidage lié au jeton de l'aperçu (RG-82, #320).
export function creerServeurAdmin(deps: DependancesAdmin): McpServer {
  const serveur = new McpServer({ name: "chronodrive-admin", version: "1.0.0" });

  const inputSchema = {
    confirmation: z.string().max(200).optional().describe("Jeton renvoyé par l'aperçu, à ne passer qu'après un « oui » explicite de l'utilisateur. Absent : aperçu seul."),
  };

  const rappel = async ({ confirmation }: { confirmation?: string }) => {
    try {
      // Normalisé : un jeton recopié avec des espaces ou des majuscules reste valable ; vide = aperçu.
      const jeton = confirmation?.trim().toLowerCase() ?? "";
      let contenu: Record<string, unknown>;
      if (jeton === "") {
        const bilan = await viderPanier(deps.client(), { simulation: true });
        contenu = {
          etape: "apercu",
          jeton: bilan.jeton,
          lignes: bilan.lignes.map((l) => ({ libelle: l.libelle, marque: l.marque, quantite: l.quantite })),
          message: formaterBilan(bilan),
        };
      } else {
        // Avant tout appel API : en lecture seule, même la lecture du panier est inutile.
        if (deps.lectureSeule) throw new ErreurOutil(LECTURE_SEULE_ADMIN);
        const bilan = await viderPanier(deps.client(), { simulation: false, jetonAttendu: jeton });
        contenu = { etape: "vidage", vide: bilan.vide, relu: bilan.relu, restantes: bilan.restantes, message: formaterBilan(bilan) };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(contenu) }], structuredContent: contenu };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: messagePourLeLlm(e) }] };
    }
  };

  // Les génériques zod de registerTool ne se résolvent pas bien ici : cast, comme dans src/outils.ts.
  (serveur.registerTool as (n: string, c: object, r: typeof rappel) => unknown)(
    NOMS_OUTILS_ADMIN[0],
    { description: DESCRIPTION, inputSchema, annotations: { destructiveHint: true, readOnlyHint: false } },
    rappel,
  );
  return serveur;
}
