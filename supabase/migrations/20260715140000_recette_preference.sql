-- Migration — favoris/évités de recette (#219, US-49, RG-58→63).
-- Date : 2026-07-15
--
-- Préférence explicite d'un foyer pour une recette : favorite, évitée, ou
-- neutre (absence de ligne = neutre — même schéma que recette_masquee).
-- Biais SOUPLE de génération (jamais un filtre dur) : une recette évitée
-- reste dans le catalogue, sélectionnable manuellement (RG-59).
--
-- Portée FOYER (RG-60), pas utilisateur : contrairement à recette_masquee
-- (dette de scope user documentée, reportée à une migration séparée), on ne
-- reproduit pas cette dette ici — le modèle post-#56 est déjà « foyer ».
--
-- S'applique aussi bien aux recettes globales du catalogue qu'aux recettes
-- perso du foyer (contrairement à recette_masquee, qui ne cible en pratique
-- que les globales) : recette_id n'est PAS restreint par une contrainte de
-- scope, la RLS foyer suffit à isoler les préférences entre foyers.

create table recette_preference (
  foyer_id   uuid not null default mon_foyer() references foyers(id),
  recette_id uuid not null references recette(id) on delete cascade,
  preference text not null check (preference in ('favorite', 'evitee')),
  primary key (foyer_id, recette_id)
);

create index recette_preference_foyer_idx on recette_preference (foyer_id);

-- RLS : chaque foyer ne voit et ne gère que SES préférences.
alter table recette_preference enable row level security;

create policy "recette_preference: lecture foyer"
  on recette_preference for select
  using (foyer_id = mon_foyer());

create policy "recette_preference: insertion foyer"
  on recette_preference for insert
  with check (foyer_id = mon_foyer());

-- Update autorisée (RG-63 : basculer directement favorite→évitée via upsert
-- client, un seul aller-retour plutôt qu'un delete+insert).
create policy "recette_preference: modification foyer"
  on recette_preference for update
  using (foyer_id = mon_foyer())
  with check (foyer_id = mon_foyer());

create policy "recette_preference: suppression foyer"
  on recette_preference for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- Repointage de rejoindre_foyer() : purge du foyer solo quitté AVANT
-- `delete from foyers` — sans elle, la FK non-cascade de
-- `recette_preference.foyer_id` ferait échouer la jonction dès qu'un
-- utilisateur aurait une préférence enregistrée (même classe de bug latent
-- que article_manuel/cycle_courses, cf. CLAUDE.md).
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
  delete from recette_preference where foyer_id = v_old;
  delete from planning where foyer_id = v_old;
  delete from foyers where id = v_old;
end;
$$;

revoke execute on function rejoindre_foyer(text) from public;
grant execute on function rejoindre_foyer(text) to authenticated;

-- ============================================================================
-- Repointage de quitter_foyer() (#56 PR6, RG-34) : CLONE les préférences du
-- foyer quitté vers le nouveau foyer solo — même principe que le clone des
-- masquages/coches/articles manuels. Remap recette_id via _map_recette
-- (créée plus haut dans cette même transaction) si la recette était DU FOYER
-- (donc clonée sous un nouvel id) ; conservé tel quel si la recette est
-- GLOBALE (absente de _map_recette → coalesce garde l'id d'origine).
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

  -- Clone des préférences (favoris/évités, #219) : remap si recette DU foyer
  -- (clonée), conservé si recette GLOBALE.
  insert into recette_preference (foyer_id, recette_id, preference)
    select v_new, coalesce(mr.nouvelle, rp.recette_id), rp.preference
    from recette_preference rp
    left join _map_recette mr on mr.ancienne = rp.recette_id
    where rp.foyer_id = v_old;

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
