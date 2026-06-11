-- Migration — onboarding du Foyer : rejoindre / quitter (#56 PR3, US-19).
-- Date : 2026-06-11
--
-- Suite du socle (#56 PR1 : foyers/profiles, mon_foyer(), generer_code_invitation())
-- et de la bascule foyer_id (#56 PR2). On ajoute les deux RPC d'onboarding,
-- toutes deux SECURITY DEFINER (elles écrivent dans profiles/foyers/recette… en
-- contournant la RLS, comme le trigger d'inscription et la génération de code).
--
-- Rappel du modèle « foyer de 1 systématique » (PR1) : tout utilisateur a
-- TOUJOURS un foyer (jamais NULL). Il n'y a donc pas d'action « créer un
-- foyer » : on naît solo, on INVITE (génère un code, déjà en PR1) pour que le
-- foyer devienne partagé, ou on REJOINT le foyer d'un autre.

-- ⚠️ Bug latent corrigé dans la migration SUIVANTE (`..._corriger_search_path_code_invitation.sql`,
-- 20260611170000) : `generer_code_invitation` (PR1) avait `search_path = public`
-- alors que pgcrypto (`gen_random_bytes`) vit dans le schéma `extensions` sur
-- Supabase. Le correctif est dans un fichier séparé car CETTE migration est déjà
-- appliquée sur staging (db push ne la rejouerait pas).

-- ============================================================================
-- REJOINDRE un foyer par code (US-19 scénario 2, RG-29, RG-33)
-- ============================================================================
--
-- Valide le code (et son expiration), MIGRE le catalogue perso du foyer solo
-- courant sous le foyer rejoint (RG-33, collisions de noms CONSERVÉES — pas de
-- fusion d'ingrédients), rattache le profil, puis supprime le foyer solo quitté
-- (désormais sans membre ni recette).
--
-- RG-29 (un seul foyer à la fois) : rejoindre exige d'être SOLO. Si le foyer
-- courant compte d'autres membres, il faut d'abord quitter (quitter_foyer, qui
-- crée un foyer solo neuf). On ne « déménage » jamais un foyer partagé entier.
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

  -- Code normalisé : l'alphabet de génération (generer_code_invitation) est en
  -- MAJUSCULES. expire_le NULL (code jamais généré) ne matche pas (NULL > now()).
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

  -- RG-33 : fusion cumulative des catalogues. Les recettes perso du solo
  -- (foyer_id = v_old) passent sous le foyer rejoint. Les globales (foyer_id
  -- NULL) ne sont pas concernées.
  update recette set foyer_id = v_target where foyer_id = v_old;

  -- Rattachement du profil au foyer rejoint (le solo accède immédiatement aux
  -- données synchronisées du foyer : planning, courses, recettes).
  update profiles set foyer_id = v_target where user_id = auth.uid();

  -- Nettoyage du foyer solo quitté : sans membre (profil déplacé) ni recette
  -- (migrées). Ses données résiduelles sont propres au solo et n'ont aucun sens
  -- dans le foyer rejoint (le membre adopte le planning/les coches du foyer) →
  -- supprimées. Les FK foyers ne sont pas ON DELETE CASCADE : on purge à la main
  -- avant de retirer la ligne foyer (les slots partent en cascade du planning).
  delete from recette_masquee where foyer_id = v_old;
  delete from etat_courses where foyer_id = v_old;
  delete from planning where foyer_id = v_old;
  delete from foyers where id = v_old;
end;
$$;

revoke execute on function rejoindre_foyer(text) from public;
grant execute on function rejoindre_foyer(text) to authenticated;

-- ============================================================================
-- QUITTER le foyer (US-19, RG-29 ; RG-34 partiel — clonage reporté en #56 PR6)
-- ============================================================================
--
-- Version de base (PR3) : l'utilisateur repart sur un foyer SOLO NEUF (vide). Il
-- ne conserve que le catalogue global (foyer_id NULL, visible de tous).
--
-- ⚠️ Le CLONAGE de sécurité RG-34 (copie des recettes + planning + coches du
-- foyer quitté dans le nouveau foyer solo, pour repartir sans friction) est le
-- périmètre de #56 PR6 — PAS implémenté ici. Côté foyer quitté : on ne supprime
-- RIEN (RG-34.1, les membres restants gardent tout), on déplace seulement le
-- profil. Quitter quand on est déjà solo n'a pas de sens (on obtiendrait un
-- autre foyer vide) → refusé ; l'UI masque d'ailleurs le bouton dans ce cas.
create or replace function quitter_foyer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid := mon_foyer();
  v_membres int;
  v_new uuid;
begin
  if v_old is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  select count(*) into v_membres from profiles where foyer_id = v_old;
  if v_membres <= 1 then
    raise exception 'Tu es déjà seul dans ton foyer';
  end if;

  insert into foyers default values returning id into v_new;
  update profiles set foyer_id = v_new where user_id = auth.uid();
end;
$$;

revoke execute on function quitter_foyer() from public;
grant execute on function quitter_foyer() to authenticated;
