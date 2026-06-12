-- Migration — offboarding : clonage des données à la sortie du foyer (#56 PR6,
-- RG-34, dernière PR de l'épopée Foyer). Date : 2026-06-12
--
-- En #56 PR3, `quitter_foyer()` laissait le partant sur un foyer solo VIDE. RG-34
-- exige « zéro perte des deux côtés » : on CLONE désormais, vers le nouveau foyer
-- solo du partant, tout ce qu'il partageait — recettes (+ ingrédients), masquages
-- de recettes globales, plannings (TOUT l'historique) + slots, et coches
-- par-article (#56 PR4). On CLONE (copie), on ne déplace pas → le foyer quitté
-- conserve 100 % de ses données (pérennité) et l'étanchéité est immédiate
-- (les deux foyers sont disjoints après la sortie).
--
-- Tout en UNE transaction SECURITY DEFINER (PostgREST enveloppe l'appel RPC) :
-- soit le clone complet aboutit, soit rien. Le profil n'est détaché qu'EN DERNIER
-- (les lectures ci-dessus s'appuient sur l'ancien foyer).
--
-- Remappage d'identifiants : les recettes et plannings clonés reçoivent de
-- NOUVEAUX id (tables temporaires de correspondance ancienne→nouvelle). Les slots
-- pointent vers la recette clonée si c'était une recette du foyer, ou gardent
-- l'id d'origine si c'était une recette GLOBALE (catalogue partagé, non clonée).
--
-- gen_random_uuid() est en pg_catalog (cœur PG13+) ; search_path inclut tout de
-- même `extensions` par prudence (cf. leçon #56 PR3 sur pgcrypto).

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

  -- ----- Coches par-article (#56 PR4) ----------------------------------------
  insert into etat_courses_article (foyer_id, semaine, cle, quantite)
    select v_new, semaine, cle, quantite
    from etat_courses_article where foyer_id = v_old;

  -- ----- Détachement du profil (EN DERNIER) ----------------------------------
  -- Le foyer quitté reste intact : les membres restants conservent tout.
  update profiles set foyer_id = v_new where user_id = auth.uid();
end;
$$;

revoke execute on function quitter_foyer() from public;
grant execute on function quitter_foyer() to authenticated;
