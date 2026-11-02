// Serveur MCP `chronodrive-admin` (#320, RG-82) : l'outil `vider_panier` en deux temps, appelé par un
// vrai client MCP en mémoire, avec un client Chronodrive simulé. Aucun réseau, aucun fichier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { creerServeurAdmin, LECTURE_SEULE_ADMIN, NOMS_OUTILS_ADMIN } from "../src/admin.ts";
import { ErreurChronodrive } from "../src/client.ts";
import { messagePourLeLlm } from "../src/outils.ts";
import { ErreurPanierChange, jetonPanier, PANIER_CHANGE } from "../src/panier.ts";
import { clientSimule, panierSimule, type Route } from "./simulation.ts";

type Resultat = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };

async function demarrer(routes: Record<string, Route>, lectureSeule = false) {
  const simule = clientSimule(routes);
  const serveur = creerServeurAdmin({ client: () => simule.client, lectureSeule });
  const [cote, autre] = InMemoryTransport.createLinkedPair();
  await serveur.connect(cote);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(autre);
  const vider = async (args: Record<string, unknown> = {}) => (await mcp.callTool({ name: "vider_panier", arguments: args })) as Resultat;
  const suppressions = () => simule.appels.filter((a) => a.methode === "DELETE");
  return { mcp, vider, simule, suppressions };
}

const jetonDuPanier = () => jetonPanier({ id: "42", lignes: new Map([["10", 2], ["11", 1]]) });

test("tools/list : exactement vider_panier, annoté destructif", async () => {
  const { mcp } = await demarrer(panierSimule("42", { "10": 2, "11": 1 }).routes);
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["vider_panier"]);
  assert.deepEqual([...NOMS_OUTILS_ADMIN], ["vider_panier"]);
  assert.equal(tools[0].annotations?.destructiveHint, true);
  assert.equal(tools[0].annotations?.readOnlyHint, false);
});

test("aperçu sans confirmation : aucun DELETE, lignes et jeton", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", { "10": 2, "11": 1 }).routes);
  const r = await vider();
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.etape, "apercu");
  assert.equal(r.structuredContent?.jeton, jetonDuPanier());
  assert.deepEqual(r.structuredContent?.lignes, [
    { libelle: "Produit 10", marque: "Marque", quantite: 2 },
    { libelle: "Produit 11", marque: "Marque", quantite: 1 },
  ]);
  assert.equal(suppressions().length, 0);
});

test("confirmation vide ou blanche : traitée comme un aperçu", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", { "10": 2 }).routes);
  for (const confirmation of ["", "   "]) {
    const r = await vider({ confirmation });
    assert.equal(r.structuredContent?.etape, "apercu");
  }
  assert.equal(suppressions().length, 0);
});

test("aperçu d'un panier vide : « Panier déjà vide. »", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", {}).routes);
  const r = await vider();
  assert.equal(r.structuredContent?.etape, "apercu");
  assert.deepEqual(r.structuredContent?.lignes, []);
  assert.equal(r.structuredContent?.message, "Panier déjà vide.");
  assert.equal(suppressions().length, 0);
});

test("confirmation avec le bon jeton : lignes retirées, panier relu vide", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", { "10": 2, "11": 1 }).routes);
  const r = await vider({ confirmation: jetonDuPanier() });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.etape, "vidage");
  assert.equal(r.structuredContent?.vide, true);
  assert.equal(r.structuredContent?.relu, true);
  assert.equal(r.structuredContent?.restantes, 0);
  assert.match(String(r.structuredContent?.message), /^Panier vidé : /m);
  assert.deepEqual(suppressions().map((a) => a.chemin), ["/v1/carts/42/items/10", "/v1/carts/42/items/11"]);
});

test("confirmation avec le jeton du panier vide : étape vidage, « Panier déjà vide. », aucune suppression", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", {}).routes);
  const jeton = jetonPanier({ id: "42", lignes: new Map() });
  const r = await vider({ confirmation: jeton });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent?.etape, "vidage");
  assert.equal(r.structuredContent?.vide, true);
  assert.equal(r.structuredContent?.message, "Panier déjà vide.");
  assert.equal(suppressions().length, 0);
});

test("description : consigne actionnable si un remplissage est peut-être en cours", async () => {
  const { mcp } = await demarrer(panierSimule("42", { "10": 2 }).routes);
  const { tools } = await mcp.listTools();
  const description = tools[0].description ?? "";
  assert.match(description, /remplissage du panier est peut-être en cours/);
  assert.match(description, /Panier en cours…/);
  assert.match(description, /attends le compte-rendu/);
  assert.doesNotMatch(description, /jamais pendant un run/);
});

test("confirmation normalisée : espaces et majuscules ignorés", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", { "10": 2, "11": 1 }).routes);
  const r = await vider({ confirmation: `  ${jetonDuPanier().toUpperCase()}\n` });
  assert.equal(r.structuredContent?.etape, "vidage");
  assert.equal(suppressions().length, 2);
});

test("confirmation avec un jeton périmé : refus PANIER_CHANGE, aucun DELETE", async () => {
  const { vider, suppressions } = await demarrer(panierSimule("42", { "10": 2, "11": 1 }).routes);
  const r = await vider({ confirmation: "0123456789abcdef" });
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, PANIER_CHANGE);
  assert.equal(suppressions().length, 0);
});

test("confirmation sur panier modifié depuis l'aperçu : refus, aucun DELETE", async () => {
  const { etat, routes } = panierSimule("42", { "10": 2, "11": 1 });
  const { vider, suppressions } = await demarrer(routes);
  const apercu = await vider();
  etat.set("10", 3); // ajout à la main dans l'appli entre l'aperçu et la confirmation
  const r = await vider({ confirmation: String(apercu.structuredContent?.jeton) });
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, PANIER_CHANGE);
  assert.equal(suppressions().length, 0);
});

test("confirmation en lecture seule : refusée sans aucun appel API ; l'aperçu marche", async () => {
  const { vider, simule, suppressions } = await demarrer(panierSimule("42", { "10": 2 }).routes, true);
  const r = await vider({ confirmation: "0123456789abcdef" });
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, LECTURE_SEULE_ADMIN);
  assert.equal(simule.appels.length, 0);

  const apercu = await vider();
  assert.equal(apercu.structuredContent?.etape, "apercu");
  assert.equal(suppressions().length, 0);
});

test("erreur de connexion : message de messagePourLeLlm, sans secret", async () => {
  const connexion = new ErreurChronodrive("login", "connexion refusée");
  const { vider } = await demarrer({
    "GET /v1/customers/me/carts": () => {
      throw connexion;
    },
  });
  const r = await vider();
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, messagePourLeLlm(connexion));

  const etrangere = await demarrer({
    "GET /v1/customers/me/carts": () => {
      throw new Error("https://chronodrive.test/x?tkn=SECRET123");
    },
  });
  const e = await etrangere.vider();
  assert.equal(e.isError, true);
  assert.doesNotMatch(e.content[0].text, /SECRET123|tkn/);
});

test("messagePourLeLlm livre tel quel le message d'une ErreurPanierChange", () => {
  assert.equal(messagePourLeLlm(new ErreurPanierChange()), PANIER_CHANGE);
});
