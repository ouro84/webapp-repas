-- Migration — colonnes de profil utilisateur (#22 PR1, US-22/US-23).
-- Date : 2026-06-12
--
-- Étend la table `profiles` (#56 PR1) de trois colonnes d'identité et de cycle
-- de vie du compte :
--   - prenom          : affiché dans la nav (avatar) et la page /profil. NULL
--                       jusqu'à la fin de l'onboarding (validé NOT NULL côté
--                       app, pas en base : un compte fraîchement créé n'a pas
--                       encore de prénom).
--   - couleur_avatar  : teinte hex de l'avatar à initiales (RG-35, zéro upload,
--                       calculée client à partir d'un hash de l'email). NULL
--                       tant que l'onboarding n'a pas tranché.
--   - onboarding_complete : drapeau de redirection vers le tunnel /bienvenue
--                       (#22 PR2). DEFAULT FALSE → tout NOUVEAU compte naît à
--                       false (le trigger creer_foyer_et_profil n'a pas besoin
--                       d'être modifié : le défaut de colonne suffit).
--
-- ⚠️ Backfill : les comptes EXISTANTS (dont le compte e2e) sont marqués
-- onboarding_complete = true — sans ça, le proxy (#22 PR2) les renverrait tous
-- vers le tunnel d'onboarding au prochain accès. À ce stade (PR1) AUCUN code ne
-- lit encore ce drapeau : il est dormant jusqu'à la PR2.

alter table profiles
  add column prenom text,
  add column couleur_avatar text,
  add column onboarding_complete boolean not null default false;

-- Backfill : les comptes pré-existants ont déjà « onboardé » de fait.
update profiles set onboarding_complete = true;

-- ------------------------------------------------------------
-- Écriture de SON propre profil (prénom / couleur / fin d'onboarding)
--
-- La policy de lecture existante (« profiles: lecture des membres de mon
-- foyer ») couvre le SELECT. Il manquait toute voie d'écriture DIRECTE : les
-- inserts passent par le trigger SECURITY DEFINER, et les changements de foyer
-- par les RPC rejoindre_foyer / quitter_foyer. Mais éditer son prénom, sa
-- couleur d'avatar ou clôturer son onboarding est une écriture client directe.
--
-- ⚠️ Piège de sécurité : une simple policy UPDATE « using user_id = auth.uid() »
-- laisserait le client réécrire foyer_id sur sa propre ligne → il rejoindrait
-- n'importe quel foyer en contournant rejoindre_foyer (RG-29, validation du
-- code). Un trigger BEFORE UPDATE qui bloque les changements de foyer_id
-- casserait aussi les RPC (qui modifient légitimement foyer_id).
--
-- Parade : un GRANT au niveau COLONNE. Le rôle `authenticated` ne peut écrire
-- que les trois colonnes d'identité ; foyer_id et user_id lui restent en
-- lecture seule. Les RPC SECURITY DEFINER s'exécutent comme propriétaire de la
-- fonction (privilèges complets) → elles continuent d'écrire foyer_id sans être
-- affectées par ce grant.
-- ------------------------------------------------------------
create policy "profiles: mise à jour de mon profil"
  on profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on profiles from authenticated;
grant update (prenom, couleur_avatar, onboarding_complete)
  on profiles to authenticated;
