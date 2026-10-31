// Cache des correspondances terme → produit (#308, Task 3) : base `node:sqlite` temporaire, aucun appel réseau.
import { test } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHEMIN_CACHE_PAR_DEFAUT, cheminCache, Correspondances, normaliserTerme } from "../src/correspondances.ts";

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
  assert.equal(normaliserTerme("lait"), "lait");
  assert.equal(normaliserTerme("   "), "");
});

test("normalisation : ligatures œ/æ dépliées (« œufs » = « oeufs »)", () => {
  assert.equal(normaliserTerme("Œufs\tfrais\n"), "oeufs frais");
  assert.equal(normaliserTerme("bœuf"), normaliserTerme("boeuf"));
  assert.equal(normaliserTerme("Cæsar"), "caesar");
});

test("cheminCache : CHRONODRIVE_CACHE s'il est non vide, sinon le chemin du NAS", () => {
  assert.equal(cheminCache({ CHRONODRIVE_CACHE: " /tmp/cache.sqlite " }), "/tmp/cache.sqlite");
  assert.equal(cheminCache({ CHRONODRIVE_CACHE: "   " }), CHEMIN_CACHE_PAR_DEFAUT);
  assert.equal(cheminCache({}), CHEMIN_CACHE_PAR_DEFAUT);
});

test("fermer deux fois : sans erreur", () => {
  avecBase((chemin) => {
    const cache = new Correspondances(chemin);
    cache.fermer();
    assert.doesNotThrow(() => cache.fermer());
  });
});

test("dossier parent absent : erreur claire qui nomme le fichier", () => {
  avecBase((chemin) => {
    const introuvable = join(chemin, "..", "absent", "correspondances.sqlite");
    assert.throws(() => new Correspondances(introuvable), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /cache des correspondances : ouverture de .*absent.* impossible/);
      return true;
    });
  });
});

test("fichier qui n'est pas une base : erreur, et le fichier n'est pas laissé ouvert", () => {
  avecBase((chemin) => {
    writeFileSync(chemin, "ceci n'est pas une base SQLite, ".repeat(200));
    assert.throws(() => new Correspondances(chemin), /not a database/);
    // Handle libéré : sous Windows, un fichier encore ouvert ne pourrait pas être supprimé.
    unlinkSync(chemin);
    assert.equal(existsSync(chemin), false);
  });
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

test("écriture concurrente : memoriser attend le verrou au lieu de lever", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-cache-"));
  const chemin = join(dossier, "correspondances.sqlite");
  const cache = new Correspondances(chemin);
  // Un autre processus prend le verrou d'écriture, le garde 400 ms puis valide. DatabaseSync est synchrone :
  // un second processus est le seul moyen de libérer le verrou pendant que memoriser attend.
  const autre = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite";
       const base = new DatabaseSync(process.argv[1]);
       base.exec("begin immediate");
       process.stdout.write("verrou\\n");
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
       base.exec("commit");
       base.close();`,
      chemin,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const fin = new Promise((r) => autre.once("exit", r));
  try {
    await new Promise<void>((resolve, reject) => {
      const delai = setTimeout(() => reject(new Error("le verrou n'a pas été pris en 10 s")), 10_000);
      const finir = (action: () => void) => {
        clearTimeout(delai);
        action();
      };
      autre.once("error", (e) => finir(() => reject(e)));
      autre.once("exit", () => finir(() => reject(new Error("le verrou n'a pas été pris"))));
      autre.stdout.once("data", () => finir(resolve));
    });
    // Pas de borne basse sur la durée (fragile selon la machine) : memoriser ne lève pas et la valeur est lue.
    assert.doesNotThrow(() => cache.memoriser([{ terme: "lait", productId: "11", libelle: "Lait" }]));
    assert.equal(cache.connues(["lait"]).get("lait")?.productId, "11");
  } finally {
    if (autre.exitCode === null && autre.signalCode === null) autre.kill();
    await fin;
    cache.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
