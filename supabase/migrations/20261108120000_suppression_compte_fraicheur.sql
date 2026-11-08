-- Migration — la suppression de compte exige une authentification récente
-- (RG-93, US-57).
-- Date : 2026-11-08
--
-- Pourquoi : la route app/api/compte/supprimer refuse une session dont la
-- dernière authentification date de plus de 5 minutes, mais la RPC
-- supprimer_mon_compte() reste appelable directement via PostgREST par tout
-- `authenticated` : sans ce contrôle en base, la purge des données
-- contournerait la garde de la route. On ferme la faille ici.
--
-- Jumeau SQL de authentificationRecente() (lib/reauth.ts) : règle du jumeau
-- (CLAUDE.md). Le seuil par défaut (300 s) doit rester aligné sur
-- FRAICHEUR_MAX_S de lib/reauth.ts.
--
-- Même sémantique que le jumeau TS : le claim `amr` du JWT doit être un
-- tableau ; seuls les objets portant un `timestamp` numérique comptent ;
-- le plus grand timestamp fait foi. `amr` absent, non-tableau, tableau de
-- chaînes ou sans timestamp numérique → faux (fail-safe).
--
-- SQLSTATE applicatif OMQ06 : authentification trop ancienne (la route le lit
-- par error.code et le traduit en 403, comme OMQ01..OMQ05 du panier).

create or replace function authentification_recente(p_max_s integer default 300)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select extract(epoch from now()) - max((e ->> 'timestamp')::numeric) <= p_max_s
    from jsonb_array_elements(
      case
        when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr'
        else '[]'::jsonb
      end
    ) as e
    where jsonb_typeof(e) = 'object'
      and jsonb_typeof(e -> 'timestamp') = 'number'
  ), false);
$$;

-- Helper interne : appelé uniquement par supprimer_mon_compte() (SECURITY
-- DEFINER, exécutée en tant que propriétaire). Aucun rôle client.
revoke execute on function authentification_recente(integer) from public, anon, authenticated;

-- Corps repris à l'identique de 20260716090000_suppression_compte.sql ;
-- seul le contrôle de fraîcheur en tête est nouveau.
create or replace function supprimer_mon_compte()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_membres int;
begin
  if not authentification_recente() then
    raise exception using
      errcode = 'OMQ06',
      message = 'Authentification trop ancienne pour supprimer le compte';
  end if;

  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  select count(*) into v_membres from profiles where foyer_id = v_foyer;

  if v_membres <= 1 then
    -- ----- Solo : purge intégrale du foyer -----------------------------------
    delete from etat_courses_article where foyer_id = v_foyer;
    delete from article_manuel where foyer_id = v_foyer;
    delete from cycle_courses where foyer_id = v_foyer;
    delete from recette_preference where foyer_id = v_foyer;
    delete from recette_masquee where foyer_id = v_foyer;
    delete from planning where foyer_id = v_foyer; -- cascade planning_slot
    delete from recette where foyer_id = v_foyer;  -- cascade recette_ingredient
    delete from profiles where user_id = auth.uid();
    delete from foyers where id = v_foyer;
  else
    -- ----- Partagé : détache le partant, préserve le foyer -------------------
    update recette set user_id = null
      where foyer_id = v_foyer and user_id = auth.uid();
    delete from profiles where user_id = auth.uid();
  end if;
end;
$$;

revoke execute on function supprimer_mon_compte() from public, anon;
grant execute on function supprimer_mon_compte() to authenticated;
