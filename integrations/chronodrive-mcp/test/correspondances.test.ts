// Cache des correspondances terme → produit (#308, Task 3) : base `node:sqlite` temporaire, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Correspondances, normaliserTerme } from "../src/correspondances.ts";

// Dossier unique par test, supprimé à la fin : la base ne survit jamais au test.
function avecBase(corps: (chemin: string) => void): void {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-cache-"));
  try {
    corps(join(dossier, "correspondances.sqlite"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

test("normalisation (casse, accents, espaces)", () => {
  assert.equal(normaliserTerme("  Crème   FRAÎCHE épaisse "), "creme fraiche epaisse");
  assert.equal(normaliserTerme("Œufs\tfrais\n"), "œufs frais");
  assert.equal(normaliserTerme("lait"), "lait");
  assert.equal(normaliserTerme("   "), "");
});

test("memoriser puis connues", () => {
  avecBase((chemin) => {
    const cache = new Correspondances(chemin);
    try {
      cache.memoriser([
        { terme: "Crème fraîche", productId: "10", libelle: "Crème fraîche 20 cl" },
        { terme: "lait", productId: "11", libelle: "Lait demi-écrémé 1 L" },
      ]);
      // La lecture normalise aussi : casse et accents n'ont pas d'effet.
      const trouvees = cache.connues(["CREME  FRAICHE", "beurre"]);
      assert.deepEqual([...trouvees.keys()], ["creme fraiche"]);
      const entree = trouvees.get("creme fraiche");
      assert.equal(entree?.productId, "10");
      assert.equal(entree?.libelle, "Crème fraîche 20 cl");
      assert.match(entree?.vuLe ?? "", /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(cache.connues([]).size, 0);
    } finally {
      cache.fermer();
    }
  });
});

test("upsert remplace", () => {
  avecBase((chemin) => {
    const cache = new Correspondances(chemin);
    try {
      cache.memoriser([{ terme: "lait", productId: "11", libelle: "Lait A" }]);
      cache.memoriser([{ terme: "Lait ", productId: "12", libelle: "Lait B" }]);
      const trouvees = cache.connues(["lait"]);
      assert.equal(trouvees.size, 1);
      assert.equal(trouvees.get("lait")?.productId, "12");
      assert.equal(trouvees.get("lait")?.libelle, "Lait B");
    } finally {
      cache.fermer();
    }
  });
});

test("oublier", () => {
  avecBase((chemin) => {
    const cache = new Correspondances(chemin);
    try {
      cache.memoriser([
        { terme: "lait", productId: "11", libelle: "Lait" },
        { terme: "beurre", productId: "13", libelle: "Beurre" },
      ]);
      cache.oublier("  LAIT");
      assert.deepEqual([...cache.connues(["lait", "beurre"]).keys()], ["beurre"]);
      // Oublier un terme inconnu ne casse rien.
      cache.oublier("inconnu");
    } finally {
      cache.fermer();
    }
  });
});

test("persiste entre deux ouvertures", () => {
  avecBase((chemin) => {
    const premiere = new Correspondances(chemin);
    premiere.memoriser([{ terme: "Pâtes", productId: "20", libelle: "Pâtes 500 g" }]);
    premiere.fermer();

    const seconde = new Correspondances(chemin);
    try {
      assert.equal(seconde.connues(["pates"]).get("pates")?.productId, "20");
    } finally {
      seconde.fermer();
    }
  });
});

test("beaucoup de termes en une lecture", () => {
  // Au-delà de la limite de paramètres d'une requête SQLite : la lecture se découpe.
  avecBase((chemin) => {
    const cache = new Correspondances(chemin);
    try {
      const termes = Array.from({ length: 2500 }, (_, i) => `terme ${i}`);
      cache.memoriser(termes.map((terme, i) => ({ terme, productId: String(i), libelle: terme })));
      assert.equal(cache.connues(termes).size, 2500);
    } finally {
      cache.fermer();
    }
  });
});
