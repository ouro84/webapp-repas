-- Migration baseline — schéma initial complet
-- Date : 2026-06-06
-- Remplace les migrations manuelles 20260603_001_create_tables.sql et
-- 20260603_002_enable_rls.sql (mêmes contenus, format Supabase CLI).
-- Vérifiée ligne à ligne contre le schéma réel de la prod via l'API de
-- management le 2026-06-06 : tables, contraintes, policies, index
-- (aucun explicite), triggers (aucun) — correspondance exacte.

-- Extension pour générer des UUIDs automatiquement
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- Tables et contraintes
-- ------------------------------------------------------------

-- Table des ingrédients (entités indépendantes)
create table ingredient (
  id uuid primary key default uuid_generate_v4(),
  nom text not null,
  categorie text not null check (categorie in (
    'viandes-poissons',
    'legumes-fruits',
    'produits-frais',
    'epicerie',
    'boulangerie',
    'surgeles',
    'autre'
  )),
  fond_de_placard boolean not null default false,
  created_at timestamptz not null default now()
);

-- Table des recettes
create table recette (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  nom text not null,
  temps_preparation text not null check (temps_preparation in ('rapide', 'normal', 'long')),
  created_at timestamptz not null default now()
);

-- Table de jointure recette ↔ ingrédient (avec quantité et unité)
create table recette_ingredient (
  id uuid primary key default uuid_generate_v4(),
  recette_id uuid not null references recette(id) on delete cascade,
  ingredient_id uuid not null references ingredient(id) on delete cascade,
  quantite numeric not null,
  unite text not null check (unite in (
    'g', 'kg', 'ml', 'cl', 'l',
    'piece', 'briquette', 'bouteille', 'boite', 'sachet',
    'cas', 'cac', 'autre'
  )),
  unique(recette_id, ingredient_id)
);

-- Table des plannings
create table planning (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  semaine text not null,
  created_at timestamptz not null default now(),
  unique(user_id, semaine)
);

-- Table des slots du planning (jointure planning ↔ recette)
create table planning_slot (
  id uuid primary key default uuid_generate_v4(),
  planning_id uuid not null references planning(id) on delete cascade,
  recette_id uuid not null references recette(id) on delete cascade,
  jour text not null check (jour in (
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'
  )),
  type_repas text not null check (type_repas in ('dejeuner', 'diner')),
  unique(planning_id, jour, type_repas)
);

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------

alter table ingredient enable row level security;
alter table recette enable row level security;
alter table recette_ingredient enable row level security;
alter table planning enable row level security;
alter table planning_slot enable row level security;

-- RECETTE : chaque utilisateur ne voit et ne modifie que ses recettes
create policy "recette: lecture propriétaire"
  on recette for select
  using (auth.uid() = user_id);

create policy "recette: insertion propriétaire"
  on recette for insert
  with check (auth.uid() = user_id);

create policy "recette: modification propriétaire"
  on recette for update
  using (auth.uid() = user_id);

create policy "recette: suppression propriétaire"
  on recette for delete
  using (auth.uid() = user_id);

-- RECETTE_INGREDIENT : accessible si on possède la recette parente
create policy "recette_ingredient: lecture propriétaire"
  on recette_ingredient for select
  using (
    exists (
      select 1 from recette
      where recette.id = recette_ingredient.recette_id
      and recette.user_id = auth.uid()
    )
  );

create policy "recette_ingredient: insertion propriétaire"
  on recette_ingredient for insert
  with check (
    exists (
      select 1 from recette
      where recette.id = recette_ingredient.recette_id
      and recette.user_id = auth.uid()
    )
  );

create policy "recette_ingredient: suppression propriétaire"
  on recette_ingredient for delete
  using (
    exists (
      select 1 from recette
      where recette.id = recette_ingredient.recette_id
      and recette.user_id = auth.uid()
    )
  );

-- INGREDIENT : lecture publique (catalogue partagé), insertion authentifiée
create policy "ingredient: lecture publique"
  on ingredient for select
  using (true);

create policy "ingredient: insertion authentifiée"
  on ingredient for insert
  with check (auth.uid() is not null);

-- PLANNING : chaque utilisateur ne voit que ses plannings
create policy "planning: lecture propriétaire"
  on planning for select
  using (auth.uid() = user_id);

create policy "planning: insertion propriétaire"
  on planning for insert
  with check (auth.uid() = user_id);

create policy "planning: suppression propriétaire"
  on planning for delete
  using (auth.uid() = user_id);

-- PLANNING_SLOT : accessible si on possède le planning parent
create policy "planning_slot: lecture propriétaire"
  on planning_slot for select
  using (
    exists (
      select 1 from planning
      where planning.id = planning_slot.planning_id
      and planning.user_id = auth.uid()
    )
  );

create policy "planning_slot: insertion propriétaire"
  on planning_slot for insert
  with check (
    exists (
      select 1 from planning
      where planning.id = planning_slot.planning_id
      and planning.user_id = auth.uid()
    )
  );

create policy "planning_slot: suppression propriétaire"
  on planning_slot for delete
  using (
    exists (
      select 1 from planning
      where planning.id = planning_slot.planning_id
      and planning.user_id = auth.uid()
    )
  );
