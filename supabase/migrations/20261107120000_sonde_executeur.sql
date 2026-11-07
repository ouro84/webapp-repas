-- Sonde de joignabilité de l'exécuteur de panier (#379).
--
-- Le 2026-11-06, cinq webhooks de demande de panier n'ont jamais atteint
-- Hermes (aucune ligne d'accès sur le NAS) alors que `tailscale funnel status`
-- disait « on » : coupure intermittente entre Internet et le Funnel. Cette sonde
-- mesure le chemin toutes les 5 minutes depuis Postgres (pg_cron + pg_net) et
-- garde un historique horodaté, à croiser avec les logs du NAS.
--
-- Requête GET sans corps ni signature : la route webhook de Hermes n'accepte
-- que POST et répond 405 sans lancer de run ni journaliser d'avertissement.
-- 405 (ou tout statut HTTP) = Funnel et Hermes joignables ; délai dépassé ou
-- erreur réseau = coupure. Aucune donnée métier ni secret ne part.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table sonde_executeur (
  id bigint generated always as identity primary key,
  foyer_id uuid not null references foyers(id) on delete cascade,
  lance_le timestamptz not null default now(),
  -- Identifiant de la requête pg_net, relevé au passage suivant.
  requete_id bigint not null,
  statut integer,
  delai_depasse boolean,
  erreur text,
  duree_ms integer,
  releve_le timestamptz
);

create index sonde_executeur_lance_le on sonde_executeur (lance_le desc);

-- Lecture réservée au propriétaire et au service : aucune politique RLS.
alter table sonde_executeur enable row level security;

-- Relève les réponses des passages précédents (pg_net les range de façon
-- asynchrone dans net._http_response, gardées 6 h), puis lance une requête par
-- exécuteur enregistré et purge l'historique de plus de 30 jours.
create or replace function sonder_executeurs()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update sonde_executeur s
     set statut = r.status_code,
         delai_depasse = coalesce(r.timed_out, false),
         erreur = left(r.error_msg, 300),
         duree_ms = greatest(0, (extract(epoch from (r.created - s.lance_le)) * 1000)::integer),
         releve_le = now()
    from net._http_response r
   where r.id = s.requete_id
     and s.releve_le is null;

  insert into sonde_executeur (foyer_id, requete_id)
  select e.foyer_id,
         net.http_get(url := e.url_webhook, timeout_milliseconds := 10000)
    from executeur_panier e
   where e.url_webhook like 'https://%';

  delete from sonde_executeur where lance_le < now() - interval '30 days';
end;
$$;

revoke execute on function sonder_executeurs() from public;
revoke execute on function sonder_executeurs() from anon;
revoke execute on function sonder_executeurs() from authenticated;

-- Toutes les 5 minutes. `cron.schedule` met à jour un job de même nom.
select cron.schedule('sonde-executeur', '*/5 * * * *', 'select public.sonder_executeurs()');
