-- Migration 002 — Activation RLS et policies de sécurité
-- Date : 2026-06-03
-- Description : Row Level Security sur toutes les tables + policies par utilisateur

-- Activer RLS sur toutes les tables
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
