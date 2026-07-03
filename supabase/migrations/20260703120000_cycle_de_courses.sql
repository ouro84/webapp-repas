-- Migration — cycle de courses (#257) : fenêtre non calendaire de la liste de
-- courses, ancrée sur le jour de courses du FOYER.
-- Date : 2026-07-03
--
-- 1) foyers.jour_courses (réglage foyer, éditable client via grant-colonne,
--    pattern profil #22 PR1). Défaut lundi (1) → cycle ≡ semaine ISO
--    (rétro-compatibilité : aucun changement observable avant opt-in).
-- 2) Table cycle_courses : longueur par cycle (création paresseuse, défaut 7).
-- 3) Re-clé etat_courses_article : semaine text → ancre date (PK, index,
--    realtime inchangés). Backfill : ancre = lundi de la semaine ISO existante.
-- 4) Repointage de quitter_foyer() (#56 PR6) : la fonction clonait les coches
--    par-article en référençant la colonne `semaine`, supprimée en 3c ci-dessous
--    — sans ce repointage, l'offboarding échouerait au runtime (colonne absente)
--    la première fois qu'un membre quitterait un foyer avec des coches en cours.

-- ============================================================================
-- 1. Réglage foyer : jour de courses
-- ============================================================================
alter table foyers add column jour_courses smallint not null default 1
  check (jour_courses between 1 and 7); -- 1=lundi … 7=dimanche (ISO)

-- Écriture client restreinte à cette seule colonne (grant-colonne, cf.
-- 20260612140000_profil_colonnes.sql). code_invitation/expire_le restent
-- inaccessibles au client (gérés par RPC SECURITY DEFINER).
--
-- ⚠️ Déviation vérifiée vs le brief : `foyers` porte déjà un GRANT UPDATE
-- table-entière pour `authenticated` (privilège par défaut Supabase, jamais
-- restreint jusqu'ici faute de policy UPDATE) — vérifié sur staging via
-- information_schema.table_privileges. Sans le `revoke` ci-dessous, la policy
-- ouvrirait `code_invitation`/`expire_le` en écriture client (même piège que
-- documenté dans 20260612140000_profil_colonnes.sql pour `profiles`).
create policy "foyers: reglage jour_courses"
  on foyers for update
  using (id = mon_foyer())
  with check (id = mon_foyer());

revoke update on foyers from authenticated;
grant update (jour_courses) on foyers to authenticated;

-- ============================================================================
-- 2. Table cycle_courses (longueur par cycle, paresseuse)
-- ============================================================================
create table cycle_courses (
  foyer_id   uuid     not null default mon_foyer() references foyers(id),
  ancre      date     not null,
  longueur   smallint not null default 7 check (longueur between 1 and 14),
  updated_at timestamptz not null default now(),
  primary key (foyer_id, ancre)
);

create trigger cycle_courses_set_updated_at
  before insert or update on cycle_courses
  for each row execute function set_updated_at();

alter table cycle_courses enable row level security;

create policy "cycle_courses: lecture foyer" on cycle_courses for select
  using (foyer_id = mon_foyer());
create policy "cycle_courses: insertion foyer" on cycle_courses for insert
  with check (foyer_id = mon_foyer());
create policy "cycle_courses: modification foyer" on cycle_courses for update
  using (foyer_id = mon_foyer()) with check (foyer_id = mon_foyer());
create policy "cycle_courses: suppression foyer" on cycle_courses for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 3. Re-clé etat_courses_article : semaine text → ancre date
-- ============================================================================
-- 3a. Nouvelle colonne, backfill = lundi de la semaine ISO "AAAA-Wnn".
--     Le 4 janvier appartient toujours à la semaine 1 (ISO) ; on en déduit le
--     lundi de la semaine 1 puis on avance de (n-1) semaines.
alter table etat_courses_article add column ancre date;

update etat_courses_article set ancre = (
  (date_trunc('week', make_date(
    (split_part(semaine, '-W', 1))::int, 1, 4))::date)
  + ((split_part(semaine, '-W', 2))::int - 1) * 7
);
-- date_trunc('week', …) renvoie le lundi (ISO) contenant le 4 janvier =
-- lundi de la semaine 1. + (n-1) semaines = lundi de la semaine n.

alter table etat_courses_article alter column ancre set not null;

-- 3b. Bascule de la clé primaire.
alter table etat_courses_article drop constraint etat_courses_article_pkey;
alter table etat_courses_article add primary key (foyer_id, ancre, cle);

-- 3c. Index + suppression de l'ancienne colonne.
drop index if exists etat_courses_article_foyer_semaine_idx;
create index etat_courses_article_foyer_ancre_idx
  on etat_courses_article (foyer_id, ancre);
alter table etat_courses_article drop column semaine;

-- (Realtime : la table est déjà publiée avec REPLICA IDENTITY FULL ; le payload
-- portera désormais `ancre` au lieu de `semaine`. Rien à refaire côté publication.)

-- ============================================================================
-- 4. Repointage de quitter_foyer() (#56 PR6) vers `ancre`
-- ============================================================================
-- quitter_foyer() (20260612130000_quitter_foyer_clonage.sql) clone les coches
-- par-article du foyer quitté vers le nouveau foyer solo en référençant la
-- colonne `semaine`, supprimée en 3c. Recréée à l'identique (même corps), seule
-- la section coches change : `semaine` → `ancre`.
create or replace function quitter_foyer()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old uuid := mon_foyer();
  v_membres int;
  v_new uuid;
begin
  if v_old is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  -- Quitter en solo n'a pas de sens (on obtiendrait un autre foyer vide).
  select count(*) into v_membres from profiles where foyer_id = v_old;
  if v_membres <= 1 then
    raise exception 'Tu es déjà seul dans ton foyer';
  end if;

  -- Nouveau foyer solo du partant.
  insert into foyers default values returning id into v_new;

  -- ----- Recettes du foyer : correspondance ancienne→nouvelle ----------------
  create temp table _map_recette (ancienne uuid primary key, nouvelle uuid)
    on commit drop;
  insert into _map_recette (ancienne, nouvelle)
    select id, gen_random_uuid() from recette where foyer_id = v_old;

  -- Clone des recettes (le partant en devient le créateur : user_id = auth.uid()).
  insert into recette (id, user_id, nom, temps_preparation, vegetarien, accompagnement, saisons, foyer_id)
    select m.nouvelle, auth.uid(), r.nom, r.temps_preparation,
           r.vegetarien, r.accompagnement, r.saisons, v_new
    from recette r
    join _map_recette m on m.ancienne = r.id;

  -- Clone des ingrédients (remap recette_id).
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select m.nouvelle, ri.ingredient_id, ri.quantite, ri.unite
    from recette_ingredient ri
    join _map_recette m on m.ancienne = ri.recette_id;

  -- Clone des masquages de recettes GLOBALES (recette_id global → conservé tel
  -- quel, la recette globale existe toujours).
  insert into recette_masquee (foyer_id, recette_id)
    select v_new, recette_id from recette_masquee where foyer_id = v_old;

  -- ----- Plannings (tout l'historique) : correspondance ancien→nouveau -------
  create temp table _map_planning (ancienne uuid primary key, nouvelle uuid)
    on commit drop;
  insert into _map_planning (ancienne, nouvelle)
    select id, gen_random_uuid() from planning where foyer_id = v_old;

  -- version omise → repart à 1 (default) ; updated_at posé par le trigger.
  insert into planning (id, foyer_id, semaine)
    select m.nouvelle, v_new, p.semaine
    from planning p
    join _map_planning m on m.ancienne = p.id;

  -- Slots : remap planning_id ; recette_id → clone si recette du foyer,
  -- inchangé si recette GLOBALE (absente de _map_recette → coalesce garde l'id).
  insert into planning_slot (planning_id, recette_id, jour, type_repas, personnes, restes)
    select mp.nouvelle,
           coalesce(mr.nouvelle, ps.recette_id),
           ps.jour, ps.type_repas, ps.personnes, ps.restes
    from planning_slot ps
    join _map_planning mp on mp.ancienne = ps.planning_id
    left join _map_recette mr on mr.ancienne = ps.recette_id;

  -- ----- Coches par-article (#56 PR4, re-clées sur `ancre` #257) -------------
  insert into etat_courses_article (foyer_id, ancre, cle, quantite)
    select v_new, ancre, cle, quantite
    from etat_courses_article where foyer_id = v_old;

  -- ----- Détachement du profil (EN DERNIER) ----------------------------------
  -- Le foyer quitté reste intact : les membres restants conservent tout.
  update profiles set foyer_id = v_new where user_id = auth.uid();
end;
$$;

revoke execute on function quitter_foyer() from public;
grant execute on function quitter_foyer() to authenticated;
