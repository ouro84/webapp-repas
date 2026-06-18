-- Migration — durcissement de la table `ingredient` (audit de sécurité F-06,
-- issue #193). Date : 2026-06-18
--
-- Constat : `ingredient` est un catalogue global. Sa policy SELECT était
-- `using (true)` (lisible même par le rôle `anon`), l'insertion ouverte à tout
-- authentifié, sans contrainte d'unicité ni borne de longueur, et sans aucun
-- nettoyage possible → lecture par anon + croissance/pollution non bornée.
--
-- Corrections (vérifié au préalable : 0 doublon de triplet sur prod ET staging,
-- nom le plus long = 27 car. → l'ajout des contraintes ne casse aucune donnée
-- existante ; pas besoin d'étape de déduplication de données) :
--   1. Lecture restreinte aux utilisateurs AUTHENTIFIÉS.
--   2. CHECK de longueur sur `nom` (1..100).
--   3. UNIQUE (nom, categorie, fond_de_placard) → empêche les futurs doublons
--      (le find-or-create client déduplique déjà sur ce triplet ; la contrainte
--      le garantit côté base — cf. gestion du conflit 23505 dans lib/recettes.ts).
--   4. Purge ONE-SHOT des ingrédients orphelins (non référencés par aucune
--      recette_ingredient). La purge tourne au rôle propriétaire de la migration
--      (contourne la RLS) ; aucun DELETE n'est exposé au client.
--
-- Note : sur une base neuve, le seed (`..._recettes_globales.sql`, timestamp
-- antérieur) insère d'abord ses ingrédients (tous liés à une recette → aucun
-- orphelin), puis cette migration ajoute les contraintes. Les ingrédients du
-- seed respectent length<=100 et n'ont pas de doublon de triplet.

-- 1. Lecture réservée aux authentifiés (remplace `using (true)`).
drop policy if exists "ingredient: lecture publique" on ingredient;
create policy "ingredient: lecture authentifiée"
  on ingredient for select
  using (auth.uid() is not null);

-- 2. Borne de longueur du nom (défense en profondeur côté base).
alter table ingredient
  add constraint ingredient_nom_longueur check (char_length(nom) between 1 and 100);

-- 3. Unicité du triplet d'identité d'un ingrédient.
alter table ingredient
  add constraint ingredient_triplet_unique unique (nom, categorie, fond_de_placard);

-- 4. Purge one-shot des orphelins (ingrédients plus liés à aucune recette).
delete from ingredient i
  where not exists (
    select 1 from recette_ingredient ri where ri.ingredient_id = i.id
  );
