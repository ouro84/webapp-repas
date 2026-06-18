-- Migration — durcit l'insertion de `recette` : `user_id` n'est plus falsifiable
-- (audit de sécurité F-03, issue #190). Date : 2026-06-18
--
-- Contexte : depuis la bascule scope foyer (#56 PR2, ..._foyer_scoping.sql), la
-- policy d'insertion ne validait QUE `foyer_id = mon_foyer()`. L'ancienne
-- contrainte d'authorship (`auth.uid() = user_id`) avait été retirée sans
-- équivalent. Un client pouvait donc insérer une recette dans SON foyer en
-- renseignant un `user_id` arbitraire (usurpation d'auteur).
--
-- Impact LIMITÉ : la frontière de sécurité reste `foyer_id` (correctement
-- contraint et posé par `default mon_foyer()`), donc pas de franchissement de
-- tenant ni de fuite — seulement un défaut d'INTÉGRITÉ (attribution d'auteur),
-- corrigé ici.
--
-- Parade : on rétablit la contrainte d'authorship dans le `with check` de
-- l'INSERT uniquement. On tolère `user_id IS NULL` (insertion sans auteur
-- explicite : `foyer_id` non-null la distingue d'une recette globale).
--
-- ⚠️ On NE touche PAS la policy UPDATE : `modifierRecette` ne modifie jamais
-- `user_id`, et contraindre `user_id = auth.uid()` côté UPDATE casserait RG-30
-- (tout membre du foyer doit pouvoir éditer une recette créée par un AUTRE
-- membre, dont `user_id` ≠ auth.uid()).
--
-- ⚠️ Les RPC SECURITY DEFINER (clonage `quitter_foyer`, qui pose
-- `user_id = auth.uid()`) contournent la RLS → non affectées.

drop policy if exists "recette: insertion foyer" on recette;

create policy "recette: insertion foyer"
  on recette for insert
  with check (
    foyer_id = mon_foyer()
    and (user_id is null or user_id = auth.uid())
  );
