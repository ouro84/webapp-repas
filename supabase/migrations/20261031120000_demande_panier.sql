-- Socle des demandes de panier Chronodrive (#308, US-53, RG-80→84, §5.8).
--
-- 1. `executeur_panier` : l'exécuteur (Hermes) d'un foyer, son URL de webhook
--    et la référence de son secret HMAC, chiffré par Supabase Vault : le secret
--    n'est jamais en clair dans la table ni renvoyé à l'application. Aucun
--    identifiant d'enseigne n'est stocké (RG-80). Renseignée à la main en v1
--    via `enregistrer_executeur_panier` (service_role seulement). RLS sans
--    policy : l'existence de l'exécuteur se lit uniquement via `etat_panier()`.
-- 2. `demande_panier` : historique des demandes du foyer. Au plus une demande
--    active (`en_attente` | `en_cours`) par foyer, garantie par un index unique
--    partiel, et non par un select préalable : deux clics simultanés ne créent
--    qu'une demande (RG-83).
-- 3. `creer_demande_panier` signe le webhook DANS Postgres (Standard Webhooks,
--    corps sans donnée métier, RG-81) et renvoie URL, en-têtes et corps : la
--    route Next n'a ni secret ni service_role, elle transmet tel quel.
-- 4. Expiration paresseuse (RG-83) : chaque RPC du cycle de vie passe d'abord
--    en `echec` les demandes périmées du foyer (`en_attente` > 5 min →
--    `non_prise` ; `en_cours` > 30 min → `delai_depasse`). Pas de tâche planifiée.
--
-- Exception à la checklist « FK sans cascade » de supabase.md : les deux tables
-- sont en `on delete cascade` vers `foyers`. Rien à recréer dans
-- `rejoindre_foyer`, `quitter_foyer` ni `supprimer_mon_compte`, et rien n'est
-- cloné à la sortie : l'exécuteur appartient à l'installation du foyer.
-- Le trigger de suppression nettoie le secret Vault, y compris en cascade.
--
-- Codes d'erreur (lus par la route et le MCP) : OMQ01 aucun exécuteur,
-- OMQ02 demande déjà active, OMQ03 demande non rapportable.

-- ─── Tables ────────────────────────────────────────────────────────────────

create table executeur_panier (
  id uuid primary key default gen_random_uuid(),
  foyer_id uuid not null references foyers(id) on delete cascade,
  enseigne text not null default 'chronodrive' check (enseigne = 'chronodrive'),
  url_webhook text not null check (url_webhook ~ '^https?://'),
  -- Référence vers vault.secrets (pas de FK : schéma géré par l'extension).
  secret_id uuid not null,
  cree_le timestamptz not null default now(),
  unique (foyer_id, enseigne)
);

-- RLS sans policy : aucune lecture ni écriture directe par le client.
alter table executeur_panier enable row level security;
revoke all on executeur_panier from anon, authenticated;

create table demande_panier (
  id uuid primary key default gen_random_uuid(),
  foyer_id uuid not null references foyers(id) on delete cascade,
  ancre date not null,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'en_cours', 'terminee', 'echec')),
  cause_echec text
    check (cause_echec in ('injoignable', 'non_prise', 'delai_depasse', 'executeur')),
  motif_echec text,
  -- Compte-rendu de l'exécuteur (RG-84) : ajoutés, à choisir, introuvables.
  rapport jsonb,
  rapport_tardif boolean not null default false,
  cree_le timestamptz not null default now(),
  pris_le timestamptz,
  termine_le timestamptz
);

-- Une seule demande active par foyer (RG-83).
create unique index demande_panier_active_idx
  on demande_panier (foyer_id)
  where statut in ('en_attente', 'en_cours');

create index demande_panier_foyer_cree_idx
  on demande_panier (foyer_id, cree_le desc);

-- Lecture seule pour le foyer ; toute écriture passe par les RPC ci-dessous.
alter table demande_panier enable row level security;
revoke all on demande_panier from anon;
revoke insert, update, delete on demande_panier from authenticated;

create policy "demande_panier : lecture par le foyer"
  on demande_panier for select
  to authenticated
  using (foyer_id = mon_foyer());

-- ─── Nettoyage du secret Vault ─────────────────────────────────────────────

-- Supprimer l'exécuteur (à la main ou par la cascade du foyer) supprime son
-- secret : Vault ne garde pas de secret orphelin.
create or replace function supprimer_secret_executeur_panier()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;

revoke execute on function supprimer_secret_executeur_panier() from public;
revoke execute on function supprimer_secret_executeur_panier() from anon;
revoke execute on function supprimer_secret_executeur_panier() from authenticated;

create trigger executeur_panier_supprimer_secret
  after delete on executeur_panier
  for each row execute function supprimer_secret_executeur_panier();

-- ─── Expiration paresseuse (RG-83) ─────────────────────────────────────────

-- Helper interne : appelé en tête de chaque RPC du cycle de vie.
create or replace function expirer_demandes_panier(p_foyer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Exécuteur éteint : la demande n'a pas été prise dans les 5 min.
  update demande_panier
     set statut = 'echec',
         cause_echec = 'non_prise',
         motif_echec = 'L''exécuteur n''a pas pris la demande dans les 5 minutes.',
         termine_le = now()
   where foyer_id = p_foyer
     and statut = 'en_attente'
     and cree_le < now() - interval '5 minutes';

  -- Run trop long : la demande prise n'a pas été rapportée dans les 30 min.
  update demande_panier
     set statut = 'echec',
         cause_echec = 'delai_depasse',
         motif_echec = 'L''exécuteur n''a pas terminé dans les 30 minutes.',
         termine_le = now()
   where foyer_id = p_foyer
     and statut = 'en_cours'
     and coalesce(pris_le, cree_le) < now() - interval '30 minutes';
end;
$$;

revoke execute on function expirer_demandes_panier(uuid) from public;
revoke execute on function expirer_demandes_panier(uuid) from anon;
revoke execute on function expirer_demandes_panier(uuid) from authenticated;

-- ─── Enregistrement de l'exécuteur (service_role seulement) ────────────────

-- Crée ou remplace l'exécuteur Chronodrive du foyer et son secret Vault.
-- Le `name` Vault est unique : un secret existant est mis à jour, pas recréé.
create or replace function enregistrer_executeur_panier(p_foyer uuid, p_url text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_nom text := 'executeur_panier:' || p_foyer || ':chronodrive';
  v_secret_id uuid;
  v_id uuid;
begin
  if p_foyer is null or coalesce(p_secret, '') = '' then
    raise exception 'Foyer et secret obligatoires';
  end if;

  -- Un secret « whsec_ » doit être du base64 valide : mieux vaut échouer ici
  -- qu'à la première demande (RG-81).
  if p_secret like 'whsec\_%' then
    perform decode(substr(p_secret, 7), 'base64');
  end if;

  select id into v_secret_id from vault.secrets where name = v_nom;
  if found then
    perform vault.update_secret(v_secret_id, p_secret);
  else
    v_secret_id := vault.create_secret(
      p_secret, v_nom, 'Secret HMAC du webhook de l''exécuteur de panier (RG-81)');
  end if;

  insert into executeur_panier (foyer_id, enseigne, url_webhook, secret_id)
    values (p_foyer, 'chronodrive', p_url, v_secret_id)
    on conflict (foyer_id, enseigne)
      do update set url_webhook = excluded.url_webhook,
                    secret_id = excluded.secret_id
    returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function enregistrer_executeur_panier(uuid, text, text) from public;
revoke execute on function enregistrer_executeur_panier(uuid, text, text) from anon;
revoke execute on function enregistrer_executeur_panier(uuid, text, text) from authenticated;
grant execute on function enregistrer_executeur_panier(uuid, text, text) to service_role;

-- ─── Lecture de l'état (RG-81, RG-84) ──────────────────────────────────────

-- Exécuteur enregistré ? (le bouton n'apparaît que si oui) et dernière demande
-- du foyer, après expiration.
create or replace function etat_panier()
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
      order by d.cree_le desc
      limit 1));
end;
$$;

revoke execute on function etat_panier() from public;
revoke execute on function etat_panier() from anon;
grant execute on function etat_panier() to authenticated;

-- ─── Création et signature du webhook (RG-81, RG-83) ───────────────────────

-- Crée la demande et signe le webhook de réveil (Standard Webhooks) :
-- base64 HMAC-SHA256 de "<id>.<timestamp>.<corps>". Secret « whsec_<base64> »
-- → clé = base64 décodé ; sinon secret brut en UTF-8. Le secret ne quitte
-- jamais Postgres ; le corps est renvoyé en texte, à transmettre tel quel.
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

  perform expirer_demandes_panier(v_foyer);

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
    raise exception 'Secret de l''exécuteur de panier introuvable';
  end if;

  -- Une seule demande active : l'index unique partiel tranche les courses
  -- (deux clics simultanés), le contrôle préalable donne le cas courant.
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

-- ─── Échec d'envoi du webhook (RG-81) ──────────────────────────────────────

-- La route n'a pas pu joindre l'exécuteur (délai de 10 s dépassé, réponse
-- non 2xx) : la demande `en_attente` passe en `echec` / `injoignable`, et le
-- bouton redevient disponible aussitôt. No-op pour toute autre demande.
create or replace function echouer_envoi_demande_panier(p_demande uuid, p_motif text)
returns void
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

  update demande_panier
     set statut = 'echec',
         cause_echec = 'injoignable',
         motif_echec = p_motif,
         termine_le = now()
   where id = p_demande
     and foyer_id = v_foyer
     and statut = 'en_attente';
end;
$$;

revoke execute on function echouer_envoi_demande_panier(uuid, text) from public;
revoke execute on function echouer_envoi_demande_panier(uuid, text) from anon;
grant execute on function echouer_envoi_demande_panier(uuid, text) to authenticated;

-- ─── Prise en charge par l'exécuteur (RG-81) ───────────────────────────────

-- Appelée par l'exécuteur au réveil, sous son propre jeton (RG-71) : prend la
-- plus ancienne demande `en_attente` du foyer et la passe `en_cours`.
-- Renvoie null s'il n'y a rien à faire (webhook forgé, autre foyer…).
create or replace function prendre_demande_panier()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_id uuid;
  v_ancre date;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  perform expirer_demandes_panier(v_foyer);

  update demande_panier
     set statut = 'en_cours',
         pris_le = now()
   where id = (
     select id from demande_panier
      where foyer_id = v_foyer and statut = 'en_attente'
      order by cree_le
      limit 1
      for update skip locked)
  returning id, ancre into v_id, v_ancre;

  if v_id is null then
    return null;
  end if;

  return jsonb_build_object('id', v_id, 'ancre', v_ancre);
end;
$$;

revoke execute on function prendre_demande_panier() from public;
revoke execute on function prendre_demande_panier() from anon;
grant execute on function prendre_demande_panier() to authenticated;

-- ─── Compte-rendu de l'exécuteur (RG-83, RG-84) ────────────────────────────

-- Accepte le rapport d'une demande `en_cours`. Un rapport arrivé après
-- l'expiration (`echec` / `delai_depasse`) est encore accepté si aucune
-- demande plus récente n'existe pour le foyer : il est marqué tardif. Sinon
-- OMQ03 (demande inconnue, d'un autre foyer, ou déjà close).
create or replace function rapporter_panier(p_demande uuid, p_statut text, p_rapport jsonb, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_statut text;
  v_cause text;
  v_cree timestamptz;
  v_tardif boolean;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  if p_statut is null or p_statut not in ('terminee', 'echec') then
    raise exception 'Statut de rapport invalide : %', p_statut
      using errcode = '22023';
  end if;

  perform expirer_demandes_panier(v_foyer);

  select statut, cause_echec, cree_le into v_statut, v_cause, v_cree
    from demande_panier
   where id = p_demande and foyer_id = v_foyer
   for update;

  if v_statut = 'en_cours' then
    v_tardif := false;
  elsif v_statut = 'echec' and v_cause = 'delai_depasse'
        -- `>=` et `id <>` : robuste à deux demandes au même horodatage.
        and not exists (select 1 from demande_panier
                         where foyer_id = v_foyer and id <> p_demande
                           and cree_le >= v_cree) then
    v_tardif := true;
  else
    raise exception 'Demande de panier introuvable ou déjà close'
      using errcode = 'OMQ03';
  end if;

  update demande_panier
     set statut = p_statut,
         rapport = p_rapport,
         rapport_tardif = v_tardif,
         cause_echec = case when p_statut = 'echec' then 'executeur' end,
         motif_echec = case when p_statut = 'echec' then p_motif end,
         termine_le = now()
   where id = p_demande;

  return jsonb_build_object('statut', p_statut, 'rapport_tardif', v_tardif);
end;
$$;

revoke execute on function rapporter_panier(uuid, text, jsonb, text) from public;
revoke execute on function rapporter_panier(uuid, text, jsonb, text) from anon;
grant execute on function rapporter_panier(uuid, text, jsonb, text) to authenticated;
