-- « Générer mon cycle » atomique (#304, socle du serveur MCP #302, RG-74/RG-79).
-- Remplace la séquence client « sauvegarder_slots par semaine ISO, puis purge
-- des coches » (N appels non atomiques) : écrit les jours du cycle sur TOUTES
-- les semaines ISO touchées ET purge les coches du cycle (RG-13) dans UNE
-- transaction. Utilisée par le web ET par le serveur MCP (règle du jumeau).
-- Même contrat que sauvegarder_slots par semaine : upsert des seuls
-- (jour, type_repas) fournis, foyer = mon_foyer(), bump de `version` (US-21),
-- updated_at posé par le trigger serveur (#104), renvoyé par semaine.
create or replace function sauvegarder_cycle(p_ancre text, p_semaines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
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
  if p_semaines is null or jsonb_typeof(p_semaines) <> 'array'
     or jsonb_array_length(p_semaines) = 0 then
    raise exception 'Aucune semaine à sauvegarder pour le cycle %', p_ancre;
  end if;

  for v_semaine in select value from jsonb_array_elements(p_semaines) loop
    if coalesce(v_semaine->>'semaine', '') !~ '^\d{4}-W\d{2}$' then
      raise exception 'Semaine invalide : %', v_semaine->>'semaine';
    end if;

    -- Upsert de la ligne planning (conserve la même ligne → `version`
    -- s'incrémente, ce qui alimente l'alerte US-21).
    insert into planning (foyer_id, semaine)
      values (v_foyer, v_semaine->>'semaine')
      on conflict (foyer_id, semaine)
        do update set version = planning.version + 1
      returning id, updated_at into v_planning_id, v_updated;

    -- Supprime UNIQUEMENT les (jour, type_repas) fournis puis les réinsère :
    -- les jours hors cycle de cette semaine ne sont pas touchés (RG-56).
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

  -- RG-13 : une régénération réinitialise les coches du cycle, dans la même
  -- transaction (plus de cycle écrit sans purge, ni de purge sans cycle).
  delete from etat_courses_article
  where foyer_id = v_foyer and ancre = p_ancre::date;

  return v_resultat;
end;
$$;

-- `revoke … from public` ne suffit pas : Supabase accorde explicitement
-- `execute` à anon sur les nouvelles fonctions du schéma public.
revoke execute on function sauvegarder_cycle(text, jsonb) from public;
revoke execute on function sauvegarder_cycle(text, jsonb) from anon;
grant execute on function sauvegarder_cycle(text, jsonb) to authenticated;
