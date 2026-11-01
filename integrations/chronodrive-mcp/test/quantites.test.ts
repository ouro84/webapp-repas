// Plafond de quantité de l'exécuteur (#308, run réel #2) : lecture de la quantité OMQ et de la
// contenance Chronodrive, besoin en unités, jamais d'augmentation. Fonctions pures, aucun réseau.
import { test } from "node:test";
import assert from "node:assert/strict";

import { besoinEnUnites, lireContenance, lireQuantiteOmq, plafonnerQuantite } from "../src/quantites.ts";

test("quantité OMQ : masse, volume, nombre, virgule décimale, sans espace", () => {
  assert.deepEqual(lireQuantiteOmq("800 g"), { dimension: "masse", valeur: 800 });
  assert.deepEqual(lireQuantiteOmq("1,5 kg"), { dimension: "masse", valeur: 1500 });
  assert.deepEqual(lireQuantiteOmq("250g"), { dimension: "masse", valeur: 250 });
  assert.deepEqual(lireQuantiteOmq("40 cl"), { dimension: "volume", valeur: 400 });
  assert.deepEqual(lireQuantiteOmq("75 cl"), { dimension: "volume", valeur: 750 });
  assert.deepEqual(lireQuantiteOmq("1 L"), { dimension: "volume", valeur: 1000 });
  assert.deepEqual(lireQuantiteOmq("20 ml"), { dimension: "volume", valeur: 20 });
  assert.deepEqual(lireQuantiteOmq(" 1.5 litre "), { dimension: "volume", valeur: 1500 });
  // Un nombre nu dans OMQ est un nombre d'unités.
  assert.deepEqual(lireQuantiteOmq("6"), { dimension: "nombre", valeur: 6 });
  assert.deepEqual(lireQuantiteOmq("2"), { dimension: "nombre", valeur: 2 });
  assert.deepEqual(lireQuantiteOmq("6 œufs"), { dimension: "nombre", valeur: 6 });
  assert.deepEqual(lireQuantiteOmq("3 pièces"), { dimension: "nombre", valeur: 3 });
});

test("quantité OMQ : unités libres, vide ou texte → null (aucun plafond)", () => {
  for (const texte of ["", "  ", "2 c.à.s", "1 c.à.c", "1 sachet", "1 pincée", "1 botte", "3 gousses", "un peu", "1/2", "g", "2 kg environ"]) {
    assert.equal(lireQuantiteOmq(texte), null, texte);
  }
});

test("quantité OMQ fusionnée (« + ») : somme d'une même dimension, sinon null", () => {
  assert.deepEqual(lireQuantiteOmq("160 g + 1 kg"), { dimension: "masse", valeur: 1160 });
  assert.deepEqual(lireQuantiteOmq("20 cl+0,5 L"), { dimension: "volume", valeur: 700 });
  assert.deepEqual(lireQuantiteOmq("2 + 4"), { dimension: "nombre", valeur: 6 });
  // Une part illisible ou d'une autre dimension : on ne sait pas, donc pas de plafond.
  assert.equal(lireQuantiteOmq("2 c.à.s + 160 g"), null);
  assert.equal(lireQuantiteOmq("160 g + 20 cl"), null);
  assert.equal(lireQuantiteOmq("160 g + "), null);
  assert.equal(lireQuantiteOmq("6 + 200 g"), null);
});

test("contenance Chronodrive : simple, lot « n x … », œufs, pièce", () => {
  assert.deepEqual(lireContenance("1 kg"), { dimension: "masse", valeur: 1000 });
  assert.deepEqual(lireContenance("400 g"), { dimension: "masse", valeur: 400 });
  assert.deepEqual(lireContenance("20 cl"), { dimension: "volume", valeur: 200 });
  assert.deepEqual(lireContenance("6 x 50 cl"), { dimension: "volume", valeur: 3000 });
  assert.deepEqual(lireContenance("4x100g"), { dimension: "masse", valeur: 400 });
  assert.deepEqual(lireContenance("4 × 125 g"), { dimension: "masse", valeur: 500 });
  assert.deepEqual(lireContenance("12 œufs"), { dimension: "nombre", valeur: 12 });
  assert.deepEqual(lireContenance("6 oeufs"), { dimension: "nombre", valeur: 6 });
  assert.deepEqual(lireContenance("1 pièce"), { dimension: "nombre", valeur: 1 });
  assert.deepEqual(lireContenance("1,5 L"), { dimension: "volume", valeur: 1500 });
});

test("contenance : absente, nombre nu, inconnue ou nulle → null", () => {
  for (const texte of [null, "", "6", "1 botte", "le lot", "environ 1 kg", "0 g", "0 x 50 cl"]) {
    assert.equal(lireContenance(texte), null, String(texte));
  }
});

test("besoin en unités : arrondi au supérieur, au moins 1, même dimension seulement", () => {
  // Run réel #2 : 800 g de haricots verts, paquet de 1 kg → 1.
  assert.equal(besoinEnUnites("800 g", "1 kg"), 1);
  assert.equal(besoinEnUnites("1,5 kg", "500 g"), 3);
  assert.equal(besoinEnUnites("1,1 kg", "550 g"), 2); // 1100.0000000000002 / 550 ne doit pas donner 3
  assert.equal(besoinEnUnites("1 kg", "400 g"), 3);
  assert.equal(besoinEnUnites("40 cl", "6 x 50 cl"), 1);
  assert.equal(besoinEnUnites("75 cl", "20 cl"), 4);
  assert.equal(besoinEnUnites("1 L", "75 cl"), 2);
  assert.equal(besoinEnUnites("6", "12 œufs"), 1);
  assert.equal(besoinEnUnites("6 œufs", "6 oeufs"), 1);
  assert.equal(besoinEnUnites("2", "1 pièce"), 2);
  assert.equal(besoinEnUnites("0 g", "1 kg"), 1);
  assert.equal(besoinEnUnites("2 c.à.s + 160 g", "1 kg"), null);
  // Dimensions différentes, ou une des deux illisible : aucun besoin calculé.
  assert.equal(besoinEnUnites("2", "1 kg"), null);
  assert.equal(besoinEnUnites("800 g", "1 L"), null);
  assert.equal(besoinEnUnites("2 c.à.s", "1 kg"), null);
  assert.equal(besoinEnUnites("1 sachet", "4 x 100 g"), null);
  assert.equal(besoinEnUnites("", "1 kg"), null);
  assert.equal(besoinEnUnites("800 g", null), null);
  assert.equal(besoinEnUnites(undefined, "1 kg"), null);
});

test("plafond : jamais d'augmentation, ajustement signalé seulement s'il baisse la quantité", () => {
  assert.deepEqual(plafonnerQuantite(2, "800 g", "1 kg"), { envoyee: 1, ajustee: { demandee: 2, envoyee: 1 } });
  assert.deepEqual(plafonnerQuantite(1, "800 g", "1 kg"), { envoyee: 1, ajustee: null });
  // Besoin 3, demande 2 : on n'augmente jamais.
  assert.deepEqual(plafonnerQuantite(2, "1,5 kg", "500 g"), { envoyee: 2, ajustee: null });
  assert.deepEqual(plafonnerQuantite(5, "75 cl", "20 cl"), { envoyee: 4, ajustee: { demandee: 5, envoyee: 4 } });
  // Rien de comparable : la quantité demandée passe telle quelle.
  assert.deepEqual(plafonnerQuantite(3, "2 c.à.s", "1 kg"), { envoyee: 3, ajustee: null });
  assert.deepEqual(plafonnerQuantite(3, undefined, "1 kg"), { envoyee: 3, ajustee: null });
  assert.deepEqual(plafonnerQuantite(3, "800 g", null), { envoyee: 3, ajustee: null });
});
