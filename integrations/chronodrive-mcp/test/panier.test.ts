// Panier de l'exécuteur (#308, Task 2) : panier courant relu, ajout confirmé par écart de quantité
// (RG-83), indisponible jamais ajouté. Client simulé (test/simulation.ts) : aucun appel à Chronodrive.
import { test } from "node:test";
import assert from "node:assert/strict";

import { rechercher } from "../src/catalogue.ts";
import { ErreurChronodrive } from "../src/client.ts";
import { ajouterLignes, lirePanierCourant } from "../src/panier.ts";
import { clientSimule, fiche, panierSimule } from "./simulation.ts";

const AJOUTS = "POST /v1/carts/p1/items";

test("panier courant relu à chaque appel de session", async () => {
  // Après une commande validée, l'identifiant du panier change : jamais de cache de panierId.
  let id = "p1";
  const sim = clientSimule({
    "GET /v1/customers/me/carts": () => ({ content: [{ id }] }),
    "GET /v1/carts/p1": () => ({ items: [{ product: fiche("10"), quantity: 2 }] }),
    "GET /v1/carts/p2": () => ({ items: [] }),
  });

  const premier = await lirePanierCourant(sim.client);
  assert.equal(premier.id, "p1");
  assert.deepEqual([...premier.lignes], [["10", 2]]);
  assert.equal(premier.produits.get("10")?.libelle, "Produit 10");

  id = "p2";
  const second = await lirePanierCourant(sim.client);
  assert.equal(second.id, "p2");
  assert.equal(second.lignes.size, 0);

  assert.equal(sim.compter("GET /v1/customers/me/carts"), 2);
  const paniers = sim.appels.filter((a) => a.chemin === "/v1/customers/me/carts");
  assert.ok(paniers.every((a) => a.service === "CUSTOMERS"));
  assert.ok(sim.appels.filter((a) => a.chemin.startsWith("/v1/carts/")).every((a) => a.service === "CARTS"));
});

test("aucun panier courant → ErreurChronodrive", async () => {
  const sim = clientSimule({ "GET /v1/customers/me/carts": () => ({ content: [] }) });
  await assert.rejects(lirePanierCourant(sim.client), (e: unknown) => e instanceof ErreurChronodrive && /panier/.test(e.message));
});

test("ajout confirmé par écart de quantité, produit déjà présent", async () => {
  const panier = panierSimule("p1", { "10": 2 });
  const sim = clientSimule(panier.routes);

  const [resultat] = await ajouterLignes(sim.client, [{ productId: "10", quantite: 1 }]);
  assert.deepEqual(resultat, { productId: "10", demande: 1, avant: 2, apres: 3, confirme: true, returnType: "SUCCESS", erreur: null });

  // Un POST par ligne, au corps du protocole, encadré par deux lectures du panier courant.
  assert.deepEqual(
    sim.appels.map((a) => `${a.methode} ${a.chemin}`),
    ["GET /v1/customers/me/carts", "GET /v1/carts/p1", AJOUTS, "GET /v1/customers/me/carts", "GET /v1/carts/p1"],
  );
  const post = sim.appels.find((a) => a.methode === "POST");
  assert.equal(post?.service, "CARTS");
  assert.deepEqual(post?.corps, { content: [{ clientOrigin: "WEB", productId: "10", quantity: 1 }], optimizedMode: true });
});

test("NO_STOCK_AFTER avec écart → confirmé", async () => {
  const panier = panierSimule("p1", {}, (_p, q) => ({ returnType: "NO_STOCK_AFTER", increment: q }));
  const sim = clientSimule(panier.routes);

  const [resultat] = await ajouterLignes(sim.client, [{ productId: "20", quantite: 2 }]);
  assert.deepEqual(resultat, { productId: "20", demande: 2, avant: 0, apres: 2, confirme: true, returnType: "NO_STOCK_AFTER", erreur: null });
});

test("SUCCESS sans écart → non confirmé, erreur explicite", async () => {
  const panier = panierSimule("p1", { "30": 1, "31": 0 }, (p) => ({ returnType: "SUCCESS", increment: p === "31" ? 1 : 0 }));
  const sim = clientSimule(panier.routes);

  const [sansEcart, partiel] = await ajouterLignes(sim.client, [
    { productId: "30", quantite: 1 },
    { productId: "31", quantite: 3 },
  ]);
  assert.equal(sansEcart.confirme, false);
  assert.equal(sansEcart.returnType, "SUCCESS");
  assert.equal(sansEcart.avant, 1);
  assert.equal(sansEcart.apres, 1);
  assert.match(sansEcart.erreur ?? "", /quantité inchangée/);

  // Écart inférieur à la demande : confirmé (le produit est dans le panier), mais signalé.
  assert.equal(partiel.confirme, true);
  assert.equal(partiel.apres - partiel.avant, 1);
  assert.match(partiel.erreur ?? "", /1 sur 3/);
});

test("indisponible jamais ajouté", async () => {
  const panier = panierSimule("p1", { "41": 2 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/products": () => ({ content: [fiche("40", { remainingStock: 0 }), fiche("41", { maxCartQuantity: 2 }), fiche("42", { isEligible: false })] }),
  });
  await rechercher(sim.client, "beurre");

  const resultats = await ajouterLignes(sim.client, [
    { productId: "40", quantite: 1 },
    { productId: "41", quantite: 1 }, // déjà 2 au panier, maxCartQuantity 2 : plafond atteint
    { productId: "42", quantite: 1 },
  ]);
  assert.equal(sim.compter(AJOUTS), 0);
  for (const r of resultats) {
    assert.equal(r.confirme, false);
    assert.equal(r.returnType, null);
    assert.equal(r.apres, r.avant);
    assert.ok(r.erreur);
  }
  assert.match(resultats[0].erreur ?? "", /stock/);
  assert.match(resultats[1].erreur ?? "", /maxCartQuantity/);
  assert.match(resultats[2].erreur ?? "", /éligible/);
  // Rien d'envoyé : pas de seconde lecture du panier.
  assert.equal(sim.compter("GET /v1/customers/me/carts"), 1);
});

test("quantité bornée à 1..20 et à maxCartQuantity, doublon refusé", async () => {
  const panier = panierSimule("p1", { "51": 1 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/products": () => ({ content: [fiche("51", { maxCartQuantity: 4 })] }),
  });
  await rechercher(sim.client, "yaourt");

  const resultats = await ajouterLignes(sim.client, [
    { productId: "50", quantite: 35 },
    { productId: "51", quantite: 6 },
    { productId: "52", quantite: 0 },
    { productId: "50", quantite: 1 },
  ]);
  const quantites = sim.appels.filter((a) => a.methode === "POST").map((a) => (a.corps as { content: unknown[] }).content[0]);
  assert.deepEqual(quantites, [
    { clientOrigin: "WEB", productId: "50", quantity: 20 },
    { clientOrigin: "WEB", productId: "51", quantity: 3 }, // déjà 1 au panier, plafond 4
    { clientOrigin: "WEB", productId: "52", quantity: 1 },
  ]);
  assert.equal(resultats[0].confirme, true);
  assert.match(resultats[0].erreur ?? "", /20 sur 35/);
  assert.equal(resultats[1].confirme, true);
  assert.match(resultats[1].erreur ?? "", /3 sur 6/);
  assert.deepEqual(resultats[2], { productId: "52", demande: 0, avant: 0, apres: 1, confirme: true, returnType: "SUCCESS", erreur: null });
  // La seconde ligne du même produit n'est pas envoyée : l'écart ne serait plus attribuable.
  assert.equal(resultats[3].confirme, false);
  assert.match(resultats[3].erreur ?? "", /double/);
});

test("échec d'un POST : les autres lignes passent, confirmation toujours par écart", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    [AJOUTS]: (appel, n) => {
      if (n === 1) throw new ErreurChronodrive("POST /v1/carts/p1/items", "HTTP 500");
      return panier.routes[AJOUTS](appel, n);
    },
  });
  const [ko, ok] = await ajouterLignes(sim.client, [
    { productId: "60", quantite: 1 },
    { productId: "61", quantite: 1 },
  ]);
  assert.equal(ko.confirme, false);
  assert.match(ko.erreur ?? "", /HTTP 500/);
  assert.equal(ok.confirme, true);
  assert.equal(ok.erreur, null);
});

test("panier non relu après ajout : rien de confirmé, consigne de vérifier", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/p1": (appel, n) => {
      if (n === 2) throw new ErreurChronodrive("GET /v1/carts/p1", "HTTP 503");
      return panier.routes["GET /v1/carts/p1"](appel, n);
    },
  });
  const [resultat] = await ajouterLignes(sim.client, [{ productId: "70", quantite: 1 }]);
  assert.equal(resultat.confirme, false);
  assert.equal(resultat.returnType, "SUCCESS");
  assert.match(resultat.erreur ?? "", /vérifier le panier/);
});
