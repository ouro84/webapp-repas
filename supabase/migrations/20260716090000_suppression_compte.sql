-- Migration — suppression de compte, droit à l'effacement RGPD (#237, US-31).
-- Date : 2026-07-16
--
-- RPC SECURITY DEFINER, même famille que quitter_foyer()/rejoindre_foyer()
-- (#56). Purge/réattribue les données AVANT que la route serveur
-- (app/api/compte/supprimer) n'appelle admin.auth.admin.deleteUser() via un
-- client service_role.
--
-- ⚠️ Piège vérifié sur staging (upxoxrjumxpzumakawiv, 2026-07-15) :
-- recette.user_id → auth.users(id) porte ON DELETE CASCADE. Appeler
-- deleteUser() AVANT cette RPC, pour un membre de foyer PARTAGÉ, détruirait en
-- cascade les recettes qu'il a créées — pas seulement pour lui, pour TOUT le
-- foyer. D'où la réattribution user_id=NULL en amont (branche partagée
-- ci-dessous), foyer_id inchangé (la visibilité ne dépend que de foyer_id
-- depuis #56).
--
-- profiles.foyer_id → foyers(id) porte ON DELETE RESTRICT : en solo, la ligne
-- profiles doit être supprimée AVANT la ligne foyers, pas l'inverse.
--
-- reglages (réglages de génération PAR UTILISATEUR, #45) n'a AUCUNE action à
-- prévoir ici : reglages.user_id → auth.users porte déjà ON DELETE CASCADE,
-- qui s'exécute correctement telle quelle dans les deux branches.
--
-- Idempotente : chaque étape est un DELETE/UPDATE conditionnel sur
-- mon_foyer()/auth.uid() — rejouer après un succès partiel ne trouve plus rien
-- à purger côté foyer.

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

revoke execute on function supprimer_mon_compte() from public;
grant execute on function supprimer_mon_compte() to authenticated;
