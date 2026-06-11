-- Migration — masquage des recettes par défaut (#105 PR1).
-- Date : 2026-06-11
--
-- Le catalogue par défaut (recettes user_id IS NULL) est global et partagé en
-- lecture seule (RLS, cf. ...recettes_globales.sql) : un utilisateur ne peut pas
-- le SUPPRIMER réellement. « Supprimer » une recette par défaut est donc un
-- MASQUAGE propre à l'utilisateur (réversible, undo transitoire côté client).
--
-- Périmètre VOLONTAIREMENT par-utilisateur : la RG d'origine « masquage propre à
-- la famille » est reportée à #56 (gestion des familles), qui devra basculer
-- cette table en scope famille (user_id → famille_id).
--
-- Une recette masquée n'est plus servie ni par la génération (filtrage serveur
-- dans app/api/planning/generer/route.ts) ni par le chargement client
-- (lib/recettes.ts : sélecteur manuel, « ↺ changer », page recettes).

create table recette_masquee (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recette_id uuid not null references recette(id)    on delete cascade,
  masquee_le timestamptz not null default now(),
  primary key (user_id, recette_id)
);

-- Index pour le filtrage par utilisateur (lectures fréquentes : génération + listes).
create index recette_masquee_user_idx on recette_masquee (user_id);

-- RLS : chaque utilisateur ne voit et ne gère que SES masquages.
alter table recette_masquee enable row level security;

create policy "recette_masquee: lecture propriétaire"
  on recette_masquee for select
  using (auth.uid() = user_id);

create policy "recette_masquee: insertion propriétaire"
  on recette_masquee for insert
  with check (auth.uid() = user_id);

create policy "recette_masquee: suppression propriétaire"
  on recette_masquee for delete
  using (auth.uid() = user_id);
