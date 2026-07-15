-- Migration — article manuel de la liste de courses (#216, US-47, RG-40→43).
-- Date : 2026-07-15
--
-- Table DÉDIÉE (pas une extension du blob de coches par-article) : un article
-- manuel n'a pas de clé nom+unité naturelle à agréger avec les ingrédients
-- dérivés de recette, et deux articles manuels peuvent partager le même
-- libellé (pas de fusion en V1) → il porte sa PROPRE colonne `coche`, ce qui
-- l'exempte par construction de l'invalidation à la régénération (RG-41 :
-- un article manuel n'est jamais recalculé, donc jamais invalidé).
--
-- Scope foyer + ANCRE du cycle de courses (#257, pas « semaine » — la table
-- etat_courses_article a déjà été re-clée par ancre avant l'écriture de cette
-- feature) : un article manuel ne survit pas à un changement de cycle (pas de
-- récurrence automatique en V1).
--
-- Écritures DIRECTES sous RLS (pas de RPC) : même pattern que
-- etat_courses_article (#56 PR4) — chaque opération (insert/update/delete)
-- porte sur une seule ligne, donc atomique par construction.

-- ============================================================================
-- 1. Table
-- ============================================================================
create table article_manuel (
  id uuid primary key default gen_random_uuid(),
  -- default mon_foyer() : le client n'a pas à fournir le foyer (comme recette).
  foyer_id uuid not null default mon_foyer() references foyers(id),
  ancre date not null,
  libelle text not null check (char_length(libelle) between 1 and 200),
  -- Quantité/unité optionnelles (RG-43) : saisie structurée mais non forcée.
  quantite double precision,
  unite text,
  categorie text not null,
  fond_de_placard boolean not null default false,
  coche boolean not null default false,
  cree_le timestamptz not null default now()
);

create index article_manuel_foyer_ancre_idx on article_manuel (foyer_id, ancre);

-- ============================================================================
-- 2. RLS « foyer » — lecture + écriture directe (ressource partagée)
-- ============================================================================
alter table article_manuel enable row level security;

create policy "article_manuel: lecture foyer"
  on article_manuel for select
  using (foyer_id = mon_foyer());

create policy "article_manuel: insertion foyer"
  on article_manuel for insert
  with check (foyer_id = mon_foyer());

create policy "article_manuel: modification foyer"
  on article_manuel for update
  using (foyer_id = mon_foyer())
  with check (foyer_id = mon_foyer());

create policy "article_manuel: suppression foyer"
  on article_manuel for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 3. Temps réel — même pattern que etat_courses_article (#56 PR4) : REPLICA
-- IDENTITY FULL pour que les events UPDATE/DELETE portent la ligne complète
-- (foyer_id notamment, filtrage défensif côté client).
-- ============================================================================
alter table article_manuel replica identity full;
alter publication supabase_realtime add table article_manuel;

-- ============================================================================
-- 4. Repointage de rejoindre_foyer() (#56 PR3, déjà recréée en #257 C1) :
-- purge du foyer solo quitté AVANT `delete from foyers` — sans elle, la FK
-- non-cascade de `article_manuel.foyer_id` ferait échouer la jonction dès
-- qu'un utilisateur aurait un article manuel en cours (même classe de bug
-- latent que `cycle_courses` en #257, cf. CLAUDE.md).
-- ============================================================================
create or replace function rejoindre_foyer(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid := mon_foyer();
  v_target uuid;
  v_membres_old int;
begin
  if v_old is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  select id into v_target
    from foyers
    where code_invitation = upper(trim(p_code))
      and expire_le > now();

  if v_target is null then
    raise exception 'Code invalide ou expiré';
  end if;
  if v_target = v_old then
    raise exception 'Tu fais déjà partie de ce foyer';
  end if;

  -- RG-29 : un seul foyer à la fois.
  select count(*) into v_membres_old from profiles where foyer_id = v_old;
  if v_membres_old > 1 then
    raise exception 'Quitte d''abord ton foyer actuel avant d''en rejoindre un autre';
  end if;

  -- RG-33 : fusion cumulative des catalogues (collisions de noms conservées).
  update recette set foyer_id = v_target where foyer_id = v_old;

  -- Rattachement du profil au foyer rejoint.
  update profiles set foyer_id = v_target where user_id = auth.uid();

  -- Nettoyage du foyer solo quitté (FK foyers non ON DELETE CASCADE).
  delete from recette_masquee where foyer_id = v_old;
  delete from etat_courses_article where foyer_id = v_old;
  delete from cycle_courses where foyer_id = v_old;
  delete from article_manuel where foyer_id = v_old;
  delete from planning where foyer_id = v_old;
  delete from foyers where id = v_old;
end;
$$;

revoke execute on function rejoindre_foyer(text) from public;
grant execute on function rejoindre_foyer(text) to authenticated;

-- ============================================================================
-- 5. Repointage de quitter_foyer() (#56 PR6, RG-34) : CLONE les articles
-- manuels du foyer quitté vers le nouveau foyer solo, même principe que le
-- clone des coches par-article et de cycle_courses (#257) — le foyer quitté
-- garde 100 % (pérennité), les deux foyers sont disjoints après coup.
-- ============================================================================
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

  -- ----- Cycle de courses (#257) : longueur des cycles étirés ----------------
  insert into cycle_courses (foyer_id, ancre, longueur)
    select v_new, ancre, longueur
    from cycle_courses where foyer_id = v_old;

  -- ----- Articles manuels (#216) : id ré-généré (pas de sens à conserver le
  -- même id entre deux foyers désormais disjoints). ---------------------------
  insert into article_manuel (foyer_id, ancre, libelle, quantite, unite, categorie, fond_de_placard, coche)
    select v_new, ancre, libelle, quantite, unite, categorie, fond_de_placard, coche
    from article_manuel where foyer_id = v_old;

  -- ----- Détachement du profil (EN DERNIER) ----------------------------------
  -- Le foyer quitté reste intact : les membres restants conservent tout.
  update profiles set foyer_id = v_new where user_id = auth.uid();
end;
$$;

revoke execute on function quitter_foyer() from public;
grant execute on function quitter_foyer() to authenticated;
