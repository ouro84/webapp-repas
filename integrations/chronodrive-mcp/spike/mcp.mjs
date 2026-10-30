// Spike #307 — MCP stdio Chronodrive pour Hermes (jetable, remplacé par #308).
// 5 outils, aucun outil de commande, créneau ni paiement (RG-82).
// CHRONODRIVE_LECTURE_SEULE=1 : ajout et retrait refusés sans appel API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  chargerEnv,
  ouvrirSession,
  lirePanier,
  ajouterAuPanier,
  retirerDuPanier,
  listerFavoris,
  rechercherProduits,
} from "./client.mjs";

chargerEnv();
const lectureSeule = process.env.CHRONODRIVE_LECTURE_SEULE === "1";

const serveur = new McpServer({ name: "chronodrive-spike", version: "0.0.1" });

function outil(nom, description, schema, executer, ecriture = false) {
  serveur.registerTool(nom, { description, inputSchema: schema }, async (args) => {
    try {
      if (ecriture && lectureSeule) throw new Error("lecture seule : ajout et retrait désactivés (CHRONODRIVE_LECTURE_SEULE=1)");
      const resultat = await executer(await ouvrirSession(), args);
      return { content: [{ type: "text", text: JSON.stringify(resultat) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: e.message }] };
    }
  });
}

outil(
  "lister_favoris",
  "Liste les produits favoris du compte Chronodrive (achats habituels des 6 derniers mois). À appeler une seule fois par run, avant toute recherche.",
  {},
  (s) => listerFavoris(s),
);
outil(
  "rechercher_produits",
  "Recherche des produits dans le catalogue du drive. `disponible: false` = hors stock ou non commandable.",
  { terme: z.string().min(2).describe("Terme de recherche, ex. « lait demi-écrémé »") },
  (s, { terme }) => rechercherProduits(s, terme),
);
outil("voir_panier", "Contenu du panier Chronodrive courant.", {}, (s) => lirePanier(s));
outil(
  "ajouter_au_panier",
  "Ajoute un produit au panier. Attention : la quantité s'AJOUTE à celle déjà présente.",
  { productId: z.string(), quantite: z.number().int().min(1).max(20) },
  async (s, { productId, quantite }) => {
    await ajouterAuPanier(s, productId, quantite);
    return { ok: true };
  },
  true,
);
outil(
  "retirer_du_panier",
  "Retire entièrement un produit du panier.",
  { productId: z.string() },
  async (s, { productId }) => {
    await retirerDuPanier(s, productId);
    return { ok: true };
  },
  true,
);

await serveur.connect(new StdioServerTransport());
