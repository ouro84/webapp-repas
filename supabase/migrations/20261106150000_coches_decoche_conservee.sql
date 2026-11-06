-- #362 phase 2 : la purge RG-13 de `sauvegarder_cycle` décoche au lieu de
-- supprimer. Le `DELETE` reste réservé aux purges de vieux cycles, de foyer et
-- de compte. Reste de la fonction et grants identiques à
-- 20261029200000_rpc_slots_recettes_visibles.sql.

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

  -- Purge RG-13 : décoche en CONSERVANT les lignes (`coche = false`), pour que
  -- la décoche garde un `updated_at` ordonnable face à un écho tardif (#362).
  update etat_courses_article set coche = false
  where foyer_id = v_foyer and ancre = v_ancre and coche;

  return v_resultat;
end;
$$;

revoke execute on function sauvegarder_cycle(text, jsonb) from public;
revoke execute on function sauvegarder_cycle(text, jsonb) from anon;
grant execute on function sauvegarder_cycle(text, jsonb) to authenticated;
