// Jetons signés du run de panier (#330, RG-83) : normalisation `cleJeton` jumelle de celle d'OMQ
// (lib/jeton-panier.ts), signature et vérification. Les vecteurs sont partagés avec les tests OMQ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cleJeton, signerJeton, verifierJeton } from "../src/jetons.ts";

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
