// Génère le bloc d'UPDATE de tagging des saisons du catalogue global (#23, P12)
// à partir de data/recettes.json. Émet sur stdout les instructions SQL
// `update recette set saisons = '{...}' where nom = ... and user_id is null;`
// pour les recettes saisonnières (les autres restent NULL = toute l'année).
//
// Usage : node scripts/generer-saisons-recettes.mjs
//   (copier la sortie dans la migration ..._recette_saisons.sql)
//
// ⚠️ MIROIR de lib/saisons.ts (PRODUITS_SAISON + suggererSaisons) : la table
// produit→saisons ci-dessous DOIT rester synchrone avec celle de lib/saisons.ts
// (cf. piège CLAUDE.md). On ne peut pas importer le .ts ici ; ce script est le
// générateur figé de la migration (régénérer si data/recettes.json ou la table
// évoluent).

import { readFileSync } from "node:fs";

const recettes = JSON.parse(readFileSync("data/recettes.json", "utf8"));

const SAISONS = ["printemps", "ete", "automne", "hiver"];
const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Miroir de lib/saisons.ts PRODUITS_SAISON.
const PRODUITS = [
  ["tomate", ["ete"]],
  ["courgette", ["ete"]],
  ["poivron", ["ete"]],
  ["concombre", ["ete"]],
  ["aubergine", ["ete"]],
  ["haricot vert", ["ete"]],
  ["mais", ["ete"]],
  ["butternut", ["automne", "hiver"]],
  ["potiron", ["automne", "hiver"]],
  ["courge", ["automne", "hiver"]],
  ["brocoli", ["automne", "hiver"]],
  ["chou-fleur", ["automne", "hiver"]],
  ["choufleur", ["automne", "hiver"]],
  ["chou de bruxelles", ["automne", "hiver"]],
  ["navet", ["automne", "hiver"]],
  ["poireau", ["automne", "hiver"]],
  ["betterave", ["automne", "hiver"]],
  ["endive", ["hiver"]],
  ["asperge", ["printemps"]],
  ["radis", ["printemps"]],
  ["petit pois", ["printemps", "ete"]],
  ["fraise", ["printemps", "ete"]],
  ["epinard", ["printemps", "automne"]],
  ["fenouil", ["ete", "automne"]],
  ["artichaut", ["printemps", "ete"]],
];

function suggererSaisons(ingredients) {
  const sets = [];
  for (const ing of ingredients) {
    const n = norm(ing.nom);
    const e = PRODUITS.find(([motif]) => n.includes(motif));
    if (e) sets.push(e[1]);
  }
  if (sets.length === 0) return [];
  return SAISONS.filter((s) => sets.every((set) => set.includes(s)));
}

// Échappement SQL d'un littéral texte (quotes doublées).
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const lignes = [];
for (const r of recettes) {
  const saisons = suggererSaisons(r.ingredients);
  if (saisons.length === 0) continue; // toute l'année → reste NULL
  const arr = `'{${saisons.join(",")}}'`;
  lignes.push(
    `update recette set saisons = ${arr} where nom = ${q(r.nom)} and user_id is null;`
  );
}

process.stdout.write(lignes.join("\n") + "\n");
