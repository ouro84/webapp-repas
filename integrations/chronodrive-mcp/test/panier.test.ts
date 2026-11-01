// Panier de l'exécuteur (#308, Task 2) : panier courant relu, ajout confirmé par écart de quantité
// (RG-83), indisponible jamais ajouté. Client simulé (test/simulation.ts) : aucun appel à Chronodrive.
import { test } from "node:test";
import assert from "node:assert/strict";

import { chargerFavoris, DUREE_FAVORIS_MS, rechercher } from "../src/catalogue.ts";
import { ErreurChronodrive } from "../src/client.ts";
import { ajouterLignes, BUDGET_LOT_MS, lirePanierCourant, viderPanier } from "../src/panier.ts";
import { clientSimule, fiche, panierSimule, voir, type Route } from "./simulation.ts";

const AJOUTS = "POST /v1/carts/p1/items";
// Valeur envoyée par le spike lors des ajouts qui ont réussi (docs/etudes/chronodrive.md, « Protocole relevé »).
const ORIGINE = "WEB|SEARCH|TG|/promotions";

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

test("aucun panier courant → ErreurChronodrive qui cite le drive et le mode", async () => {
  const sim = clientSimule({ "GET /v1/customers/me/carts": () => ({ content: [] }) });
  await assert.rejects(lirePanierCourant(sim.client), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.match(e.message, /aucun panier courant/);
    assert.match(e.message, /CHRONODRIVE_SITE_ID/);
    assert.match(e.message, /CHRONODRIVE_MODE/);
    return true;
  });
});

test("ajout confirmé par écart de quantité, produit déjà présent", async () => {
  const panier = panierSimule("p1", { "10": 2 });
  const sim = clientSimule(panier.routes);
  voir(sim.client, ["10"]);

  const { resultats, produits } = await ajouterLignes(sim.client, [{ productId: "10", quantite: 1 }]);
  assert.deepEqual(resultats[0], { productId: "10", demande: 1, avant: 2, apres: 3, confirme: true, returnType: "SUCCESS", erreur: null, quantiteAjustee: null });
  // Fiches du panier relu après l'ajout, exposées pour le libellé du cache.
  assert.equal(produits.get("10")?.libelle, "Produit 10");

  // Un POST par ligne, au corps du protocole, encadré par deux lectures du panier courant.
  assert.deepEqual(
    sim.appels.map((a) => `${a.methode} ${a.chemin}`),
    ["GET /v1/customers/me/carts", "GET /v1/carts/p1", AJOUTS, "GET /v1/customers/me/carts", "GET /v1/carts/p1"],
  );
  const post = sim.appels.find((a) => a.methode === "POST");
  assert.equal(post?.service, "CARTS");
  assert.deepEqual(post?.corps, { content: [{ clientOrigin: ORIGINE, productId: "10", quantity: 1 }], optimizedMode: true });
});

test("NO_STOCK_AFTER avec écart → confirmé", async () => {
  const panier = panierSimule("p1", {}, (_p, q) => ({ returnType: "NO_STOCK_AFTER", increment: q }));
  const sim = clientSimule(panier.routes);
  voir(sim.client, ["20"]);

  const { resultats } = await ajouterLignes(sim.client, [{ productId: "20", quantite: 2 }]);
  assert.deepEqual(resultats[0], { productId: "20", demande: 2, avant: 0, apres: 2, confirme: true, returnType: "NO_STOCK_AFTER", erreur: null, quantiteAjustee: null });
});

test("SUCCESS sans écart → non confirmé, erreur explicite", async () => {
  const panier = panierSimule("p1", { "30": 1, "31": 0 }, (p) => ({ returnType: "SUCCESS", increment: p === "31" ? 1 : 0 }));
  const sim = clientSimule(panier.routes);
  voir(sim.client, ["30", "31"]);

  const {
    resultats: [sansEcart, partiel],
  } = await ajouterLignes(sim.client, [
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

  const { resultats } = await ajouterLignes(sim.client, [
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

test("productId jamais vu (ni recherche ni favoris) → refusé sans POST, même déjà au panier", async () => {
  const panier = panierSimule("p1", { "91": 1 });
  const sim = clientSimule(panier.routes);
  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "90", quantite: 1 }, // inventé
    { productId: "91", quantite: 1 }, // au panier, mais jamais vu en recherche ni en favoris
  ]);
  assert.equal(sim.compter(AJOUTS), 0);
  for (const r of resultats) {
    assert.equal(r.confirme, false);
    assert.equal(r.erreur, "produit inconnu ou vu il y a plus de 30 min : relance chercher_produits");
  }
});

test("refus de l'appelant (garde par terme) : ligne non envoyée, et pas comptée comme doublon", async () => {
  const sim = clientSimule(panierSimule("p1", {}).routes);
  voir(sim.client, ["95"]);
  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "95", quantite: 1, refus: "produit non proposé pour cet article : relance chercher_produits pour ce terme" },
    { productId: "95", quantite: 1 },
  ]);
  assert.deepEqual(
    resultats.map((r) => [r.confirme, r.erreur]),
    [
      [false, "produit non proposé pour cet article : relance chercher_produits pour ce terme"],
      [true, null],
    ],
  );
  assert.equal(sim.compter(AJOUTS), 1);
});

test("quantité : entier ≥ 1, plafonnée à 20 et à maxCartQuantity ; vide puis doublon refusés", async () => {
  const panier = panierSimule("p1", { "51": 1 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/products": () => ({ content: [fiche("50"), fiche("51", { maxCartQuantity: 4 }), fiche("52"), fiche("53")] }),
  });
  await rechercher(sim.client, "yaourt");

  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "50", quantite: 35 },
    { productId: "51", quantite: 6 },
    { productId: "52", quantite: 0 },
    { productId: "53", quantite: 1.5 },
    { productId: "50", quantite: 1 },
    { productId: "", quantite: 1 },
  ]);
  const quantites = sim.appels.filter((a) => a.methode === "POST").map((a) => (a.corps as { content: unknown[] }).content[0]);
  assert.deepEqual(quantites, [
    { clientOrigin: ORIGINE, productId: "50", quantity: 20 },
    { clientOrigin: ORIGINE, productId: "51", quantity: 3 }, // déjà 1 au panier, plafond 4
  ]);
  assert.equal(resultats[0].confirme, true);
  assert.match(resultats[0].erreur ?? "", /20 sur 35/);
  assert.equal(resultats[1].confirme, true);
  assert.match(resultats[1].erreur ?? "", /3 sur 6/);
  // Quantité nulle ou non entière : refusée sans POST, jamais arrondie.
  for (const r of [resultats[2], resultats[3]]) {
    assert.equal(r.confirme, false);
    assert.match(r.erreur ?? "", /quantité invalide/);
  }
  // La seconde ligne du même produit n'est pas envoyée : l'écart ne serait plus attribuable.
  assert.equal(resultats[4].confirme, false);
  assert.match(resultats[4].erreur ?? "", /double/);
  // Un productId vide est signalé comme tel, avant tout contrôle de doublon.
  assert.equal(resultats[5].erreur, "productId vide");
});

test("quantité plafonnée par la quantité OMQ et la contenance : jamais augmentée, avant 20 et maxCartQuantity", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    // Contenance « 1 kg » par défaut (test/simulation.ts `fiche`).
    "GET /v1/products": () => ({
      content: [fiche("60"), fiche("61"), fiche("62", { maxCartQuantity: 2, labels: { productLabel: "Riz", unitQuantityLabel: "500 g" } }), fiche("63"), fiche("64"), fiche("65")],
    }),
  });
  await rechercher(sim.client, "riz");

  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "60", quantite: 2, quantiteOmq: "800 g" }, // besoin 1 : plafonné
    { productId: "61", quantite: 2, quantiteOmq: "2 c.à.s" }, // illisible : inchangé
    { productId: "62", quantite: 4, quantiteOmq: "3 kg" }, // besoin 6 ≥ 4 : inchangé, puis maxCartQuantity
    { productId: "63", quantite: 1, quantiteOmq: "2,5 kg" }, // besoin 3 : jamais d'augmentation
    { productId: "64", quantite: 35, quantiteOmq: "30 kg" }, // besoin 30, puis plafond de 20 par ajout
    { productId: "65", quantite: 3, quantiteOmq: "800 g", refus: "refusé par l'appelant" },
  ]);
  const quantites = sim.appels.filter((a) => a.methode === "POST").map((a) => (a.corps as { content: { productId: string; quantity: number }[] }).content[0]);
  assert.deepEqual(
    quantites.map((q) => [q.productId, q.quantity]),
    [["60", 1], ["61", 2], ["62", 2], ["63", 1], ["64", 20]],
  );
  assert.deepEqual(
    resultats.map((r) => [r.productId, r.demande, r.quantiteAjustee, r.confirme, r.erreur]),
    [
      // `demande` = ce qui a été envoyé : 1 sur 1, pas un « ajout partiel ».
      ["60", 1, { demandee: 2, envoyee: 1 }, true, null],
      ["61", 2, null, true, null],
      ["62", 4, null, true, "ajout partiel : 2 sur 4 (plafonné par maxCartQuantity (2, déjà 0 au panier))"],
      ["63", 1, null, true, null],
      ["64", 30, { demandee: 35, envoyee: 30 }, true, "ajout partiel : 20 sur 30 (plafonné à 20 par ajout)"],
      ["65", 3, null, false, "refusé par l'appelant"],
    ],
  );
});

test("quantiteAjustee remise à null quand la ligne n'est pas envoyée ou pas confirmée", async () => {
  // 70 : maxCartQuantity déjà atteint (continue sans POST) ; 71 : SUCCESS sans écart ; 72 : confirmé.
  const panier = panierSimule("p1", { "70": 2 }, (productId, q) => ({ returnType: "SUCCESS", increment: productId === "71" ? 0 : q }));
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/products": () => ({ content: [fiche("70", { maxCartQuantity: 2 }), fiche("71"), fiche("72")] }),
  });
  await rechercher(sim.client, "haricots");
  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "70", quantite: 2, quantiteOmq: "800 g" },
    { productId: "71", quantite: 2, quantiteOmq: "800 g" },
    { productId: "72", quantite: 2, quantiteOmq: "800 g" },
  ]);
  assert.deepEqual(
    resultats.map((r) => [r.productId, r.confirme, r.quantiteAjustee]),
    [
      ["70", false, null],
      ["71", false, null],
      ["72", true, { demandee: 2, envoyee: 1 }],
    ],
  );
});

test("quantiteAjustee remise à null sur une ligne « non tenté » (budget du lot dépassé)", async () => {
  const h = { t: 1_800_000_000_000 };
  const maintenant = () => h.t;
  const panier = panierSimule("p1", {});
  // Le POST « prend » 100 s sur l'horloge simulée : la seconde ligne n'est pas tentée.
  const lent: Route = (appel, n) => {
    h.t += 100_000;
    return panier.routes[AJOUTS](appel, n);
  };
  const sim = clientSimule({ ...panier.routes, [AJOUTS]: lent });
  voir(sim.client, ["80", "81"], { maintenant }); // contenance « 1 kg »

  const { resultats } = await ajouterLignes(
    sim.client,
    ["80", "81"].map((productId) => ({ productId, quantite: 2, quantiteOmq: "800 g" })),
    { maintenant },
  );
  assert.deepEqual(
    resultats.map((r) => [r.productId, r.confirme, r.erreur, r.quantiteAjustee]),
    [
      ["80", true, null, { demandee: 2, envoyee: 1 }],
      ["81", false, "non tenté : délai du lot dépassé", null],
    ],
  );
});

test("productId vide répété : « vide » à chaque ligne, jamais « doublon »", async () => {
  const sim = clientSimule(panierSimule("p1", {}).routes);
  const { resultats } = await ajouterLignes(sim.client, [
    { productId: "", quantite: 1 },
    { productId: "", quantite: 1 },
  ]);
  assert.deepEqual(
    resultats.map((r) => r.erreur),
    ["productId vide", "productId vide"],
  );
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
  voir(sim.client, ["60", "61"]);
  const {
    resultats: [ko, ok],
  } = await ajouterLignes(sim.client, [
    { productId: "60", quantite: 1 },
    { productId: "61", quantite: 1 },
  ]);
  assert.equal(ko.confirme, false);
  assert.match(ko.erreur ?? "", /HTTP 500/);
  assert.equal(ok.confirme, true);
  assert.equal(ok.erreur, null);
});

test("POST sans réponse (délai dépassé) et sans écart : « peut-être appliqué », jamais un simple non confirmé", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    [AJOUTS]: (appel, n) => {
      if (n === 1) {
        const e = new ErreurChronodrive("POST /v1/carts/p1/items", "délai dépassé (20 s sans réponse)");
        e.delaiDepasse = true;
        throw e;
      }
      return panier.routes[AJOUTS](appel, n);
    },
  });
  voir(sim.client, ["62", "63"]);
  const {
    resultats: [lent, ok],
  } = await ajouterLignes(sim.client, [
    { productId: "62", quantite: 1 },
    { productId: "63", quantite: 1 },
  ]);
  assert.equal(lent.confirme, false);
  assert.equal(lent.erreur, "ajout peut-être appliqué (délai dépassé) : à vérifier dans le panier");
  assert.equal(ok.confirme, true);
});

test("relecture finale en échec une fois : retentée, l'ajout est confirmé", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/p1": (appel, n) => {
      if (n === 2) throw new ErreurChronodrive("GET /v1/carts/p1", "HTTP 503");
      return panier.routes["GET /v1/carts/p1"](appel, n);
    },
  });
  voir(sim.client, ["70"]);
  const { resultats } = await ajouterLignes(sim.client, [{ productId: "70", quantite: 1 }]);
  assert.equal(resultats[0].confirme, true);
  assert.equal(resultats[0].erreur, null);
  assert.equal(sim.compter("GET /v1/carts/p1"), 3);
  assert.equal(sim.compter(AJOUTS), 1);
});

test("panier non relu après ajout (deux échecs) : rien de confirmé, consigne de vérifier", async () => {
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/p1": (appel, n) => {
      if (n >= 2) throw new ErreurChronodrive("GET /v1/carts/p1", "HTTP 503");
      return panier.routes["GET /v1/carts/p1"](appel, n);
    },
  });
  voir(sim.client, ["70"]);
  const { resultats, produits } = await ajouterLignes(sim.client, [{ productId: "70", quantite: 1 }]);
  assert.equal(resultats[0].confirme, false);
  assert.equal(resultats[0].returnType, "SUCCESS");
  assert.match(resultats[0].erreur ?? "", /ajout envoyé mais panier non relu.*vérifier le panier/);
  assert.equal(produits.size, 0);
  assert.equal(sim.compter("GET /v1/carts/p1"), 3);
  assert.equal(sim.compter(AJOUTS), 1);
});

test("budget du lot (90 s) dépassé : plus de POST, lignes restantes « non tenté », relecture finale faite", async () => {
  const h = { t: 1_800_000_000_000 };
  const maintenant = () => h.t;
  const panier = panierSimule("p1", {});
  // Chaque POST « prend » 50 s sur l'horloge simulée.
  const lent: Route = (appel, n) => {
    h.t += 50_000;
    return panier.routes[AJOUTS](appel, n);
  };
  const sim = clientSimule({ ...panier.routes, [AJOUTS]: lent });
  voir(sim.client, ["1", "2", "3", "4"], { maintenant });

  const { resultats } = await ajouterLignes(
    sim.client,
    ["1", "2", "3", "4"].map((productId) => ({ productId, quantite: 1 })),
    { maintenant },
  );
  assert.ok(100_000 > BUDGET_LOT_MS);
  // POST 1 à 0 s, POST 2 à 50 s ; à 100 s le budget est dépassé.
  assert.equal(sim.compter(AJOUTS), 2);
  assert.deepEqual(
    resultats.map((r) => [r.productId, r.confirme, r.erreur]),
    [
      ["1", true, null],
      ["2", true, null],
      ["3", false, "non tenté : délai du lot dépassé"],
      ["4", false, "non tenté : délai du lot dépassé"],
    ],
  );
  assert.equal(sim.compter("GET /v1/customers/me/carts"), 2);
});

test("favoris expirés après 30 min : un produit revenu en stock redevient ajoutable", async () => {
  const h = { t: 1_800_000_000_000 };
  const maintenant = () => h.t;
  const panier = panierSimule("p1", {});
  const sim = clientSimule({
    ...panier.routes,
    // 1er chargement : en rupture ; rechargement : revenu en stock.
    "GET /v1/favourite-products": (_a, n) => ({ content: [fiche("80", { stock: n === 1 ? 0 : 5 })], page: { hasNext: false } }),
  });

  assert.equal((await chargerFavoris(sim.client, { maintenant }))[0].disponible, false);
  const {
    resultats: [bloque],
  } = await ajouterLignes(sim.client, [{ productId: "80", quantite: 1 }], { maintenant });
  assert.equal(bloque.confirme, false);
  assert.equal(sim.compter(AJOUTS), 0);

  // Encore en mémoire juste avant 30 min : pas de rechargement.
  h.t += DUREE_FAVORIS_MS;
  await chargerFavoris(sim.client, { maintenant });
  assert.equal(sim.compter("GET /v1/favourite-products"), 1);

  // Au-delà de 30 min : rechargement, et la fiche fraîche rend le produit ajoutable.
  h.t += 1;
  assert.equal((await chargerFavoris(sim.client, { maintenant }))[0].disponible, true);
  assert.equal(sim.compter("GET /v1/favourite-products"), 2);
  const {
    resultats: [ajoute],
  } = await ajouterLignes(sim.client, [{ productId: "80", quantite: 1 }], { maintenant });
  assert.equal(ajoute.confirme, true);
  assert.equal(sim.compter(AJOUTS), 1);
});

test("fiche vue périmée (plus de 30 min) : refusée sans POST, relancer chercher_produits", async () => {
  const h = { t: 1_800_000_000_000 };
  const maintenant = () => h.t;
  const panier = panierSimule("p1", {});
  const sim = clientSimule({ ...panier.routes, "GET /v1/products": () => ({ content: [fiche("81")] }) });
  await rechercher(sim.client, "crème", 20, { maintenant });

  h.t += DUREE_FAVORIS_MS + 1;
  const {
    resultats: [r],
  } = await ajouterLignes(sim.client, [{ productId: "81", quantite: 1 }], { maintenant });
  assert.equal(sim.compter(AJOUTS), 0);
  assert.equal(r.confirme, false);
  assert.match(r.erreur ?? "", /relance chercher_produits/);
});

// Vidage du panier hors run (#320, RG-82) : DELETE ligne à ligne, confirmé par relecture.
const retraitDe = (id: string) => `DELETE /v1/carts/C1/items/${id}`;

test("vider : simulation → aucune requête DELETE, lignes « simulee », quantités du panier", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 });
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: true });
  assert.equal(sim.compter(retraitDe("1")), 0);
  assert.equal(sim.compter(retraitDe("2")), 0);
  assert.deepEqual(bilan.lignes.map((l) => [l.productId, l.quantite, l.statut]), [["1", 2, "simulee"], ["2", 1, "simulee"]]);
  assert.equal(bilan.lignes[0].libelle, "Produit 1");
  assert.equal(bilan.lignes[0].marque, "Marque");
  assert.equal(bilan.simulation, true);
  assert.equal(bilan.panierId, "C1");
  assert.equal(bilan.vide, false);
  assert.equal(bilan.relu, true);
});

test("vider : toutes les lignes retirées puis panier relu vide", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 });
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => [l.productId, l.statut, l.erreur]), [["1", "retiree", null], ["2", "retiree", null]]);
  assert.equal(bilan.vide, true);
  assert.equal(bilan.relu, true);
  assert.equal(sim.compter(retraitDe("1")), 1);
  assert.equal(sim.compter(retraitDe("2")), 1);
  assert.equal(panier.etat.size, 0);
});

test("vider : les DELETE partent en série, dans l'ordre du panier", async () => {
  const panier = panierSimule("C1", { "1": 1, "2": 1, "3": 1 });
  let enCours = 0;
  let maxEnCours = 0;
  const ordre: string[] = [];
  const routes = { ...panier.routes };
  for (const id of ["1", "2", "3"]) {
    routes[retraitDe(id)] = async (appel, n) => {
      enCours++;
      maxEnCours = Math.max(maxEnCours, enCours);
      ordre.push(id);
      await new Promise((r) => setTimeout(r, 5));
      enCours--;
      return panier.routes[retraitDe(id)](appel, n);
    };
  }
  const sim = clientSimule(routes);
  await viderPanier(sim.client, { simulation: false });
  assert.equal(maxEnCours, 1);
  assert.deepEqual(ordre, ["1", "2", "3"]);
});

test("vider : panier déjà vide → aucun DELETE, vide", async () => {
  const panier = panierSimule("C1", {});
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes, []);
  assert.equal(bilan.vide, true);
  assert.equal(bilan.relu, true);
  assert.equal(sim.appels.filter((a) => a.methode === "DELETE").length, 0);
});

test("vider : DELETE 2xx sans effet → toujours_au_panier, pas vide", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 }, undefined, (id) => (id === "2" ? "sans_effet" : "retire"));
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => [l.productId, l.statut]), [["1", "retiree"], ["2", "toujours_au_panier"]]);
  assert.equal(bilan.vide, false);
  assert.equal(bilan.relu, true);
});

test("vider : échec d'une ligne n'arrête pas les autres", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 }, undefined, (id) =>
    id === "1" ? new ErreurChronodrive("DELETE /v1/carts/C1/items/1", "réponse HTTP 500") : "retire",
  );
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.equal(bilan.lignes[0].statut, "toujours_au_panier");
  assert.match(bilan.lignes[0].erreur ?? "", /réponse HTTP 500/);
  assert.equal(bilan.lignes[1].statut, "retiree");
  assert.equal(bilan.lignes[1].erreur, null);
  assert.equal(bilan.vide, false);
});

test("vider : erreur de connexion interrompt la boucle", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 }, undefined, (id) =>
    id === "1" ? new ErreurChronodrive("login", "identifiants refusés") : "retire",
  );
  const sim = clientSimule(panier.routes);
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.equal(bilan.lignes[0].statut, "toujours_au_panier");
  assert.equal(bilan.lignes[1].statut, "non_tente");
  assert.equal(sim.compter(retraitDe("2")), 0);
  assert.equal(bilan.vide, false);
});

test("vider : relecture finale en échec deux fois → non_verifie, relu false, vide false", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/C1": (appel, n) => {
      if (n >= 2) throw new ErreurChronodrive("GET /v1/carts/C1", "HTTP 503");
      return panier.routes["GET /v1/carts/C1"](appel, n);
    },
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => l.statut), ["non_verifie", "non_verifie"]);
  assert.equal(bilan.relu, false);
  assert.equal(bilan.vide, false);
  assert.equal(sim.compter("GET /v1/carts/C1"), 3);
});

test("vider : relecture finale en échec une fois → retentée, lignes confirmées", async () => {
  const panier = panierSimule("C1", { "1": 2 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/C1": (appel, n) => {
      if (n === 2) throw new ErreurChronodrive("GET /v1/carts/C1", "HTTP 503");
      return panier.routes["GET /v1/carts/C1"](appel, n);
    },
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.equal(bilan.lignes[0].statut, "retiree");
  assert.equal(bilan.vide, true);
  assert.equal(bilan.relu, true);
});

test("vider : ligne non tentée (connexion) et relecture en échec → non_tente conservé", async () => {
  const panier = panierSimule("C1", { "1": 2, "2": 1 }, undefined, (id) =>
    id === "1" ? new ErreurChronodrive("login", "identifiants refusés") : "retire",
  );
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/carts/C1": (appel, n) => {
      if (n >= 2) throw new ErreurChronodrive("GET /v1/carts/C1", "HTTP 503");
      return panier.routes["GET /v1/carts/C1"](appel, n);
    },
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => l.statut), ["non_verifie", "non_tente"]);
});

test("vider : une ligne « retiree » peut porter l'erreur du DELETE (la relecture fait foi)", async () => {
  const panier = panierSimule("C1", { "1": 2 });
  const sim = clientSimule({
    ...panier.routes,
    [retraitDe("1")]: () => {
      // Chronodrive a retiré la ligne puis répondu en erreur : le DELETE ment, la relecture non.
      panier.etat.delete("1");
      throw new ErreurChronodrive(retraitDe("1"), "réponse HTTP 500");
    },
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.equal(bilan.lignes[0].statut, "retiree");
  assert.match(bilan.lignes[0].erreur ?? "", /réponse HTTP 500/);
  assert.equal(bilan.vide, true);
});

test("vider : panier relu avec un autre identifiant (commande validée entre-temps) → non relu, jamais « vidé »", async () => {
  const panier = panierSimule("C1", { "1": 2 });
  const sim = clientSimule({
    ...panier.routes,
    "GET /v1/customers/me/carts": (_appel, n) => ({ content: [{ id: n === 1 ? "C1" : "C2" }] }),
    "GET /v1/carts/C2": () => ({ id: "C2", items: [] }),
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => l.statut), ["non_verifie"]);
  assert.equal(bilan.relu, false);
  assert.equal(bilan.vide, false);
  assert.equal(bilan.restantes, null);
  assert.equal(bilan.panierId, "C1");
});

test("vider : restantes = lignes du panier relu (null sans relecture, 0 si déjà vide, taille lue en simulation)", async () => {
  const sim = clientSimule(panierSimule("C1", { "1": 2, "2": 1 }).routes);
  assert.equal((await viderPanier(sim.client, { simulation: true })).restantes, 2);

  const videe = clientSimule(panierSimule("C1", { "1": 2 }).routes);
  assert.equal((await viderPanier(videe.client, { simulation: false })).restantes, 0);

  const dejaVide = clientSimule(panierSimule("C1", {}).routes);
  assert.equal((await viderPanier(dejaVide.client, { simulation: false })).restantes, 0);

  const sansSortie = panierSimule("C1", { "1": 2, "2": 1 }, undefined, (id) => (id === "2" ? "sans_effet" : "retire"));
  assert.equal((await viderPanier(clientSimule(sansSortie.routes).client, { simulation: false })).restantes, 1);

  const panier = panierSimule("C1", { "1": 2 });
  const nonRelu = clientSimule({
    ...panier.routes,
    "GET /v1/carts/C1": (appel, n) => {
      if (n >= 2) throw new ErreurChronodrive("GET /v1/carts/C1", "HTTP 503");
      return panier.routes["GET /v1/carts/C1"](appel, n);
    },
  });
  assert.equal((await viderPanier(nonRelu.client, { simulation: false })).restantes, null);
});

test("vider : ajout concurrent pendant le vidage → restantes = 1, pas vidé, lignes lues « retiree »", async () => {
  const panier = panierSimule("C1", { "1": 2 });
  const sim = clientSimule({
    ...panier.routes,
    // Un produit absent de `lignes` apparaît au panier relu après le vidage.
    "GET /v1/carts/C1": (appel, n) => {
      const reponse = panier.routes["GET /v1/carts/C1"](appel, n) as { id: string; items: unknown[] };
      return n >= 2 ? { ...reponse, items: [{ product: fiche("9"), quantity: 1 }] } : reponse;
    },
  });
  const bilan = await viderPanier(sim.client, { simulation: false });
  assert.deepEqual(bilan.lignes.map((l) => l.statut), ["retiree"]);
  assert.equal(bilan.vide, false);
  assert.equal(bilan.relu, true);
  assert.equal(bilan.restantes, 1);
});
