// Garde d'ajout au panier par terme (#361, RG-82) : un produit n'est accepté que s'il a été proposé
// par `chercher_produits` pour le terme de la ligne (ou pour une reformulation cherchée après lui),
// depuis moins de 30 min, par le même client. Testée sans transport MCP.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DUREE_FAVORIS_MS, noterProduits, type Produit } from "../src/catalogue.ts";
import { creerGardeAjout, PRODUIT_NON_PROPOSE, type GardeAjout } from "../src/garde-ajout.ts";
import { PRODUIT_INCONNU } from "../src/panier.ts";

const MINUTE = 60_000;

function produit(id: string, libelle: string): Produit {
  return { id, libelle, marque: null, contenance: null, prix: 1, prixUnite: null, bio: false, disponible: true, raison: null, maxPanier: null };
}

const LASAGNES = produit("L1", "Feuilles de lasagnes aux oeufs");
const OEUFS = produit("O1", "Oeufs frais x6");
const LAIT = produit("M1", "Lait demi-écrémé 1 L");
const POIREAU = produit("P1", "Poireau botte");

// Banc : horloge factice et un appel de `chercher_produits` simulé comme dans src/outils.ts (fiches
// notées par `noterProduits`, puis propositions par terme notées par la garde).
function banc() {
  const h = { t: 0 };
  const horloge = { maintenant: () => h.t };
  const garde: GardeAjout = creerGardeAjout(horloge);
  const chercher = (client: object, lot: [string, Produit[]][]) => {
    noterProduits(client, lot.flatMap(([, produits]) => produits), horloge);
    garde.noterRecherche(client, lot);
  };
  return { h, horloge, garde, chercher };
}

test("id des lasagnes proposé pour « œufs », ligne « lait » → non proposé", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [
    ["œufs", [LASAGNES, OEUFS]],
    ["lait", [LAIT]],
  ]);
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: LASAGNES.id }), PRODUIT_NON_PROPOSE);
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: LAIT.id }), "ok");
});

test("produit proposé pour le terme, casse et ligature différentes → ok", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [["Œufs", [OEUFS]]]);
  assert.equal(garde.verdictProduit(client, { terme: "oeufs", productId: OEUFS.id }), "ok");
});

test("produit jamais noté nulle part → produit inconnu", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [["lait", [LAIT]]]);
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: "INVENTE" }), PRODUIT_INCONNU);
});

test("reformulation cherchée dans un appel postérieur au terme → ok", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [["poireaux", []]]);
  chercher(client, [["poireau", [POIREAU]]]);
  assert.equal(garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }), "ok");
});

test("reformulation cherchée dans le même appel que le terme → non proposé", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [
    ["poireaux", []],
    ["poireau", [POIREAU]],
  ]);
  assert.equal(
    garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }),
    PRODUIT_NON_PROPOSE,
  );
});

test("reformulation cherchée avant le terme → non proposé", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [["poireau", [POIREAU]]]);
  chercher(client, [["poireaux", []]]);
  assert.equal(
    garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }),
    PRODUIT_NON_PROPOSE,
  );
});

test("reformulation dont le terme n'a jamais été cherché → non proposé", () => {
  const { garde, chercher } = banc();
  const client = {};
  chercher(client, [["poireau", [POIREAU]]]);
  assert.equal(
    garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }),
    PRODUIT_NON_PROPOSE,
  );
});

test("proposition à t=0, verdict à 30 min + 1 ms → refus", () => {
  const { h, garde, chercher } = banc();
  const client = {};
  chercher(client, [["lait", [LAIT]]]);
  h.t = DUREE_FAVORIS_MS;
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: LAIT.id }), "ok");
  h.t = DUREE_FAVORIS_MS + 1;
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: LAIT.id }), PRODUIT_INCONNU);
});

test("re-recherche à 29 min : la proposition est prolongée (verdict à 31 min → ok)", () => {
  const { h, garde, chercher } = banc();
  const client = {};
  chercher(client, [["lait", [LAIT]]]);
  h.t = 29 * MINUTE;
  chercher(client, [["lait", [LAIT]]]);
  h.t = 31 * MINUTE;
  assert.equal(garde.verdictProduit(client, { terme: "lait", productId: LAIT.id }), "ok");
});

test("terme élagué (> 30 min) puis re-cherché : premierAppel repart du nouvel appel", () => {
  const { h, garde, chercher } = banc();
  const client = {};
  chercher(client, [["poireaux", []]]); // appel 1
  h.t = 10 * MINUTE;
  chercher(client, [["poireau", [POIREAU]]]); // appel 2 : reformulation valable à ce stade
  assert.equal(garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }), "ok");
  h.t = 31 * MINUTE;
  chercher(client, [["poireaux", []]]); // appel 3 : « poireaux » élagué, nouvelle entrée
  assert.equal(
    garde.verdictProduit(client, { terme: "poireaux", terme_recherche: "poireau", productId: POIREAU.id }),
    PRODUIT_NON_PROPOSE,
  );
});

test("autre objet client : aucune proposition héritée → refus", () => {
  const { horloge, garde, chercher } = banc();
  const ancien = {};
  chercher(ancien, [["lait", [LAIT]]]);
  const nouveau = {};
  assert.equal(garde.verdictProduit(nouveau, { terme: "lait", productId: LAIT.id }), PRODUIT_INCONNU);
  // Même si la fiche est vue par le nouveau client, sans proposition pour le terme : non proposé.
  noterProduits(nouveau, [LAIT], horloge);
  assert.equal(garde.verdictProduit(nouveau, { terme: "lait", productId: LAIT.id }), PRODUIT_NON_PROPOSE);
});
