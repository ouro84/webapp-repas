// Vide le panier Chronodrive courant (#320, RG-82). Jamais depuis un run Hermes : le run webhook ne voit
// aucun outil de retrait (RG-82). Le serveur MCP séparé `chronodrive-admin` (src/admin.ts) expose le
// vidage à Telegram (`vider_panier`). À lancer À LA MAIN sur le NAS ; Claude Code ne le lance que sur
// ordre explicite d'Arnaud. Jamais de commande, de créneau ni de paiement.
//
// Usage : node src/vider-panier.ts [--simulation]
//   --simulation  liste ce qui serait retiré, sans rien modifier.
// Code de sortie : 0 panier vidé (relu vide) ou simulation ; 1 panier pas vidé ou non relu, ou erreur ;
// 2 argument inconnu (refusé avant toute connexion).
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { formaterBilan } from "./bilan-vidage.ts";
import { fabriqueClient } from "./client.ts";
import { messagePourLeLlm } from "./outils.ts";
import { viderPanier, type BilanVidage } from "./panier.ts";

export function lireArguments(argv: string[]): { simulation: boolean } | { erreur: string } {
  let simulation = false;
  for (const arg of argv) {
    if (arg !== "--simulation") return { erreur: `argument inconnu : ${arg} (seul --simulation est accepté)` };
    simulation = true;
  }
  return { simulation };
}

export function codeSortie(b: BilanVidage): 0 | 1 {
  return b.simulation || b.vide ? 0 : 1;
}

async function main(): Promise<void> {
  const args = lireArguments(process.argv.slice(2));
  if ("erreur" in args) {
    process.stderr.write(`${args.erreur}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const bilan = await viderPanier(fabriqueClient()(), { simulation: args.simulation });
    process.stdout.write(`${formaterBilan(bilan)}\n`);
    process.exitCode = codeSortie(bilan);
  } catch (e) {
    process.stderr.write(`${messagePourLeLlm(e)}\n`);
    process.exitCode = 1;
  }
}

// `argv[1]` peut passer par un lien symbolique alors que `import.meta.url` est le chemin réel.
function estLance(): boolean {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (estLance()) await main();
