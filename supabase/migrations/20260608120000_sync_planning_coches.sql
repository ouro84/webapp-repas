-- Migration — persistance & synchronisation multi-device (#6, US-13).
-- Date : 2026-06-08
--
-- Prépare la base comme source de vérité du planning et des coches :
--   1. planning_slot porte désormais le nombre de personnes (US-07) et le flag
--      « restes » (US-12) — sinon ces réglages seraient perdus à la persistance.
--   2. planning gagne un updated_at (résolution last-write-wins entre devices).
--   3. nouvelle table etat_courses : l'état coché/décoché de la liste de
--      courses, par utilisateur (blob JSONB { "nom|unité": quantité }).
--
-- Colonnes ajoutées avec DEFAULT : les éventuelles lignes existantes restent
-- valides (aucune donnée de planning persistée à ce jour, mais par sûreté).

alter table planning_slot
  add column personnes int not null default 2,
  add column restes boolean not null default false;

alter table planning
  add column updated_at timestamptz not null default now();

-- ------------------------------------------------------------
-- État des coches de la liste de courses (US-13, RG-12/RG-13)
-- ------------------------------------------------------------
create table etat_courses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coches jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table etat_courses enable row level security;

-- Chaque utilisateur ne voit et ne modifie que son propre état de coches.
create policy "etat_courses: lecture propriétaire"
  on etat_courses for select
  using (auth.uid() = user_id);

create policy "etat_courses: insertion propriétaire"
  on etat_courses for insert
  with check (auth.uid() = user_id);

create policy "etat_courses: modification propriétaire"
  on etat_courses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "etat_courses: suppression propriétaire"
  on etat_courses for delete
  using (auth.uid() = user_id);
