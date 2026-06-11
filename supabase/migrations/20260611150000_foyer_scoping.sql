-- Migration — bascule de la propriété des données vers le Foyer (#56 PR2).
-- Date : 2026-06-11
--
-- Suite du socle (#56 PR1 : foyers/profiles, mon_foyer()). On fait passer la
-- propriété de `user_id` (par-utilisateur) à `foyer_id` (par-foyer) pour les
-- données PARTAGÉES, et on réécrit toutes les RLS en conséquence.
--
-- Tables basculées : recette, recette_ingredient (via parent), planning,
-- planning_slot (via parent), etat_courses, recette_masquee.
-- NON basculée (reste PAR-UTILISATEUR, RG #56) : `reglages`.
--
-- ⚠️ PIÈGE recette : le catalogue global = `user_id IS NULL`. On NE remplace PAS
-- user_id ; on AJOUTE `foyer_id` (NULL pour les globales, = foyer pour les
-- perso). La RLS de lecture devient « foyer_id IS NULL OR foyer_id = mon_foyer() ».
--
-- ⚠️ Écritures planning + coches : passent désormais par des RPC SECURITY
-- DEFINER ATOMIQUES (sauvegarder_planning / sauvegarder_coches), qui dérivent le
-- foyer de mon_foyer(). Cela corrige la concurrence cross-device (le delete→
-- insert client n'était pas atomique : duplicate key / état partiel à deux
-- appareils) et porte la colonne `version` du planning (bonus, exploité en PR5).
--
-- ⚠️ Ordre migrations (staging partagé) : à merger après #56 PR1.

-- ============================================================================
-- 1. RECETTE — ajout foyer_id (NULL = catalogue global), backfill, RLS foyer
-- ============================================================================

-- default mon_foyer() : les créations via l'app (recettes perso) reçoivent
-- automatiquement le foyer du créateur. Les globales (insérées par migration)
-- gardent foyer_id NULL. À l'ADD COLUMN, mon_foyer() vaut NULL (pas d'auth.uid()
-- en contexte migration) → les lignes existantes passent à NULL, puis on
-- backfille les perso ci-dessous.
alter table recette
  add column foyer_id uuid references foyers(id) default mon_foyer();

-- Backfill : chaque recette perso (user_id non null) prend le foyer de son
-- créateur. Les globales (user_id NULL) restent foyer_id NULL.
update recette r
  set foyer_id = p.foyer_id
  from profiles p
  where r.user_id = p.user_id;

create index recette_foyer_idx on recette (foyer_id);

-- RLS : lecture = global OU mon foyer ; écriture = mon foyer (RG-30 : tout
-- membre édite/supprime les recettes du foyer ; les globales restent en lecture
-- seule car foyer_id IS NULL ≠ mon_foyer()).
drop policy if exists "recette: lecture globale ou propriétaire" on recette;
drop policy if exists "recette: insertion propriétaire" on recette;
drop policy if exists "recette: modification propriétaire" on recette;
drop policy if exists "recette: suppression propriétaire" on recette;

create policy "recette: lecture globale ou foyer"
  on recette for select
  using (foyer_id is null or foyer_id = mon_foyer());

create policy "recette: insertion foyer"
  on recette for insert
  with check (foyer_id = mon_foyer());

create policy "recette: modification foyer"
  on recette for update
  using (foyer_id = mon_foyer())
  with check (foyer_id = mon_foyer());

create policy "recette: suppression foyer"
  on recette for delete
  using (foyer_id = mon_foyer());

-- recette_ingredient : accessibilité dérivée de la recette parente.
drop policy if exists "recette_ingredient: lecture globale ou propriétaire" on recette_ingredient;
drop policy if exists "recette_ingredient: insertion propriétaire" on recette_ingredient;
drop policy if exists "recette_ingredient: suppression propriétaire" on recette_ingredient;

create policy "recette_ingredient: lecture globale ou foyer"
  on recette_ingredient for select
  using (exists (
    select 1 from recette
    where recette.id = recette_ingredient.recette_id
    and (recette.foyer_id is null or recette.foyer_id = mon_foyer())
  ));

create policy "recette_ingredient: insertion foyer"
  on recette_ingredient for insert
  with check (exists (
    select 1 from recette
    where recette.id = recette_ingredient.recette_id
    and recette.foyer_id = mon_foyer()
  ));

create policy "recette_ingredient: suppression foyer"
  on recette_ingredient for delete
  using (exists (
    select 1 from recette
    where recette.id = recette_ingredient.recette_id
    and recette.foyer_id = mon_foyer()
  ));

-- ============================================================================
-- 2. PLANNING — foyer_id + version, retrait de user_id, RLS foyer
-- ============================================================================

alter table planning
  add column foyer_id uuid references foyers(id),
  add column version int not null default 1;

-- Backfill depuis le propriétaire AVANT de retirer user_id.
update planning pl
  set foyer_id = p.foyer_id
  from profiles p
  where pl.user_id = p.user_id;

-- unique(user_id, semaine) → unique(foyer_id, semaine) (un planning par foyer
-- et par semaine, partagé entre membres).
alter table planning drop constraint if exists planning_user_id_semaine_key;
alter table planning drop column user_id;
alter table planning add constraint planning_foyer_id_semaine_key unique (foyer_id, semaine);
create index planning_foyer_idx on planning (foyer_id);

-- RLS : lecture + suppression (la purge de rétention #5 est un DELETE client).
-- Les insertions/maj passent par la RPC sauvegarder_planning (SECURITY DEFINER,
-- contourne la RLS) → pas de policy insert/update.
drop policy if exists "planning: lecture propriétaire" on planning;
drop policy if exists "planning: insertion propriétaire" on planning;
drop policy if exists "planning: suppression propriétaire" on planning;

create policy "planning: lecture foyer"
  on planning for select
  using (foyer_id = mon_foyer());

create policy "planning: suppression foyer"
  on planning for delete
  using (foyer_id = mon_foyer());

-- planning_slot : lecture dérivée du planning parent. Écritures via la RPC.
drop policy if exists "planning_slot: lecture propriétaire" on planning_slot;
drop policy if exists "planning_slot: insertion propriétaire" on planning_slot;
drop policy if exists "planning_slot: suppression propriétaire" on planning_slot;

create policy "planning_slot: lecture foyer"
  on planning_slot for select
  using (exists (
    select 1 from planning
    where planning.id = planning_slot.planning_id
    and planning.foyer_id = mon_foyer()
  ));

-- ============================================================================
-- 3. ETAT_COURSES — foyer_id (PK), retrait de user_id, RLS foyer
-- ============================================================================

alter table etat_courses
  add column foyer_id uuid references foyers(id);

update etat_courses ec
  set foyer_id = p.foyer_id
  from profiles p
  where ec.user_id = p.user_id;

-- Défensif (devrait ne rien supprimer : tout compte a un profil depuis PR1).
delete from etat_courses where foyer_id is null;

alter table etat_courses drop constraint etat_courses_pkey;
alter table etat_courses drop column user_id;
alter table etat_courses add primary key (foyer_id, semaine);

-- RLS : lecture + suppression (purge). Upsert via RPC sauvegarder_coches.
drop policy if exists "etat_courses: lecture propriétaire" on etat_courses;
drop policy if exists "etat_courses: insertion propriétaire" on etat_courses;
drop policy if exists "etat_courses: modification propriétaire" on etat_courses;
drop policy if exists "etat_courses: suppression propriétaire" on etat_courses;

create policy "etat_courses: lecture foyer"
  on etat_courses for select
  using (foyer_id = mon_foyer());

create policy "etat_courses: suppression foyer"
  on etat_courses for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 4. RECETTE_MASQUEE — foyer_id (PK), retrait de user_id, RLS foyer
--    (un masquage devient partagé par tout le foyer — cf. #105 PR1 → #56)
-- ============================================================================

alter table recette_masquee
  add column foyer_id uuid references foyers(id) default mon_foyer();

update recette_masquee rm
  set foyer_id = p.foyer_id
  from profiles p
  where rm.user_id = p.user_id;

delete from recette_masquee where foyer_id is null;

-- L'index recette_masquee_user_idx part avec la colonne user_id.
alter table recette_masquee drop constraint recette_masquee_pkey;
alter table recette_masquee drop column user_id;
alter table recette_masquee add primary key (foyer_id, recette_id);
create index recette_masquee_foyer_idx on recette_masquee (foyer_id);

-- RLS : lecture + insertion + suppression (masquer/démasquer = accès direct
-- client ; foyer_id rempli par default mon_foyer() à l'insertion).
drop policy if exists "recette_masquee: lecture propriétaire" on recette_masquee;
drop policy if exists "recette_masquee: insertion propriétaire" on recette_masquee;
drop policy if exists "recette_masquee: suppression propriétaire" on recette_masquee;

create policy "recette_masquee: lecture foyer"
  on recette_masquee for select
  using (foyer_id = mon_foyer());

create policy "recette_masquee: insertion foyer"
  on recette_masquee for insert
  with check (foyer_id = mon_foyer());

create policy "recette_masquee: suppression foyer"
  on recette_masquee for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 5. RPC d'écriture atomique (SECURITY DEFINER, foyer dérivé de mon_foyer())
-- ============================================================================

-- Remplace un planning de semaine en UNE transaction : upsert de la ligne
-- planning (conserve la même ligne → `version` persiste et s'incrémente) puis
-- remplacement intégral des slots. Atomique → pas de duplicate key ni d'état
-- partiel quand deux appareils du foyer écrivent. Renvoie l'updated_at posé par
-- le trigger serveur (#104), horloge de référence du last-write-wins (#6).
create or replace function sauvegarder_planning(p_semaine text, p_slots jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_planning_id uuid;
  v_updated timestamptz;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  insert into planning (foyer_id, semaine)
    values (v_foyer, p_semaine)
    on conflict (foyer_id, semaine)
      do update set version = planning.version + 1
    returning id, updated_at into v_planning_id, v_updated;

  delete from planning_slot where planning_id = v_planning_id;

  insert into planning_slot (planning_id, recette_id, jour, type_repas, personnes, restes)
  select
    v_planning_id,
    (s->>'recette_id')::uuid,
    s->>'jour',
    s->>'type_repas',
    coalesce((s->>'personnes')::int, 2),
    coalesce((s->>'restes')::boolean, false)
  from jsonb_array_elements(p_slots) as s;

  return v_updated;
end;
$$;

revoke execute on function sauvegarder_planning(text, jsonb) from public;
grant execute on function sauvegarder_planning(text, jsonb) to authenticated;

-- Upsert des coches d'une semaine pour le foyer. Renvoie l'updated_at serveur.
create or replace function sauvegarder_coches(p_semaine text, p_coches jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_updated timestamptz;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  insert into etat_courses (foyer_id, semaine, coches)
    values (v_foyer, p_semaine, p_coches)
    on conflict (foyer_id, semaine)
      do update set coches = excluded.coches
    returning updated_at into v_updated;

  return v_updated;
end;
$$;

revoke execute on function sauvegarder_coches(text, jsonb) from public;
grant execute on function sauvegarder_coches(text, jsonb) to authenticated;
