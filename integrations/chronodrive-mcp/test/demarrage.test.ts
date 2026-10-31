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

test("démarrage stdio : initialize puis tools/list, stdout en JSON-RPC seulement", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-mcp-"));
  const envVide = join(dossier, "chronodrive.env");
  writeFileSync(envVide, "");
  const env: Record<string, string | undefined> = { ...process.env, CHRONODRIVE_ENV: envVide, CHRONODRIVE_CACHE: join(dossier, "cache.sqlite") };
  for (const nom of ["CHRONODRIVE_EMAIL", "CHRONODRIVE_MOT_DE_PASSE", "CHRONODRIVE_SITE_ID", "CHRONODRIVE_SESSION"]) delete env[nom];

  const enfant = spawn(process.execPath, [MCP], { env, stdio: ["pipe", "pipe", "pipe"] });
  let sortie = "";
  let erreurs = "";
  enfant.stdout.setEncoding("utf8").on("data", (d: string) => (sortie += d));
  enfant.stderr.setEncoding("utf8").on("data", (d: string) => (erreurs += d));

  const attendreReponse = async (id: number) => {
    const limite = Date.now() + 10_000;
    while (Date.now() < limite) {
      const ligne = sortie.split("\n").find((l) => l.includes(`"id":${id}`));
      if (ligne) return JSON.parse(ligne) as { result?: Record<string, unknown>; error?: unknown };
      if (enfant.exitCode !== null) break;
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

    const lignes = sortie.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lignes.length, 2, sortie);
    for (const ligne of lignes) assert.equal(JSON.parse(ligne).jsonrpc, "2.0");
  } finally {
    const fin = new Promise((r) => enfant.once("exit", r));
    enfant.stdin.end();
    enfant.kill();
    await fin;
    rmSync(dossier, { recursive: true, force: true });
  }
});
