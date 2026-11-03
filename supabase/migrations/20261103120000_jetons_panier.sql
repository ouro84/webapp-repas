-- Gardes du run de panier (#330, RG-83, RG-85) : demande en cours et jetons
-- signés par article.
--
-- Un run de l'exécuteur (Hermes) a sauté `prendre_demande_panier` et rempli le
-- vrai panier. Les consignes de skill ne tiennent pas : on remplace par des
-- gardes serveur. Ce fichier pose les deux RPC de la base :
--
-- 1. `demande_panier_en_cours()` : renvoie la demande `en_cours` du foyer
--    (id, ancre, pris_le), ou null. L'endpoint MCP dédié `/api/mcp/executeur`
--    s'en sert pour savoir si une demande a été prise.
-- 2. `signer_jetons_panier(p_demande, p_cles)` : un jeton HMAC par clé d'article
--    (`<demande_id>.<exp>.<mac>`), valable jusqu'à `pris_le + 30 min` (RG-83).
--    `chronodrive` refuse tout ajout sans jeton valide pour le terme.
--
-- La clé ne quitte jamais Postgres : le secret est lu dans Vault, la sous-clé
-- `HMAC-SHA256(cle_secret, 'jetons-panier')` est calculée sur place et seuls
-- les jetons sortent. Couplage : la rotation du secret webhook (ré-enregistrer
-- l'exécuteur, cf. chronodrive.md) change aussi la clé des jetons, et
-- `OMQ_WEBHOOK_SECRET` côté `chronodrive` doit suivre.
--
-- `p_cles` arrive déjà normalisé par OMQ (`cleJeton`, lib/jeton-panier.ts) :
-- le SQL signe la chaîne reçue telle quelle, sans normaliser. Le calcul est le
-- jumeau de `signerJeton` (integrations/chronodrive-mcp/src/jetons.ts), vérifié
-- sur les mêmes vecteurs.
--
-- Code d'erreur : OMQ05 = aucune demande `en_cours` pour ce foyer (jamais prise,
-- expirée, close ou d'un autre foyer).

-- ─── Demande en cours ──────────────────────────────────────────────────────

create or replace function demande_panier_en_cours()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_demande jsonb;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  perform expirer_demandes_panier(v_foyer);

  select jsonb_build_object('id', d.id, 'ancre', d.ancre, 'pris_le', d.pris_le)
    into v_demande
    from demande_panier d
   where d.foyer_id = v_foyer
     and d.statut = 'en_cours'
   order by d.cree_le desc
   limit 1;

  -- `select … into` laisse null s'il n'y a aucune ligne : demande absente.
  return v_demande;
end;
$$;

revoke execute on function demande_panier_en_cours() from public;
revoke execute on function demande_panier_en_cours() from anon;
grant execute on function demande_panier_en_cours() to authenticated;

-- ─── Signature des jetons ──────────────────────────────────────────────────

create or replace function signer_jetons_panier(p_demande uuid, p_cles text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_foyer uuid := mon_foyer();
  v_pris_le timestamptz;
  v_secret_id uuid;
  v_secret text;
  v_cle bytea;
  v_sous_cle bytea;
  v_exp bigint;
  v_jetons jsonb;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  if p_cles is null or cardinality(p_cles) > 500 then
    raise exception 'Liste de clés d''articles invalide (500 au plus)'
      using errcode = '22023';
  end if;

  -- Même verrou que les RPC du cycle de vie : la demande ne change pas d'état
  -- (expiration, rapport) pendant la signature.
  perform pg_advisory_xact_lock(hashtext('panier:' || v_foyer::text));

  perform expirer_demandes_panier(v_foyer);

  select pris_le into v_pris_le
    from demande_panier
   where id = p_demande
     and foyer_id = v_foyer
     and statut = 'en_cours';
  if not found then
    raise exception 'Aucune demande de panier prise : appelle d''abord prendre_demande_panier'
      using errcode = 'OMQ05';
  end if;

  select secret_id into v_secret_id
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
    raise exception 'Secret Vault % de l''exécuteur de panier introuvable : ré-enregistrer l''exécuteur avec enregistrer_executeur_panier', v_secret_id;
  end if;

  -- Même règle que `creer_demande_panier` : `whsec_` + base64 → octets décodés,
  -- sinon octets UTF-8 du secret.
  v_cle := case when v_secret like 'whsec\_%'
                then decode(substr(v_secret, 7), 'base64')
                else convert_to(v_secret, 'UTF8') end;
  v_sous_cle := hmac(convert_to('jetons-panier', 'UTF8'), v_cle, 'sha256');

  -- RG-83 : un run dure au plus 30 min depuis la prise de la demande.
  v_exp := extract(epoch from v_pris_le + interval '30 minutes')::bigint;

  select coalesce(jsonb_agg(
           p_demande::text || '.' || v_exp::text || '.' ||
           substr(encode(hmac(convert_to(p_demande::text || '|' || c.cle || '|' || v_exp::text, 'UTF8'),
                              v_sous_cle, 'sha256'), 'hex'), 1, 32)
           order by c.ordre), '[]'::jsonb)
    into v_jetons
    from unnest(p_cles) with ordinality as c(cle, ordre);

  return jsonb_build_object('expire_le', v_exp, 'jetons', v_jetons);
end;
$$;

revoke execute on function signer_jetons_panier(uuid, text[]) from public;
revoke execute on function signer_jetons_panier(uuid, text[]) from anon;
grant execute on function signer_jetons_panier(uuid, text[]) to authenticated;
