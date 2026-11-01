// Script de vidage du panier (#320, RG-82) : arguments, texte du bilan, code de sortie, et refus
// d'un argument inconnu avant toute connexion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeSortie, formaterBilan, lireArguments } from "../src/vider-panier.ts";
import type { BilanVidage, LigneRetrait, StatutRetrait } from "../src/panier.ts";

const SCRIPT = fileURLToPath(new URL("../src/vider-panier.ts", import.meta.url));

// Lance le script dans un dossier jetable : env Chronodrive vide (aucun identifiant), jamais de réseau.
async function lancer(args: string[], lanceur?: (dossier: string) => string): Promise<{ code: number | null; sortie: string; erreurs: string }> {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-vider-"));
  const envVide = join(dossier, "chronodrive.env");
  writeFileSync(envVide, "");
  const env: Record<string, string | undefined> = { ...process.env, CHRONODRIVE_ENV: envVide };
  for (const nom of ["CHRONODRIVE_EMAIL", "CHRONODRIVE_MOT_DE_PASSE", "CHRONODRIVE_SITE_ID", "CHRONODRIVE_SESSION", "CHRONODRIVE_LECTURE_SEULE"]) delete env[nom];
  try {
    const chemin = lanceur ? lanceur(dossier) : SCRIPT;
    const enfant = spawn(process.execPath, [chemin, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.setEncoding("utf8").on("data", (d: string) => (sortie += d));
    enfant.stderr.setEncoding("utf8").on("data", (d: string) => (erreurs += d));
    const code = await new Promise<number | null>((r) => enfant.once("close", r));
    return { code, sortie, erreurs };
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

function ligne(id: string, statut: StatutRetrait, extra: Partial<LigneRetrait> = {}): LigneRetrait {
  return { productId: id, libelle: `Produit ${id}`, marque: "Marque", quantite: 2, statut, erreur: null, ...extra };
}
function bilan(extra: Partial<BilanVidage>): BilanVidage {
  return { panierId: "p1", simulation: false, lignes: [], vide: false, relu: true, restantes: 0, ...extra };
}

test("arguments : aucun → vidage ; --simulation → simulation ; faute de frappe refusée", () => {
  assert.deepEqual(lireArguments([]), { simulation: false });
  assert.deepEqual(lireArguments(["--simulation"]), { simulation: true });
  const faute = lireArguments(["--simulaton"]);
  assert.ok("erreur" in faute);
  assert.match(faute.erreur, /--simulaton/);
  assert.ok("erreur" in lireArguments(["--simulation", "autre"]));
});

test("formaterBilan : simulation, vidé, partiel, non relu, déjà vide", () => {
  const simulation = formaterBilan(bilan({ simulation: true, lignes: [ligne("1", "simulee"), ligne("2", "simulee")] }));
  assert.match(simulation, /2 × Produit 1 · Marque — serait retiré/);
  assert.match(simulation, /Simulation : 2 ligne\(s\) seraient retirées, rien n'a été modifié\./);

  const vide = formaterBilan(bilan({ lignes: [ligne("1", "retiree"), ligne("2", "retiree")], vide: true }));
  assert.match(vide, /2 × Produit 1 · Marque — retiré/);
  assert.match(vide, /Panier vidé : 2 ligne\(s\) retirée\(s\), panier relu vide\./);

  const partiel = formaterBilan(bilan({ lignes: [ligne("1", "retiree"), ligne("2", "toujours_au_panier", { erreur: "HTTP 500" }), ligne("3", "non_tente")], restantes: 2 }));
  assert.match(partiel, /2 × Produit 2 · Marque — toujours au panier : HTTP 500/);
  assert.match(partiel, /2 × Produit 3 · Marque — non tenté \(connexion interrompue\)/);
  assert.match(partiel, /Panier pas entièrement vidé : 2 ligne\(s\) restent, vérifie dans l'appli Chronodrive\./);

  const nonRelu = formaterBilan(bilan({ lignes: [ligne("1", "non_verifie")], relu: false, restantes: null }));
  assert.match(nonRelu, /2 × Produit 1 · Marque — retrait non vérifié/);
  assert.match(nonRelu, /Panier non relu : vérifie dans l'appli Chronodrive\./);

  const dejaVide = formaterBilan(bilan({ vide: true }));
  assert.match(dejaVide, /Panier déjà vide\./);
  assert.match(formaterBilan(bilan({ simulation: true, vide: true })), /Panier déjà vide\./);
});

test("formaterBilan : « restent » vient de la relecture (ajout concurrent : 1 reste alors que toutes les lignes lues sont retirées)", () => {
  const texte = formaterBilan(bilan({ lignes: [ligne("1", "retiree")], restantes: 1 }));
  assert.match(texte, /1 ligne\(s\) restent, vérifie dans l'appli Chronodrive\./);
  assert.doesNotMatch(texte, /Panier vidé/);
});

test("formaterBilan : une ligne retirée n'affiche jamais son erreur (la relecture fait foi) ; sans marque, pas de séparateur", () => {
  const texte = formaterBilan(bilan({ lignes: [ligne("1", "retiree", { erreur: "HTTP 500", marque: null })], vide: true }));
  assert.match(texte, /2 × Produit 1 — retiré\n/);
  assert.doesNotMatch(texte, /HTTP 500/);
  assert.doesNotMatch(texte, /·/);
});

test("codeSortie : 0 en simulation ou vidé, 1 sinon", () => {
  assert.equal(codeSortie(bilan({ simulation: true, lignes: [ligne("1", "simulee")] })), 0);
  assert.equal(codeSortie(bilan({ vide: true })), 0);
  assert.equal(codeSortie(bilan({ lignes: [ligne("1", "toujours_au_panier")] })), 1);
  assert.equal(codeSortie(bilan({ lignes: [ligne("1", "non_verifie")], relu: false, restantes: null })), 1);
});

test("script : argument inconnu → code 2 sans réseau", { timeout: 30_000 }, async () => {
  const { code, sortie, erreurs } = await lancer(["--simulaton"]);
  assert.equal(code, 2, erreurs);
  assert.match(erreurs, /argument inconnu/);
  assert.equal(sortie, "");
});

test("script : --simulation sans identifiants → code 1, la variable manquante sur stderr, stdout vide, sans réseau", { timeout: 30_000 }, async () => {
  const { code, sortie, erreurs } = await lancer(["--simulation"]);
  assert.equal(code, 1, erreurs);
  assert.match(erreurs, /CHRONODRIVE_EMAIL/);
  assert.equal(sortie, "");
});

test("script : lancé par un lien (symbolique ou jonction), main s'exécute quand même", { timeout: 30_000 }, async () => {
  // Lien vers le dossier src/ (une jonction suffit sous Windows, sans droit de lien symbolique) :
  // `argv[1]` garde le chemin du lien, `import.meta.url` est le chemin réel.
  const dossierSrc = fileURLToPath(new URL("../src/", import.meta.url));
  const resultat = await lancer(["--simulaton"], (dossier) => {
    const lien = join(dossier, "src-lie");
    symlinkSync(dossierSrc, lien, "junction");
    return join(lien, "vider-panier.ts");
  });
  assert.equal(resultat.code, 2, resultat.erreurs);
  assert.match(resultat.erreurs, /argument inconnu/);
});
