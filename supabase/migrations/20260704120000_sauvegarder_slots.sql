-- Génération fenêtrée « Générer mon cycle » (#259, PR2 du cycle de courses #257).
--
-- La RPC `sauvegarder_planning` (#56 PR2) REMPLACE toute la semaine (delete
-- intégral des slots puis réinsertion) : appelée pour une génération de cycle,
-- elle écraserait les jours des cycles voisins d'une même semaine ISO (un cycle
-- non calendaire ne couvre qu'une PARTIE de chaque semaine touchée).
--
-- `sauvegarder_slots` upsert SEULEMENT les (jour, type_repas) fournis, en une
-- transaction atomique : elle supprime puis réinsère ces seuls slots, laissant
-- les autres jours de la semaine INTACTS. Même contrat que sauvegarder_planning
-- pour le reste (foyer dérivé de mon_foyer(), bump de `version` pour l'alerte
-- US-21, updated_at posé par le trigger serveur #104 et renvoyé au client).
create or replace function sauvegarder_slots(p_semaine text, p_slots jsonb)
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

  -- Upsert de la ligne planning (conserve la même ligne → `version` s'incrémente
  -- à chaque génération de cycle qui la touche, ce qui alimente l'alerte US-21).
  insert into planning (foyer_id, semaine)
    values (v_foyer, p_semaine)
    on conflict (foyer_id, semaine)
      do update set version = planning.version + 1
    returning id, updated_at into v_planning_id, v_updated;

  -- Supprime UNIQUEMENT les (jour, type_repas) fournis (ré-upsert propre), puis
  -- les réinsère. Les jours hors cycle de cette semaine ne sont pas touchés.
  delete from planning_slot ps
  using jsonb_array_elements(p_slots) as s
  where ps.planning_id = v_planning_id
    and ps.jour = s->>'jour'
    and ps.type_repas = s->>'type_repas';

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

revoke execute on function sauvegarder_slots(text, jsonb) from public;
grant execute on function sauvegarder_slots(text, jsonb) to authenticated;
