-- Migration 001 — Création du schéma initial
-- Date : 2026-06-03
-- Description : Tables ingredient, recette, recette_ingredient, planning, planning_slot

-- Extension pour générer des UUIDs automatiquement
create extension if not exists "uuid-ossp";

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
