// Jetons signés du run de panier (#330, RG-83) : normalisation `cleJeton` jumelle de celle d'OMQ
// (lib/jeton-panier.ts), signature et vérification. Les vecteurs sont partagés avec les tests OMQ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cleJeton, jetonsValides, lireJeton, signerJeton, verifierJeton } from "../src/jetons.ts";

type Vecteur = { secret: string; demande_id: string; libelle: string; cle: string; exp: number; jeton: string };

const vecteurs: Vecteur[] = JSON.parse(
  readFileSync(new URL("./vecteurs-jetons.json", import.meta.url), "utf8"),
);

test("les vecteurs sont chargés", () => {
  assert.ok(vecteurs.length >= 6);
});

for (const v of vecteurs) {
  test(`vecteur « ${v.libelle} » : cle, signature, vérification`, () => {
    assert.equal(cleJeton(v.libelle), v.cle);
    assert.equal(signerJeton(v.secret, v.demande_id, v.libelle, v.exp), v.jeton);

    // Valide juste avant l'expiration, avec le libellé d'origine.
    assert.deepEqual(verifierJeton(v.secret, v.jeton, v.libelle, (v.exp - 1) * 1000), {
      ok: true,
      demandeId: v.demande_id,
    });
    // Libellé recopié avec une autre casse et des espaces doublés : accepté (cleJeton).
    const recopie = v.libelle.toLocaleUpperCase("fr").replace(/ /g, "  ");
    assert.deepEqual(verifierJeton(v.secret, v.jeton, recopie, (v.exp - 1) * 1000), {
      ok: true,
      demandeId: v.demande_id,
    });
    // Pile à exp : encore valide ; une milliseconde de plus : expiré.
    assert.equal(verifierJeton(v.secret, v.jeton, v.libelle, v.exp * 1000).ok, true);
    assert.deepEqual(verifierJeton(v.secret, v.jeton, v.libelle, v.exp * 1000 + 1), {
      ok: false,
      raison: "expire",
    });
    // Autre terme : la signature ne couvre pas ce libellé.
    assert.deepEqual(verifierJeton(v.secret, v.jeton, `${v.libelle} bio`, (v.exp - 1) * 1000), {
      ok: false,
      raison: "signature",
    });
    // Mauvais secret.
    assert.deepEqual(verifierJeton("autre-secret", v.jeton, v.libelle, (v.exp - 1) * 1000), {
      ok: false,
      raison: "signature",
    });
  });
}

test("mac altéré d'un caractère : signature", () => {
  const v = vecteurs[0];
  const dernier = v.jeton.slice(-1);
  const altere = v.jeton.slice(0, -1) + (dernier === "0" ? "1" : "0");
  assert.deepEqual(verifierJeton(v.secret, altere, v.libelle, (v.exp - 1) * 1000), {
    ok: false,
    raison: "signature",
  });
});

test("exp altéré : signature (le mac couvre exp)", () => {
  const v = vecteurs[0];
  const [id, exp, mac] = v.jeton.split(".");
  const prolonge = `${id}.${Number(exp) + 3600}.${mac}`;
  assert.deepEqual(verifierJeton(v.secret, prolonge, v.libelle, (v.exp - 1) * 1000), {
    ok: false,
    raison: "signature",
  });
});

test("formats invalides : format", () => {
  const v = vecteurs[0];
  const [id, exp, mac] = v.jeton.split(".");
  const cas = [
    "abc",
    "",
    `${id}.${exp}`,
    `${id}.${exp}.${mac}.extra`,
    `${id}.${exp}.${mac.toUpperCase()}`,
    `${id}.${exp}.${mac.slice(0, 31)}`,
    `${id}.${exp}.${mac}0`,
    `${id}.12abc.${mac}`,
    `${id}.-5.${mac}`,
    `${id}.1.5e9.${mac}`,
    `.${exp}.${mac}`,
  ];
  for (const jeton of cas) {
    assert.deepEqual(verifierJeton(v.secret, jeton, v.libelle, 0), { ok: false, raison: "format" }, jeton);
  }
});

test("demande_id qui n'est pas un uuid : format, même signé avec le bon secret", () => {
  const v = vecteurs[0];
  for (const id of ["pas-un-uuid", "0b9f3a52-6c1e-4d7a-9a1f-2e5c7d8b4a1", "0B9F3A52-6C1E-4D7A-9A1F-2E5C7D8B4A10", "../etc/passwd"]) {
    const signe = signerJeton(v.secret, id, v.libelle, v.exp);
    assert.deepEqual(verifierJeton(v.secret, signe, v.libelle, (v.exp - 1) * 1000), { ok: false, raison: "format" }, id);
    assert.deepEqual(lireJeton(signe, (v.exp - 1) * 1000), { ok: false, raison: "format" }, id);
  }
});

// `lireJeton` : format, expiration et demande, sans signature (le libellé d'un co-jeton de ligne
// fusionnée est inconnu de chronodrive).
test("lireJeton : jeton bien formé et non expiré → demandeId, signature non contrôlée", () => {
  const v = vecteurs[0];
  assert.deepEqual(lireJeton(v.jeton, (v.exp - 1) * 1000), { ok: true, demandeId: v.demande_id });
  // Pile à exp : encore valide ; une milliseconde de plus : expiré.
  assert.equal(lireJeton(v.jeton, v.exp * 1000).ok, true);
  assert.deepEqual(lireJeton(v.jeton, v.exp * 1000 + 1), { ok: false, raison: "expire" });
  // Un mac altéré mais bien formé passe : la signature n'est pas lue.
  const [id, exp, mac] = v.jeton.split(".");
  const altere = `${id}.${exp}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`;
  assert.deepEqual(lireJeton(altere, (v.exp - 1) * 1000), { ok: true, demandeId: v.demande_id });
});

test("lireJeton : formats invalides → format (mêmes cas que verifierJeton)", () => {
  const v = vecteurs[0];
  const [id, exp, mac] = v.jeton.split(".");
  for (const jeton of ["abc", "", `${id}.${exp}`, `${id}.${exp}.${mac}.extra`, `${id}.12abc.${mac}`, `${id}.${exp}.${mac.toUpperCase()}`, `.${exp}.${mac}`]) {
    assert.deepEqual(lireJeton(jeton, 0), { ok: false, raison: "format" }, jeton);
  }
});

// `jetonsValides` : garde des jetons d'une ligne de `ajouter_au_panier` (#330, #361). Au moins un
// jeton signe `terme` ; les co-jetons sont lus sans signature mais doivent venir de la même demande.
const SECRET = "secret-de-test";
const DEMANDE = "0b9f3a52-6c1e-4d7a-9a1f-2e5c7d8b4a10";
const AUTRE_DEMANDE = "1c8e2b41-5d0f-4e6b-8b2e-3f6d8e9c5b21";
const EXP = 2_000_000_000;
const AVANT_EXP = (EXP - 1) * 1000;

test("jetonsValides : un jeton valide pour terme → vrai", () => {
  assert.equal(jetonsValides(SECRET, [signerJeton(SECRET, DEMANDE, "lait", EXP)], "lait", AVANT_EXP), true);
});

test("jetonsValides : co-jeton d'une autre demande → faux, même si le jeton de terme est valide", () => {
  const jetons = [signerJeton(SECRET, DEMANDE, "lait", EXP), signerJeton(SECRET, AUTRE_DEMANDE, "crème", EXP)];
  assert.equal(jetonsValides(SECRET, jetons, "lait", AVANT_EXP), false);
});

test("jetonsValides : un jeton expiré → faux", () => {
  // Co-jeton expiré : la ligne entière est refusée.
  const jetons = [signerJeton(SECRET, DEMANDE, "lait", EXP), signerJeton(SECRET, DEMANDE, "crème", EXP - 3600)];
  assert.equal(jetonsValides(SECRET, jetons, "lait", AVANT_EXP), false);
  // Jeton de terme expiré.
  assert.equal(jetonsValides(SECRET, [signerJeton(SECRET, DEMANDE, "lait", EXP)], "lait", EXP * 1000 + 1), false);
});

test("jetonsValides : co-jeton de la même demande signant un autre libellé → vrai", () => {
  const jetons = [signerJeton(SECRET, DEMANDE, "crème", EXP), signerJeton(SECRET, DEMANDE, "lait", EXP)];
  assert.equal(jetonsValides(SECRET, jetons, "lait", AVANT_EXP), true);
});

test("jetonsValides : aucun jeton ne signe terme → faux", () => {
  const jetons = [signerJeton(SECRET, DEMANDE, "crème", EXP), signerJeton(SECRET, DEMANDE, "beurre", EXP)];
  assert.equal(jetonsValides(SECRET, jetons, "lait", AVANT_EXP), false);
});
