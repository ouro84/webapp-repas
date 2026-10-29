-- Dettes #304 soldées avant les outils MCP d'écriture (#306, RG-71, RG-79).
--
-- 1. Les RPC de planning sont `SECURITY DEFINER` : elles contournent la RLS de
--    `recette`. Sans contrôle, un client pouvait placer dans son planning
--    l'id d'une recette d'un AUTRE foyer (ou un UUID inexistant). Désormais,
--    chaque `recette_id` doit appartenir au catalogue global (foyer_id IS NULL)
--    ou au foyer de l'appelant, sinon la RPC lève AVANT toute écriture. Une
--    recette masquée (#105) reste acceptée : d'anciens plannings la portent.
-- 2. `sauvegarder_cycle` refuse une ancre au calendrier impossible
--    (2026-02-30), que la regex laissait passer jusqu'au cast de la purge.
-- 3. `anon` perd `execute` sur `sauvegarder_slots` / `sauvegarder_planning`
--    (Supabase l'accorde par défaut ; `revoke from public` ne suffit pas).
--
-- Les corps des trois RPC sont repris à l'identique, contrôle en plus.

create or replace function exiger_recettes_visibles(p_slots jsonb, p_foyer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inconnue text;
begin
  select s->>'recette_id' into v_inconnue
  from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) as s
  where not exists (
    select 1 from recette r
    -- Cast côté valeur (et non r.id::text) : la recherche passe par la clé primaire.
    where r.id = (s->>'recette_id')::uuid
      and (r.foyer_id is null or r.foyer_id = p_foyer)
  )
  limit 1;

  if found then
    raise exception 'Recette inconnue ou hors du foyer : %', v_inconnue;
  end if;
end;
$$;

-- Helper interne : appelé seulement par les RPC ci-dessous (qui s'exécutent
-- avec les droits du propriétaire).
revoke execute on function exiger_recettes_visibles(jsonb, uuid) from public;
revoke execute on function exiger_recettes_visibles(jsonb, uuid) from anon;
revoke execute on function exiger_recettes_visibles(jsonb, uuid) from authenticated;

-- Remplace toute la semaine (#56 PR2).
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

  perform exiger_recettes_visibles(p_slots, v_foyer);

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
revoke execute on function sauvegarder_planning(text, jsonb) from anon;
grant execute on function sauvegarder_planning(text, jsonb) to authenticated;

-- Upsert des seuls (jour, type_repas) fournis (#259) : édition d'un repas.
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

  perform exiger_recettes_visibles(p_slots, v_foyer);

  insert into planning (foyer_id, semaine)
    values (v_foyer, p_semaine)
    on conflict (foyer_id, semaine)
      do update set version = planning.version + 1
    returning id, updated_at into v_planning_id, v_updated;

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
revoke execute on function sauvegarder_slots(text, jsonb) from anon;
grant execute on function sauvegarder_slots(text, jsonb) to authenticated;

-- « Générer mon cycle » atomique (#304) : jours du cycle sur N semaines ISO +
-- purge des coches du cycle (RG-13), en une transaction.
create or replace function sauvegarder_cycle(p_ancre text, p_semaines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_ancre date;
  v_semaine jsonb;
  v_planning_id uuid;
  v_updated timestamptz;
  v_resultat jsonb := '{}'::jsonb;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;
  if p_ancre is null or p_ancre !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Ancre de cycle invalide : %', p_ancre;
  end if;
  -- Date réelle : 2026-02-30 passe la regex mais pas le calendrier.
  begin
    v_ancre := p_ancre::date;
  exception when others then
    raise exception 'Ancre de cycle invalide : %', p_ancre;
  end;
  if to_char(v_ancre, 'YYYY-MM-DD') <> p_ancre then
    raise exception 'Ancre de cycle invalide : %', p_ancre;
  end if;
  if p_semaines is null or jsonb_typeof(p_semaines) <> 'array'
     or jsonb_array_length(p_semaines) = 0 then
    raise exception 'Aucune semaine à sauvegarder pour le cycle %', p_ancre;
  end if;

  -- Validation complète AVANT la première écriture.
  for v_semaine in select value from jsonb_array_elements(p_semaines) loop
    if coalesce(v_semaine->>'semaine', '') !~ '^\d{4}-W\d{2}$' then
      raise exception 'Semaine invalide : %', v_semaine->>'semaine';
    end if;
    perform exiger_recettes_visibles(v_semaine->'slots', v_foyer);
  end loop;

  for v_semaine in select value from jsonb_array_elements(p_semaines) loop
    insert into planning (foyer_id, semaine)
      values (v_foyer, v_semaine->>'semaine')
      on conflict (foyer_id, semaine)
        do update set version = planning.version + 1
      returning id, updated_at into v_planning_id, v_updated;

    delete from planning_slot ps
    using jsonb_array_elements(v_semaine->'slots') as s
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
    from jsonb_array_elements(v_semaine->'slots') as s;

    v_resultat := v_resultat || jsonb_build_object(v_semaine->>'semaine', v_updated);
  end loop;

  delete from etat_courses_article
  where foyer_id = v_foyer and ancre = v_ancre;

  return v_resultat;
end;
$$;

revoke execute on function sauvegarder_cycle(text, jsonb) from public;
revoke execute on function sauvegarder_cycle(text, jsonb) from anon;
grant execute on function sauvegarder_cycle(text, jsonb) to authenticated;
