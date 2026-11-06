-- Coches horodatées, étape 1 (#362 phase 2) : colonne `coche` sur
-- etat_courses_article.
--
-- Aujourd'hui une décoche supprime la ligne : l'état « décoché » n'a ni ligne
-- ni horodatage, et le client ne sait pas ordonner l'écho tardif d'une coche
-- par rapport à la décoche qui l'a suivie (limites connues, sync-planning.md).
-- L'étape 2 décochera en gardant la ligne (`coche = false`, `updated_at` posé
-- par le trigger). Cette étape-ci ne change aucune écriture : elle ajoute la
-- colonne (les lignes existantes restent cochées) et fait filtrer les lecteurs
-- (`chargerCochesDistantes` côté client, clonage de quitter_foyer ici), pour
-- qu'un client déjà déployé reste juste quand l'étape 2 écrira `coche = false`.

alter table etat_courses_article
  add column coche boolean not null default true;

-- ============================================================================
-- quitter_foyer() : définition courante (20260715140000_recette_preference)
-- recopiée, seul le clonage des coches change (filtre `and coche`).
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
  -- Seules les coches actives : une ligne `coche = false` n'est qu'une trace
  -- horodatée de décoche (#362), sans valeur pour le nouveau foyer.
  insert into etat_courses_article (foyer_id, ancre, cle, quantite)
    select v_new, ancre, cle, quantite
    from etat_courses_article where foyer_id = v_old and coche;

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
