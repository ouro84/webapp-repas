// Vide le panier Chronodrive courant (#320, RG-82). À lancer À LA MAIN sur le NAS, ou par Claude Code
// via ssh : hors run, jamais exposé à un LLM, jamais de commande, de créneau ni de paiement.
//
// Usage : node src/vider-panier.ts [--simulation]
//   --simulation  liste ce qui serait retiré, sans rien modifier.
// Code de sortie : 0 panier vidé (relu vide) ou simulation ; 1 panier pas vidé ou non relu, ou erreur ;
// 2 argument inconnu (refusé avant toute connexion).
import { pathToFileURL } from "node:url";
import { fabriqueClient } from "./client.ts";
import { messagePourLeLlm } from "./outils.ts";
import { viderPanier, type BilanVidage, type StatutRetrait } from "./panier.ts";

export function lireArguments(argv: string[]): { simulation: boolean } | { erreur: string } {
  let simulation = false;
  for (const arg of argv) {
    if (arg !== "--simulation") return { erreur: `argument inconnu : ${arg} (seul --simulation est accepté)` };
    simulation = true;
  }
  return { simulation };
}

const STATUTS: Record<StatutRetrait, string> = {
  simulee: "serait retiré",
  retiree: "retiré",
  toujours_au_panier: "toujours au panier",
  non_tente: "non tenté (connexion interrompue)",
  non_verifie: "retrait non vérifié",
};

export function formaterBilan(b: BilanVidage): string {
  const lignes = b.lignes.map((l) => {
    const produit = `${l.quantite} × ${l.libelle}${l.marque ? ` · ${l.marque}` : ""}`;
    // Une ligne retirée n'affiche pas son erreur : le DELETE a pu échouer alors que la relecture
    // montre la ligne partie, et c'est la relecture qui fait foi.
    const erreur = l.erreur && l.statut !== "retiree" ? ` : ${l.erreur}` : "";
    return `${produit} — ${STATUTS[l.statut]}${erreur}`;
  });
  const n = b.lignes.length;
  let conclusion: string;
  if (n === 0 && b.vide) conclusion = "Panier déjà vide.";
  else if (b.simulation) conclusion = `Simulation : ${n} ligne(s) seraient retirées, rien n'a été modifié.`;
  else if (b.vide) conclusion = `Panier vidé : ${n} ligne(s) retirée(s), panier relu vide.`;
  else if (!b.relu) conclusion = "Panier non relu : vérifie dans l'appli Chronodrive.";
  else conclusion = `Panier pas entièrement vidé : ${b.lignes.filter((l) => l.statut !== "retiree").length} ligne(s) restent, vérifie dans l'appli Chronodrive.`;
  return [...lignes, conclusion].join("\n");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
