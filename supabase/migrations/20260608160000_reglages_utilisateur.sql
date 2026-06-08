-- Migration — réglages de génération par utilisateur (#45, P09).
-- Date : 2026-06-08
--
-- Une ligne par utilisateur (PK user_id) portant ses règles de génération :
--   - personnes_defaut : nombre de personnes des slots fraîchement générés
--     (RG-16 ; la base recette reste 2, seul le défaut affiché change) ;
--   - max_* : temps de préparation MAXIMUM autorisé par créneau (jour × repas).
--     L'éligibilité « temps ≤ plafond » généralise l'ancienne table en dur.
-- Ligne absente = réglages par défaut côté applicatif (REGLAGES_DEFAUT). Les
-- DEFAULT ci-dessous reflètent ce comportement antérieur (dîner de semaine
-- "rapide", déjeuner de semaine "normal", week-end "long").
-- Les CHECK valident l'enum et les bornes en défense en profondeur (en plus du
-- formulaire et de validerReglages côté applicatif).

create table reglages (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personnes_defaut int not null default 2
    check (personnes_defaut between 1 and 12),
  max_dejeuner_semaine text not null default 'normal'
    check (max_dejeuner_semaine in ('rapide', 'normal', 'long')),
  max_diner_semaine text not null default 'rapide'
    check (max_diner_semaine in ('rapide', 'normal', 'long')),
  max_dejeuner_weekend text not null default 'long'
    check (max_dejeuner_weekend in ('rapide', 'normal', 'long')),
  max_diner_weekend text not null default 'long'
    check (max_diner_weekend in ('rapide', 'normal', 'long')),
  updated_at timestamptz not null default now()
);

alter table reglages enable row level security;

-- Chaque utilisateur ne voit et ne modifie que ses propres réglages.
create policy "reglages: lecture propriétaire"
  on reglages for select
  using (auth.uid() = user_id);

create policy "reglages: insertion propriétaire"
  on reglages for insert
  with check (auth.uid() = user_id);

create policy "reglages: modification propriétaire"
  on reglages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reglages: suppression propriétaire"
  on reglages for delete
  using (auth.uid() = user_id);
