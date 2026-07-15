-- Migration — fondations RGPD lot 1 (#235 US-29, #236 US-30). Date : 2026-07-15
--
-- Étend `profiles` (#22 PR1) de trois colonnes :
--   - cgu_version         : version des CGU acceptées au signup (int, une
--     seule version existe pour l'instant — pas de comparateur de version ni
--     de garde de re-consentement dans cette PR, YAGNI assumé).
--   - cgu_acceptees_le    : horodatage de l'acceptation.
--   - consentement_analytics : choix du bandeau cookies (#236), miroir
--     serveur du localStorage (révocable depuis /profil, section « Vie
--     privée ») — NULL = aucun choix connu côté serveur (état par défaut,
--     y compris pour les comptes existants : voir backfill ci-dessous).
--
-- ⚠️ Backfill (comptes EXISTANTS, même pattern que onboarding_complete #22
-- PR1) : posés à cgu_version=1 / cgu_acceptees_le=maintenant — ces comptes ont
-- déjà accepté une politique implicite d'usage (app perso jusqu'ici) ; à
-- mentionner dans la politique de confidentialité (clause « utilisateurs
-- antérieurs »). `consentement_analytics` n'est PAS backfillé (reste NULL) :
-- ces comptes verront le bandeau au prochain chargement, comme un nouveau
-- visiteur — pas de présomption de consentement rétroactive.

alter table profiles
  add column cgu_version integer,
  add column cgu_acceptees_le timestamptz,
  add column consentement_analytics boolean;

update profiles set cgu_version = 1, cgu_acceptees_le = now();

-- Écriture client directe (grant-colonne, même pattern que la migration
-- ..._profil_colonnes.sql) : le rôle authenticated peut désormais aussi poser
-- ces 3 colonnes sur SA PROPRE ligne (policy « mise à jour de mon profil »
-- déjà en place, using/with check user_id = auth.uid()) — foyer_id/user_id
-- restent hors de portée.
grant update (cgu_version, cgu_acceptees_le, consentement_analytics)
  on profiles to authenticated;
