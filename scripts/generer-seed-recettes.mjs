// Génère la migration d'amorçage des recettes globales (#2, PR1) à partir de
// data/recettes.json. Émet sur stdout le SQL complet :
//   1. mise à jour des policies SELECT (recette + recette_ingredient) pour
//      autoriser les recettes globales (user_id IS NULL) ;
//   2. seed idempotent des 74 recettes en globales (catalogue partagé).
//
// Usage : node scripts/generer-seed-recettes.mjs > supabase/migrations/<ts>_recettes_globales.sql
//
// Reproductible : régénérer si data/recettes.json évolue (la migration reste
// la trace figée ; ce script en est le générateur).

import { readFileSync } from "node:fs";

const recettes = JSON.parse(readFileSync("data/recettes.json", "utf8"));

// Échappement SQL d'un littéral texte (quotes doublées).
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Ingrédients distincts par triplet (nom, catégorie, fond_de_placard) :
// le catalogue partagé n'a pas d'unicité sur le nom seul (cf. CLAUDE.md,
// divergence d'attributs → entrées distinctes, fidèle aux données).
const ingredients = new Map();
for (const r of recettes) {
  for (const i of r.ingredients) {
    const cle = `${i.nom}|${i.categorie}|${i.fondDePlacard}`;
    if (!ingredients.has(cle)) ingredients.set(cle, i);
  }
}

const lignes = [];
lignes.push("-- Migration — recettes globales (catalogue partagé) — #2 PR1");
lignes.push("-- Générée par scripts/generer-seed-recettes.mjs depuis data/recettes.json.");
lignes.push("-- 1) RLS : les recettes globales (user_id IS NULL) sont visibles de tous,");
lignes.push("--    en lecture seule (insert/update/delete restent « propriétaire »).");
lignes.push("-- 2) Seed idempotent des 74 recettes de base en globales.");
lignes.push("");
lignes.push("-- ------------------------------------------------------------");
lignes.push("-- 1. RLS : lecture globale OU propriétaire");
lignes.push("-- ------------------------------------------------------------");
lignes.push(`drop policy if exists "recette: lecture propriétaire" on recette;`);
lignes.push(`drop policy if exists "recette: lecture globale ou propriétaire" on recette;`);
lignes.push(`create policy "recette: lecture globale ou propriétaire"`);
lignes.push(`  on recette for select`);
lignes.push(`  using (user_id is null or auth.uid() = user_id);`);
lignes.push("");
lignes.push(`drop policy if exists "recette_ingredient: lecture propriétaire" on recette_ingredient;`);
lignes.push(`drop policy if exists "recette_ingredient: lecture globale ou propriétaire" on recette_ingredient;`);
lignes.push(`create policy "recette_ingredient: lecture globale ou propriétaire"`);
lignes.push(`  on recette_ingredient for select`);
lignes.push(`  using (`);
lignes.push(`    exists (`);
lignes.push(`      select 1 from recette`);
lignes.push(`      where recette.id = recette_ingredient.recette_id`);
lignes.push(`      and (recette.user_id is null or recette.user_id = auth.uid())`);
lignes.push(`    )`);
lignes.push(`  );`);
lignes.push("");
lignes.push("-- ------------------------------------------------------------");
lignes.push("-- 2. Seed idempotent des recettes globales");
lignes.push("-- ------------------------------------------------------------");
lignes.push("do $$");
lignes.push("declare");
lignes.push("  rid uuid;");
lignes.push("begin");
lignes.push("  -- Garde-fou : ne rien faire si le catalogue global existe déjà.");
lignes.push("  if exists (select 1 from recette where user_id is null) then");
lignes.push("    return;");
lignes.push("  end if;");
lignes.push("");
lignes.push("  -- Ingrédients distincts du catalogue.");
lignes.push("  insert into ingredient (nom, categorie, fond_de_placard) values");
const valsIng = [...ingredients.values()].map(
  (i) => `    (${q(i.nom)}, ${q(i.categorie)}, ${i.fondDePlacard})`
);
lignes.push(valsIng.join(",\n") + ";");
lignes.push("");
lignes.push("  -- Recettes globales + leurs liens ingrédients.");
for (const r of recettes) {
  lignes.push(
    `  insert into recette (nom, temps_preparation, user_id) values (${q(r.nom)}, ${q(r.tempsPreparation)}, null) returning id into rid;`
  );
  const liens = r.ingredients.map(
    (i) =>
      `    (${q(i.nom)}, ${q(i.categorie)}, ${i.fondDePlacard}, ${i.quantite}, ${q(i.unite)})`
  );
  lignes.push(
    `  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)`
  );
  lignes.push(`    select rid, ing.id, v.quantite, v.unite from (values`);
  lignes.push(liens.join(",\n"));
  lignes.push(
    `    ) as v(nom, categorie, fond, quantite, unite)`
  );
  lignes.push(
    `    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;`
  );
}
lignes.push("end $$;");
lignes.push("");

process.stdout.write(lignes.join("\n"));
