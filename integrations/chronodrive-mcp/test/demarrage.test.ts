// Contrôle de démarrage du MCP stdio (#308, Task 4) : `node src/mcp.ts` répond à `initialize` et
// `tools/list` sans identifiants ni réseau, et stdout ne porte que du JSON-RPC.
// Équivalent NAS : `CHRONODRIVE_ENV=/dev/null node src/mcp.ts` ; ici un fichier vide temporaire (Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = fileURLToPath(new URL("../src/mcp.ts", import.meta.url));

test("démarrage stdio : initialize, tools/list, lecture seule par défaut, stdout en JSON-RPC seulement", { timeout: 30_000 }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-mcp-"));
  const envVide = join(dossier, "chronodrive.env");
  writeFileSync(envVide, "");
  const env: Record<string, string | undefined> = { ...process.env, CHRONODRIVE_ENV: envVide, CHRONODRIVE_CACHE: join(dossier, "cache.sqlite") };
  // Aucune variable de lecture seule : le MCP doit refuser l'écriture par défaut.
  for (const nom of ["CHRONODRIVE_EMAIL", "CHRONODRIVE_MOT_DE_PASSE", "CHRONODRIVE_SITE_ID", "CHRONODRIVE_SESSION", "CHRONODRIVE_LECTURE_SEULE"]) delete env[nom];

  const enfant = spawn(process.execPath, [MCP], { env, stdio: ["pipe", "pipe", "pipe"] });
  let sortie = "";
  let erreurs = "";
  enfant.stdout.setEncoding("utf8").on("data", (d: string) => (sortie += d));
  enfant.stderr.setEncoding("utf8").on("data", (d: string) => (erreurs += d));
  // Un EPIPE sur stdin (enfant mort) ne doit pas faire planter le test : l'attente de réponse le signale.
  enfant.stdin.on("error", () => {});

  // Lignes complètes seulement : la dernière, sans « \n », peut être en cours d'écriture.
  const lignesCompletes = () => sortie.split("\n").slice(0, -1).filter((l) => l.trim() !== "");
  const attendreReponse = async (id: number) => {
    const limite = Date.now() + 10_000;
    while (Date.now() < limite) {
      const ligne = lignesCompletes().find((l) => l.includes(`"id":${id}`));
      if (ligne) return JSON.parse(ligne) as { result?: Record<string, unknown>; error?: unknown };
      if (enfant.exitCode !== null || enfant.signalCode !== null) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`pas de réponse ${id} ; stderr : ${erreurs}`);
  };
  const envoyer = (message: Record<string, unknown>) => enfant.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

  try {
    envoyer({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } } });
    const init = await attendreReponse(1);
    assert.equal((init.result?.serverInfo as { name: string }).name, "chronodrive");

    envoyer({ method: "notifications/initialized" });
    envoyer({ id: 2, method: "tools/list" });
    const liste = await attendreReponse(2);
    const noms = (liste.result?.tools as { name: string }[]).map((t) => t.name).sort();
    assert.deepEqual(noms, ["ajouter_au_panier", "chercher_produits", "correspondances_connues", "lire_panier", "memoriser_correspondances"]);

    // Lecture seule par défaut : sans CHRONODRIVE_LECTURE_SEULE='0', l'ajout est refusé sans appel.
    envoyer({ id: 3, method: "tools/call", params: { name: "ajouter_au_panier", arguments: { lignes: [{ terme: "lait", productId: "10", quantite: 1 }] } } });
    const ajout = await attendreReponse(3);
    const resultat = ajout.result as { isError?: boolean; content: { text: string }[] };
    assert.equal(resultat.isError, true);
    assert.match(resultat.content[0].text, /lecture seule/);

    const lignes = lignesCompletes();
    assert.equal(lignes.length, 3, sortie);
    for (const ligne of lignes) assert.equal(JSON.parse(ligne).jsonrpc, "2.0");
  } finally {
    // L'enfant a pu mourir avant : ne pas attendre un « exit » déjà passé.
    if (enfant.exitCode === null && enfant.signalCode === null) {
      const fin = new Promise((r) => enfant.once("exit", r));
      enfant.stdin.end();
      enfant.kill();
      await fin;
    }
    rmSync(dossier, { recursive: true, force: true });
  }
});
