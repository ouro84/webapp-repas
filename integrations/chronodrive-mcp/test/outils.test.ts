// Outils MCP de l'exécuteur (#308, Task 4) : appelés par un vrai client MCP en mémoire, avec un
// client Chronodrive et un cache simulés. Aucun appel à Chronodrive, aucun fichier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { ErreurChronodrive } from "../src/client.ts";
import { normaliserTerme, type Correspondance, type EntreeCorrespondance } from "../src/correspondances.ts";
import { creerServeur, favorisPour, NOMS_OUTILS, type CacheCorrespondances, type Dependances } from "../src/outils.ts";
import { clientSimule, fiche, panierSimule, voir, type Route } from "./simulation.ts";
import { versProduit } from "../src/catalogue.ts";

const RECHERCHE = "GET /v1/products";
const FAVORIS = "GET /v1/favourite-products";

// Fiche du protocole avec un libellé et une marque choisis.
function produit(id: string, libelle: string, extra: Record<string, unknown> = {}, marque = "Marque") {
  return fiche(id, { labels: { productLabel: libelle, brandLabel: marque, unitQuantityLabel: "1 kg" }, ...extra });
}

function routesFavoris(fiches: Record<string, unknown>[]): Record<string, Route> {
  return { [FAVORIS]: () => ({ content: fiches, page: { hasNext: false } }) };
}

// Cache en mémoire, même normalisation que le vrai ; journal des appels pour les assertions.
function cacheSimule(initial: Record<string, { productId: string; libelle: string }> = {}) {
  const entrees = new Map<string, Correspondance>(
    Object.entries(initial).map(([terme, e]) => [normaliserTerme(terme), { ...e, vuLe: "2026-10-31T00:00:00.000Z" }]),
  );
  const oublies: string[] = [];
  const memorises: EntreeCorrespondance[][] = [];
  const cache: CacheCorrespondances = {
    connues(termes) {
      const trouvees = new Map<string, Correspondance>();
      for (const t of termes) {
        const e = entrees.get(normaliserTerme(t));
        if (e) trouvees.set(normaliserTerme(t), e);
      }
      return trouvees;
    },
    memoriser(lot) {
      memorises.push(lot);
      for (const e of lot) entrees.set(normaliserTerme(e.terme), { productId: e.productId, libelle: e.libelle, vuLe: "maintenant" });
    },
    oublier(terme) {
      oublies.push(terme);
      entrees.delete(normaliserTerme(terme));
    },
  };
  return { cache, entrees, oublies, memorises };
}

type Resultat = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };

async function demarrer(deps: Partial<Dependances> & Pick<Dependances, "client">) {
  const journal: string[] = [];
  const serveur = creerServeur({
    cache: () => cacheSimule().cache,
    lectureSeule: false,
    journal: (m) => journal.push(m),
    ...deps,
  });
  const [cote, autre] = InMemoryTransport.createLinkedPair();
  await serveur.connect(cote);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(autre);
  const appeler = async (nom: string, args: Record<string, unknown> = {}) =>
    (await mcp.callTool({ name: nom, arguments: args })) as Resultat;
  return { mcp, appeler, journal };
}

type ResultatTerme = {
  terme: string;
  cache: { id: string; disponible: boolean } | null;
  favoris: { id: string; disponible: boolean; raison: string | null }[];
  recherche: { id: string; disponible: boolean; raison: string | null }[];
  erreur: string | null;
};

function termes(r: Resultat): ResultatTerme[] {
  assert.ok(!r.isError, r.content[0]?.text);
  return (r.structuredContent as { resultats: ResultatTerme[] }).resultats;
}

test("chercher_produits : cache disponible → retenu, sans recherche", async () => {
  const sim = clientSimule({ ...routesFavoris([produit("10", "Lait demi-écrémé")]) });
  const cache = cacheSimule({ "Lait": { productId: "10", libelle: "Lait demi-écrémé" } });
  const { appeler } = await demarrer({ client: () => sim.client, cache: () => cache.cache });

  const r = await appeler("chercher_produits", { termes: ["lait"] });
  const [lait] = termes(r);
  assert.equal(lait.terme, "lait");
  assert.equal(lait.cache?.id, "10");
  // Cache retenu : ni favoris ni recherche renvoyés (charge utile réduite).
  assert.deepEqual(lait.favoris, []);
  assert.deepEqual(lait.recherche, []);
  assert.equal(sim.compter(RECHERCHE), 0);
  assert.deepEqual(cache.oublies, []);
  // Le texte porte le même JSON que structuredContent.
  assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
});

test("produits renvoyés au LLM sans prixUnite ni maxPanier (prix gardé)", async () => {
  const sim = clientSimule({
    ...routesFavoris([produit("12", "Beurre doux", { maxCartQuantity: 6 })]),
    [RECHERCHE]: () => ({ content: [produit("13", "Farine T55", { maxCartQuantity: 6 })] }),
    ...panierSimule("p1", { "12": 1 }).routes,
  });
  const { appeler } = await demarrer({ client: () => sim.client });
  const r = await appeler("chercher_produits", { termes: ["beurre", "farine"] });
  const [beurre, farine] = termes(r);
  const panier = await appeler("lire_panier");
  const { lignes } = panier.structuredContent as { lignes: { produit: Record<string, unknown> }[] };
  for (const p of [beurre.favoris[0], farine.recherche[0], lignes[0].produit] as unknown as Record<string, unknown>[]) {
    assert.ok(!("prixUnite" in p) && !("maxPanier" in p), JSON.stringify(p));
    assert.equal(p.prix, 2.5);
  }
});

test("chercher_produits : erreur de connexion → tout l'appel échoue, pas de login terme par terme", async () => {
  const sim = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: () => {
      throw new ErreurChronodrive("login", "HTTP 403 [cf-ray x, cf-mitigated challenge]");
    },
  });
  const { appeler } = await demarrer({ client: () => sim.client });
  const r = await appeler("chercher_produits", { termes: ["lait", "beurre", "farine"] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^login : HTTP 403/);
  assert.equal(sim.compter(RECHERCHE), 1);

  // Erreur d'un terme hors connexion : seul ce terme est en erreur.
  const sim2 = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: (_a, n) => {
      if (n === 1) throw new ErreurChronodrive("GET /v1/products", "HTTP 500");
      return { content: [produit("14", "Beurre")] };
    },
  });
  const { appeler: appeler2 } = await demarrer({ client: () => sim2.client });
  const [lait, beurre] = termes(await appeler2("chercher_produits", { termes: ["lait", "beurre"] }));
  assert.match(lait.erreur ?? "", /HTTP 500/);
  assert.equal(beurre.erreur, null);
});

test("chercher_produits : 401 persistant sur la recherche → tout l'appel échoue, logins bornés", async () => {
  // Le client simulé représente le vrai : chaque appel en 401 a déjà fait son unique reconnexion.
  // Un seul appel de recherche = un seul login de plus, quel que soit le nombre de termes.
  const sim = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: () => {
      throw new ErreurChronodrive("GET /v1/products", "HTTP 401 Unauthorized", 401);
    },
  });
  const { appeler } = await demarrer({ client: () => sim.client });
  const r = await appeler("chercher_produits", { termes: ["lait", "beurre", "farine"] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /HTTP 401/);
  assert.equal(sim.compter(RECHERCHE), 1);
});

test("favori montré à chargement + 29 min puis ajouté 2 min plus tard : accepté (relance de run)", async () => {
  const h = { t: 1_800_000_000_000 };
  const maintenant = () => h.t;
  const sim = clientSimule({ ...routesFavoris([produit("15", "Lait demi-écrémé")]), ...panierSimule("p1", {}).routes });
  const { appeler } = await demarrer({ client: () => sim.client, maintenant });

  termes(await appeler("chercher_produits", { termes: ["lait"] })); // chargement des favoris
  h.t += 29 * 60_000;
  const [lait] = termes(await appeler("chercher_produits", { termes: ["lait"] })); // favoris servis par la mémoire
  assert.deepEqual(lait.favoris.map((p) => p.id), ["15"]);
  assert.equal(sim.compter(FAVORIS), 1);
  h.t += 2 * 60_000;

  const a = await appeler("ajouter_au_panier", { lignes: [{ terme: "lait", productId: "15", quantite: 1 }] });
  assert.ok(!a.isError, a.content[0].text);
  const [ligne] = (a.structuredContent as { resultats: { confirme: boolean; erreur: string | null }[] }).resultats;
  assert.equal(ligne.erreur, null);
  assert.equal(ligne.confirme, true);
});

test("chercher_produits : cache indisponible → oublié, favoris puis recherche", async () => {
  const sim = clientSimule({
    ...routesFavoris([produit("10", "Lait entier", { stock: 0 }), produit("11", "Beurre doux")]),
    [RECHERCHE]: () => ({ content: [produit("20", "Lait demi-écrémé")] }),
  });
  const cache = cacheSimule({ lait: { productId: "10", libelle: "Lait entier" } });
  const { appeler } = await demarrer({ client: () => sim.client, cache: () => cache.cache });

  const [lait] = termes(await appeler("chercher_produits", { termes: ["Lait"] }));
  assert.equal(lait.cache, null);
  assert.deepEqual(cache.oublies, ["Lait"]);
  // Le favori correspondant est indisponible : gardé et marqué, et la recherche est lancée.
  assert.deepEqual(lait.favoris.map((p) => [p.id, p.disponible]), [["10", false]]);
  assert.deepEqual(lait.recherche.map((p) => p.id), ["20"]);
  const ordre = sim.appels.map((a) => `${a.methode} ${a.chemin}`);
  assert.ok(ordre.indexOf(FAVORIS) < ordre.indexOf(RECHERCHE));
  assert.equal(sim.appels.find((a) => a.chemin === "/v1/products")?.params?.searchTerm, "Lait");
});

test("chercher_produits : favori trouvé → pas de recherche", async () => {
  const sim = clientSimule({
    ...routesFavoris([produit("30", "Crème fraîche épaisse 30%", {}, "Elle & Vire"), produit("31", "Œufs frais de poules élevées en plein air x12")]),
    [RECHERCHE]: () => ({ content: [produit("40", "Pâte feuilletée")] }),
  });
  const { appeler } = await demarrer({ client: () => sim.client });

  const resultats = termes(await appeler("chercher_produits", { termes: ["creme fraiche", "œuf", "pâte feuilletée"] }));
  assert.deepEqual(resultats[0].favoris.map((p) => p.id), ["30"]);
  assert.deepEqual(resultats[0].recherche, []);
  assert.deepEqual(resultats[1].favoris.map((p) => p.id), ["31"]); // pluriel replié : œuf ↔ œufs
  assert.deepEqual(resultats[2].favoris, []);
  assert.deepEqual(resultats[2].recherche.map((p) => p.id), ["40"]);
  // Une seule recherche (le terme sans favori), un seul chargement des favoris pour le lot.
  assert.equal(sim.compter(RECHERCHE), 1);
  assert.equal(sim.compter(FAVORIS), 1);
});

test("favoris : mots significatifs du terme dans libellé + marque, 5 au plus, disponibles d'abord", () => {
  const favoris = [
    versProduit(produit("1", "Pâte à tartiner", {}, "Nutella")),
    versProduit(produit("2", "Coulis de tomates")),
    versProduit(produit("3", "Tomates cerises", { stock: 0 })),
    ...["4", "5", "6", "7", "8"].map((id) => versProduit(produit(id, `Tomates grappe ${id}`))),
  ];
  // « de » est un mot vide, « tomate » s'accorde avec « tomates ».
  assert.deepEqual(favorisPour("coulis de tomate", favoris).map((p) => p.id), ["2"]);
  // Marque comprise dans le texte comparé.
  assert.deepEqual(favorisPour("nutella", favoris).map((p) => p.id), ["1"]);
  // Tous les mots significatifs doivent figurer : « cerises » écarte les grappes.
  assert.deepEqual(favorisPour("tomates cerises", favoris).map((p) => p.id), ["3"]);
  const tomates = favorisPour("tomates", favoris);
  assert.equal(tomates.length, 5);
  assert.ok(tomates.every((p) => p.disponible), "les indisponibles passent après les disponibles");
  assert.deepEqual(favorisPour("  ", favoris), []);
});

test("chercher_produits marque l'indisponible", async () => {
  const sim = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: () => ({
      content: [produit("50", "Farine T55", { isEligible: false }), produit("51", "Farine T45"), produit("52", "Farine T65", { remainingStock: 0 })],
    }),
  });
  const { appeler } = await demarrer({ client: () => sim.client });

  const [farine] = termes(await appeler("chercher_produits", { termes: ["farine"] }));
  assert.deepEqual(
    farine.recherche.map((p) => [p.id, p.disponible]),
    [["50", false], ["51", true], ["52", false]],
  );
  assert.match(farine.recherche[0].raison ?? "", /isEligible/);
  assert.match(farine.recherche[2].raison ?? "", /rupture/);
});

test("chercher_produits : recherche plafonnée à 8 résultats", async () => {
  const sim = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: () => ({ content: Array.from({ length: 12 }, (_, i) => produit(String(60 + i), `Riz ${i}`)) }),
  });
  const { appeler } = await demarrer({ client: () => sim.client });
  const [riz] = termes(await appeler("chercher_produits", { termes: ["riz"] }));
  assert.equal(riz.recherche.length, 8);
});

test("ajouter_au_panier : lecture seule → refus sans appel", async () => {
  const sim = clientSimule({});
  let clientsCrees = 0;
  const cache = cacheSimule();
  const { appeler } = await demarrer({
    client: () => {
      clientsCrees++;
      return sim.client;
    },
    cache: () => cache.cache,
    lectureSeule: true,
  });

  const r = await appeler("ajouter_au_panier", { lignes: [{ terme: "lait", productId: "10", quantite: 1 }] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /lecture seule/);
  assert.equal(sim.appels.length, 0);
  assert.equal(clientsCrees, 0);
  assert.deepEqual(cache.memorises, []);
});

test("ajouter_au_panier : confirmé → mémorisé ; non confirmé → pas mémorisé", async () => {
  // Le produit 20 renvoie SUCCESS sans que la quantité bouge : non confirmé (RG-83).
  const panier = panierSimule("p1", { "10": 1 }, (productId, q) => ({ returnType: "SUCCESS", increment: productId === "20" ? 0 : q }));
  const sim = clientSimule({
    ...panier.routes,
    ...routesFavoris([produit("10", "Lait demi-écrémé"), produit("20", "Beurre doux")]),
  });
  const cache = cacheSimule();
  const { appeler } = await demarrer({ client: () => sim.client, cache: () => cache.cache });
  // Les fiches vues (seules acceptées à l'ajout) viennent de la recherche qui précède l'ajout dans un run.
  termes(await appeler("chercher_produits", { termes: ["lait", "beurre"] }));

  const r = await appeler("ajouter_au_panier", {
    lignes: [
      { terme: "Lait", productId: "10", quantite: 2 },
      { terme: "beurre", productId: "20", quantite: 1 },
    ],
  });
  assert.ok(!r.isError, r.content[0].text);
  const resultats = (r.structuredContent as { resultats: Record<string, unknown>[] }).resultats;
  assert.deepEqual(
    resultats.map((x) => [x.terme, x.productId, x.avant, x.apres, x.confirme]),
    [
      ["Lait", "10", 1, 3, true],
      ["beurre", "20", 0, 0, false],
    ],
  );
  // Libellé de la fiche du panier relu après l'ajout (« Produit 10 » dans la simulation), jamais le productId.
  assert.deepEqual(cache.memorises, [[{ terme: "Lait", productId: "10", libelle: "Produit 10" }]]);
});

test("ajouter_au_panier : productId jamais vu → refusé sans POST", async () => {
  const sim = clientSimule(panierSimule("p1", {}).routes);
  const cache = cacheSimule();
  const { appeler } = await demarrer({ client: () => sim.client, cache: () => cache.cache });
  const r = await appeler("ajouter_au_panier", { lignes: [{ terme: "lait", productId: "999", quantite: 1 }] });
  assert.ok(!r.isError, r.content[0].text);
  const [ligne] = (r.structuredContent as { resultats: { confirme: boolean; erreur: string }[] }).resultats;
  assert.equal(ligne.confirme, false);
  assert.equal(ligne.erreur, "produit inconnu ou vu il y a plus de 30 min : relance chercher_produits");
  assert.equal(sim.compter("POST /v1/carts/p1/items"), 0);
  assert.deepEqual(cache.memorises, []);
});

test("ajouter_au_panier : schéma — quantité entière 1..20, 20 lignes au plus", async () => {
  const sim = clientSimule({});
  const { appeler } = await demarrer({ client: () => sim.client });
  const ligne = { terme: "lait", productId: "10", quantite: 1 };

  for (const lignes of [[{ ...ligne, quantite: 21 }], [{ ...ligne, quantite: 0 }], [{ ...ligne, quantite: 1.5 }], [], Array(21).fill(ligne)]) {
    const r = await appeler("ajouter_au_panier", { lignes });
    assert.equal(r.isError, true, JSON.stringify(lignes).slice(0, 80));
  }
  assert.equal(sim.appels.length, 0);
});

test("ajouter_au_panier : deux appels parallèles sont exécutés l'un après l'autre", async () => {
  const panier = panierSimule("p1", {});
  const lent: Route = async (appel, n) => {
    await new Promise((r) => setTimeout(r, 20));
    return panier.routes["POST /v1/carts/p1/items"](appel, n);
  };
  const sim = clientSimule({ ...panier.routes, "POST /v1/carts/p1/items": lent });
  voir(sim.client, ["10", "20"]);
  const { appeler } = await demarrer({ client: () => sim.client });

  const [a, b] = await Promise.all([
    appeler("ajouter_au_panier", { lignes: [{ terme: "lait", productId: "10", quantite: 1 }] }),
    appeler("lire_panier"),
    appeler("ajouter_au_panier", { lignes: [{ terme: "beurre", productId: "20", quantite: 1 }] }),
  ]).then(([x, lecture, y]) => {
    assert.ok(!lecture.isError, lecture.content[0].text);
    return [x, y];
  });
  const lecture = ["GET /v1/customers/me/carts", "GET /v1/carts/p1"];
  const lot = [...lecture, "POST /v1/carts/p1/items", ...lecture];
  // Sans sérialisation, les relectures « avant » et `lire_panier` passeraient avant le premier POST.
  assert.deepEqual(sim.appels.map((x) => `${x.methode} ${x.chemin}`), [...lot, ...lecture, ...lot]);
  for (const r of [a, b]) {
    const [ligne] = (r.structuredContent as { resultats: { confirme: boolean }[] }).resultats;
    assert.equal(ligne.confirme, true);
  }
});

test("ajouter_au_panier : un lot en échec ne bloque pas le suivant", async () => {
  let echec = true;
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/customers/me/carts": () => {
      if (echec) {
        echec = false;
        throw new ErreurChronodrive("GET /v1/customers/me/carts", "HTTP 503");
      }
      return { content: [{ id: "p1" }] };
    },
  });
  voir(sim.client, ["10"]);
  const { appeler } = await demarrer({ client: () => sim.client });
  const ligne = { terme: "lait", productId: "10", quantite: 1 };
  const [a, b] = await Promise.all([appeler("ajouter_au_panier", { lignes: [ligne] }), appeler("ajouter_au_panier", { lignes: [ligne] })]);
  assert.equal(a.isError, true);
  assert.match(a.content[0].text, /HTTP 503/);
  assert.ok(!b.isError, b.content[0].text);
  assert.equal((b.structuredContent as { resultats: { confirme: boolean }[] }).resultats[0].confirme, true);
});

test("annotations : chercher_produits n'est pas en lecture seule (il peut oublier une entrée du cache)", async () => {
  const { mcp } = await demarrer({ client: () => clientSimule({}).client });
  const { tools } = await mcp.listTools();
  const annotation = (nom: string) => tools.find((t) => t.name === nom)?.annotations?.readOnlyHint;
  assert.equal(annotation("chercher_produits"), false);
  assert.equal(annotation("lire_panier"), true);
  assert.equal(annotation("ajouter_au_panier"), false);
});

test("lire_panier : lignes avec fiche et quantité", async () => {
  const sim = clientSimule(panierSimule("p1", { "10": 2, "11": 1 }).routes);
  const { appeler } = await demarrer({ client: () => sim.client });
  const r = await appeler("lire_panier");
  assert.ok(!r.isError, r.content[0].text);
  const { lignes } = r.structuredContent as { lignes: { produit: { id: string; libelle: string }; quantite: number }[] };
  assert.deepEqual(lignes.map((l) => [l.produit.id, l.produit.libelle, l.quantite]), [["10", "Produit 10", 2], ["11", "Produit 11", 1]]);
});

test("correspondances_connues et memoriser_correspondances : exposition directe du cache", async () => {
  const sim = clientSimule({});
  const cache = cacheSimule({ lait: { productId: "10", libelle: "Lait demi-écrémé" } });
  const { appeler } = await demarrer({ client: () => sim.client, cache: () => cache.cache });

  const m = await appeler("memoriser_correspondances", { entrees: [{ terme: "Beurre", productId: "20", libelle: "Beurre doux" }] });
  assert.ok(!m.isError, m.content[0].text);
  assert.equal((m.structuredContent as { memorisees: number }).memorisees, 1);

  const c = await appeler("correspondances_connues", { termes: ["LAIT", "beurre", "sel"] });
  assert.ok(!c.isError, c.content[0].text);
  const liste = (c.structuredContent as { correspondances: { terme: string; correspondance: { productId: string } | null }[] }).correspondances;
  assert.deepEqual(liste.map((x) => [x.terme, x.correspondance?.productId ?? null]), [["LAIT", "10"], ["beurre", "20"], ["sel", null]]);
  assert.equal(sim.appels.length, 0);
});

test("erreur du cache non bloquante : journal sur stderr, l'outil continue sans cache", async () => {
  const sim = clientSimule({
    ...routesFavoris([]),
    [RECHERCHE]: () => ({ content: [produit("20", "Lait")] }),
    ...panierSimule("p1", {}).routes,
  });
  const casse: CacheCorrespondances = {
    connues: () => {
      throw new Error("database is locked");
    },
    memoriser: () => {
      throw new Error("database is locked");
    },
    oublier: () => {
      throw new Error("database is locked");
    },
  };
  const { appeler, journal } = await demarrer({ client: () => sim.client, cache: () => casse });

  const r = await appeler("chercher_produits", { termes: ["lait"] });
  const [lait] = termes(r);
  assert.deepEqual(lait.recherche.map((p) => p.id), ["20"]);
  assert.match(String(r.structuredContent?.avertissement), /cache/);

  const a = await appeler("ajouter_au_panier", { lignes: [{ terme: "lait", productId: "20", quantite: 1 }] });
  assert.ok(!a.isError, a.content[0].text);
  assert.equal((a.structuredContent as { resultats: { confirme: boolean }[] }).resultats[0].confirme, true);

  // Ouverture du cache impossible : même traitement.
  const { appeler: appeler2, journal: journal2 } = await demarrer({
    client: () => sim.client,
    cache: () => {
      throw new Error("unable to open database file");
    },
  });
  assert.ok(!(await appeler2("chercher_produits", { termes: ["lait"] })).isError);

  assert.ok(journal.length >= 2 && journal.every((l) => /cache/.test(l)));
  assert.ok(journal2.some((l) => /unable to open/.test(l)));
});

test("erreur étrangère : message générique et nom seulement, jamais le message d'origine", async () => {
  const secret = "https://connect.chronodrive.com/oauth/authorize?tkn=SECRET-TKN-123";
  const sim = clientSimule({
    [FAVORIS]: () => {
      throw new TypeError(`fetch failed ${secret}`, { cause: new Error(secret) });
    },
  });
  const { appeler } = await demarrer({ client: () => sim.client });
  const r = await appeler("chercher_produits", { termes: ["lait"] });
  assert.equal(r.isError, true);
  assert.ok(!r.content[0].text.includes("SECRET"), r.content[0].text);
  assert.match(r.content[0].text, /TypeError/);

  // Erreur du client (déjà caviardée) : son message est transmis tel quel.
  const sim2 = clientSimule({});
  const { appeler: appeler2 } = await demarrer({
    client: () => {
      throw new ErreurChronodrive("config", "variable CHRONODRIVE_EMAIL absente (/opt/data/chronodrive.env ou environnement)");
    },
  });
  const r2 = await appeler2("lire_panier");
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /CHRONODRIVE_EMAIL absente/);
  assert.equal(sim2.appels.length, 0);
});

test("aucun outil de retrait, commande, créneau ou paiement", async () => {
  let clientsCrees = 0;
  const { mcp } = await demarrer({
    client: () => {
      clientsCrees++;
      throw new Error("ne doit pas être créé pour lister les outils");
    },
  });
  const { tools } = await mcp.listTools();
  const noms = tools.map((t) => t.name).sort();
  assert.deepEqual(noms, ["ajouter_au_panier", "chercher_produits", "correspondances_connues", "lire_panier", "memoriser_correspondances"]);
  assert.deepEqual([...NOMS_OUTILS].sort(), noms);
  for (const nom of noms) {
    assert.doesNotMatch(nom, /retir|suppr|enlev|vider|command|valid|creneau|paie|payer|order|checkout|slot|pay|remove|delete/i);
  }
  // Client créé paresseusement : lister les outils ne lit ni identifiants ni réseau.
  assert.equal(clientsCrees, 0);
});
