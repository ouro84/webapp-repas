// Catalogue de l'exécuteur (#308, Task 2) : fiche produit, disponibilité, favoris, recherche.
// Client simulé (test/simulation.ts) : aucun appel à Chronodrive.
import { test } from "node:test";
import assert from "node:assert/strict";

import { chargerFavoris, PAGES_FAVORIS_MAX, rechercher, versProduit } from "../src/catalogue.ts";
import { ErreurChronodrive } from "../src/client.ts";
import { clientSimule, fiche } from "./simulation.ts";

test("fiche produit du protocole → Produit", () => {
  assert.deepEqual(
    versProduit({
      id: 123456,
      labels: { productLabel: "  Lait demi-écrémé UHT ", brandLabel: "Lactel", unitQuantityLabel: "6 x 1 L" },
      prices: { defaultPrice: 6.84, pricePerUnitMeasure: "1,14 €/L" },
      flags: { isOrganic: true },
      isEligible: true,
      remainingStock: 40,
      maxCartQuantity: 12,
    }),
    {
      id: "123456",
      libelle: "Lait demi-écrémé UHT",
      marque: "Lactel",
      contenance: "6 x 1 L",
      prix: 6.84,
      prixUnite: "1,14 €/L",
      bio: true,
      disponible: true,
      raison: null,
      maxPanier: 12,
    },
  );
  // Champs absents : valeurs nulles, et disponibilité inconnue qui ne bloque pas.
  assert.deepEqual(versProduit({ id: "9", labels: { productLabel: "Sel" } }), {
    id: "9",
    libelle: "Sel",
    marque: null,
    contenance: null,
    prix: null,
    prixUnite: null,
    bio: false,
    disponible: true,
    raison: null,
    maxPanier: null,
  });
  assert.equal(versProduit(null).id, "");
});

test("indisponible : isEligible false, stock nul, quantité > maxCartQuantity", () => {
  const nonEligible = versProduit(fiche("1", { isEligible: false }));
  assert.equal(nonEligible.disponible, false);
  assert.match(nonEligible.raison ?? "", /éligible/);

  const rupture = versProduit(fiche("2", { stock: 0 }));
  assert.equal(rupture.disponible, false);
  assert.match(rupture.raison ?? "", /stock/);

  // remainingStock l'emporte sur stock quand il est présent.
  assert.equal(versProduit(fiche("3", { stock: 10, remainingStock: 0 })).disponible, false);
  assert.equal(versProduit(fiche("4", { stock: 0, remainingStock: 3 })).disponible, true);
  // Stock non renseigné (ou non numérique) : inconnu, ne bloque pas.
  assert.equal(versProduit(fiche("5", { stock: undefined })).disponible, true);
  assert.equal(versProduit(fiche("6", { stock: "?" })).disponible, true);

  // Même une unité dépasse maxCartQuantity : 1 > 0.
  const plafondNul = versProduit(fiche("7", { maxCartQuantity: 0 }));
  assert.equal(plafondNul.disponible, false);
  assert.match(plafondNul.raison ?? "", /maxCartQuantity/);
  assert.equal(plafondNul.maxPanier, 0);
});

test("favoris paginés jusqu'à hasNext=false", async () => {
  const sim = clientSimule({
    "GET /v1/favourite-products": (appel, n) => ({
      content: n === 3 ? [fiche("5")] : [fiche(String(2 * n - 1)), fiche(String(2 * n))],
      page: { number: n, hasNext: n < 3 },
    }),
  });

  const favoris = await chargerFavoris(sim.client);
  assert.deepEqual(
    favoris.map((p) => p.id),
    ["1", "2", "3", "4", "5"],
  );
  const appels = sim.appels.filter((a) => a.chemin === "/v1/favourite-products");
  assert.deepEqual(
    appels.map((a) => a.params),
    [
      { page: "1", size: "50" },
      { page: "2", size: "50" },
      { page: "3", size: "50" },
    ],
  );
  assert.ok(appels.every((a) => a.service === "FAVOURITE_PRODUCTS"));

  // Gardés en mémoire (30 min) : le second appel reprend la mémoire.
  assert.equal(await chargerFavoris(sim.client), favoris);
  assert.equal(sim.compter("GET /v1/favourite-products"), 3);
});

test("favoris : un échec n'est pas mémorisé, l'appel suivant recharge", async () => {
  const sim = clientSimule({
    "GET /v1/favourite-products": (_a, n) => {
      if (n === 1) throw new Error("HTTP 500");
      return { content: [fiche("8")], page: { hasNext: false } };
    },
  });
  await assert.rejects(chargerFavoris(sim.client), /HTTP 500/);
  assert.deepEqual(
    (await chargerFavoris(sim.client)).map((p) => p.id),
    ["8"],
  );
});

test("favoris : hasNext toujours vrai → erreur explicite après 100 pages, jamais une liste tronquée", async () => {
  const sim = clientSimule({
    "GET /v1/favourite-products": (_a, n) => ({ content: [fiche(String(n))], page: { hasNext: true } }),
  });
  await assert.rejects(chargerFavoris(sim.client), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.match(e.message, /plus de 100 pages de favoris/);
    return true;
  });
  assert.equal(sim.compter("GET /v1/favourite-products"), PAGES_FAVORIS_MAX);
});

test("recherche : en-têtes Kamino et paramètres du protocole", async () => {
  const sim = clientSimule(
    {
      "GET /v1/products": () => ({ content: [fiche("11"), fiche("12", { remainingStock: 0 }), { labels: {} }] }),
    },
    "client-42",
  );
  const produits = await rechercher(sim.client, "lait demi-écrémé", 8);

  // Fiche sans id écartée, indisponible gardé et marqué.
  assert.deepEqual(
    produits.map((p) => [p.id, p.disponible]),
    [
      ["11", true],
      ["12", false],
    ],
  );
  const [appel] = sim.appels;
  assert.equal(appel.service, "PRODUCTS");
  assert.deepEqual(appel.params, { searchTerm: "lait demi-écrémé", page: "1", size: "8", withKamino: "true", kaminoMode: "ADVANCED" });
  assert.deepEqual(appel.entetes, { "X-Kamino-User-Consent": "true", "X-Kamino-User-Id": "client-42" });

  await rechercher(sim.client, "œufs");
  assert.equal(sim.appels[1].params?.size, "20");
});
