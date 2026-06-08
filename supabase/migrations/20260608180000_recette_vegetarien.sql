-- Migration — flag végétarien sur les recettes (#86, P10).
-- Date : 2026-06-08
--
-- Ajoute recette.vegetarien (défaut false → recettes existantes valides). Le
-- catalogue global (user_id IS NULL) étant en lecture seule (RLS), on l'auto-
-- tague ici par heuristique : une recette est végétarienne si AUCUN de ses
-- ingrédients n'est en catégorie « viandes-poissons » (œufs/laitages OK).
-- Imparfait (ex. sauce poisson) mais bon défaut ; les recettes perso sont
-- ensuite gérées via le flag du formulaire. L'UPDATE couvre aussi un rejeu sur
-- base neuve (il s'exécute après le seed du catalogue).

alter table recette add column vegetarien boolean not null default false;

update recette r
set vegetarien = true
where not exists (
  select 1
  from recette_ingredient ri
  join ingredient i on i.id = ri.ingredient_id
  where ri.recette_id = r.id
    and i.categorie = 'viandes-poissons'
);
