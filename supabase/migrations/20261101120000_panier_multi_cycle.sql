-- Panier Chronodrive multi-cycle (#320, RG-81, RG-84, RG-85).
--
-- Le panier se remplit pour n'importe quel cycle en cours ou à venir, plus
-- seulement le cycle courant. Deux changements :
--   1. `creer_demande_panier` refuse un cycle TERMINÉ (OMQ04) : son dernier jour
--      (ancre + longueur − 1, longueur lue dans cycle_courses, 7 par défaut)
--      est strictement antérieur à aujourd'hui à Paris. La garde a un miroir TS,
--      `cycleTermine` (lib/cycles.ts) : toute évolution de l'une se répercute
--      sur l'autre.
--   2. `etat_panier(p_ancre)` renvoie la dernière demande DU CYCLE demandé
--      (`derniere`) et, séparément, la demande active du foyer (`active`) : une
--      seule demande active par foyer, quel que soit son cycle (RG-83), si bien
--      que l'UI doit la voir même depuis un autre cycle.

-- ─── Lecture de l'état par cycle (RG-81, RG-84) ────────────────────────────

-- Changement de signature : drop puis recréation avec les grants. L'appel sans
-- argument (`rpc('etat_panier')`) reste valide grâce au défaut.
drop function if exists etat_panier();

create or replace function etat_panier(p_ancre date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  perform expirer_demandes_panier(v_foyer);

  return jsonb_build_object(
    'executeur', exists (select 1 from executeur_panier where foyer_id = v_foyer),
    -- Dernière demande du cycle demandé, ou du foyer sans ancre.
    'derniere', (
      select jsonb_build_object(
        'id', d.id,
        'ancre', d.ancre,
        'statut', d.statut,
        'cause_echec', d.cause_echec,
        'motif_echec', d.motif_echec,
        'rapport', d.rapport,
        'rapport_tardif', d.rapport_tardif,
        'cree_le', d.cree_le,
        'pris_le', d.pris_le,
        'termine_le', d.termine_le)
      from demande_panier d
      where d.foyer_id = v_foyer
        and (p_ancre is null or d.ancre = p_ancre)
      order by d.cree_le desc
      limit 1),
    -- Demande active du foyer, quel que soit son cycle (RG-83).
    -- Même forme que 'derniere' : la carte et le MCP lisent les deux pareil.
    'active', (
      select jsonb_build_object(
        'id', d.id,
        'ancre', d.ancre,
        'statut', d.statut,
        'cause_echec', d.cause_echec,
        'motif_echec', d.motif_echec,
        'rapport', d.rapport,
        'rapport_tardif', d.rapport_tardif,
        'cree_le', d.cree_le,
        'pris_le', d.pris_le,
        'termine_le', d.termine_le)
      from demande_panier d
      where d.foyer_id = v_foyer
        and d.statut in ('en_attente', 'en_cours')
      order by d.cree_le desc
      limit 1));
end;
$$;

revoke execute on function etat_panier(date) from public;
revoke execute on function etat_panier(date) from anon;
grant execute on function etat_panier(date) to authenticated;

-- ─── Création : refus d'un cycle terminé (RG-81) ───────────────────────────

-- Reprise intégrale de `creer_demande_panier` (20261031120000_demande_panier) ;
-- seule nouveauté : la garde OMQ04, avant le contrôle de l'exécuteur.
create or replace function creer_demande_panier(p_ancre date)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_foyer uuid := mon_foyer();
  v_url text;
  v_secret_id uuid;
  v_secret text;
  v_demande uuid;
  v_id text;
  v_ts text;
  v_corps text;
  v_cle bytea;
  v_sig text;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  if p_ancre is null then
    raise exception 'Ancre du cycle de courses obligatoire'
      using errcode = '22023';
  end if;

  -- Sérialise création et rapport d'un même foyer (verrou relâché en fin de
  -- transaction) : un rapport tardif ne peut pas être accepté pendant qu'une
  -- demande plus récente se crée (RG-84).
  perform pg_advisory_xact_lock(hashtext('panier:' || v_foyer::text));

  perform expirer_demandes_panier(v_foyer);

  -- Cycle terminé : son dernier jour (ancre + longueur − 1) précède aujourd'hui
  -- à Paris. Miroir TS : `cycleTermine` (lib/cycles.ts).
  if p_ancre
       + coalesce((select longueur from cycle_courses
                    where foyer_id = v_foyer and ancre = p_ancre), 7)
       - 1 < (now() at time zone 'Europe/Paris')::date then
    raise exception 'Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir'
      using errcode = 'OMQ04';
  end if;

  select url_webhook, secret_id into v_url, v_secret_id
    from executeur_panier
   where foyer_id = v_foyer and enseigne = 'chronodrive';
  if not found then
    raise exception 'Aucun exécuteur de panier enregistré pour ce foyer'
      using errcode = 'OMQ01';
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where id = v_secret_id;
  if v_secret is null then
    -- Panne de configuration (secret supprimé de Vault à la main) : la route
    -- répond 500 ; ré-enregistrer l'exécuteur recrée le secret.
    raise exception 'Secret Vault % de l''exécuteur de panier introuvable : ré-enregistrer l''exécuteur avec enregistrer_executeur_panier', v_secret_id;
  end if;

  -- Une seule demande active : l'index unique partiel en est la garantie. Le
  -- verrou ci-dessus sérialise déjà deux clics simultanés, si bien que le
  -- second voit le premier ici ; le rattrapage de `unique_violation` reste
  -- le filet de dernier recours.
  if exists (select 1 from demande_panier
              where foyer_id = v_foyer and statut in ('en_attente', 'en_cours')) then
    raise exception 'Une demande de panier est déjà en cours pour ce foyer'
      using errcode = 'OMQ02';
  end if;

  begin
    insert into demande_panier (foyer_id, ancre)
      values (v_foyer, p_ancre)
      returning id into v_demande;
  exception when unique_violation then
    raise exception 'Une demande de panier est déjà en cours pour ce foyer'
      using errcode = 'OMQ02';
  end;

  v_id := 'msg_' || gen_random_uuid();
  v_ts := extract(epoch from now())::bigint::text;
  v_corps := '{"evenement":"demande_panier"}';
  v_cle := case when v_secret like 'whsec\_%'
                then decode(substr(v_secret, 7), 'base64')
                else convert_to(v_secret, 'UTF8') end;
  v_sig := 'v1,' || encode(hmac(convert_to(v_id || '.' || v_ts || '.' || v_corps, 'UTF8'), v_cle, 'sha256'), 'base64');

  return jsonb_build_object(
    'demande_id', v_demande,
    'url', v_url,
    'entetes', jsonb_build_object(
      'webhook-id', v_id,
      'webhook-timestamp', v_ts,
      'webhook-signature', v_sig),
    'corps', v_corps);
end;
$$;

revoke execute on function creer_demande_panier(date) from public;
revoke execute on function creer_demande_panier(date) from anon;
grant execute on function creer_demande_panier(date) to authenticated;
