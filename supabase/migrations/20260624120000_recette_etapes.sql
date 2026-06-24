-- Migration — étapes de préparation des recettes (#233, RG-43).
-- Date : 2026-06-24
--
-- Ajoute recette.etapes (text[], NULL/vide = pas d'étapes). Liste ORDONNÉE de
-- texte libre, saisie 100 % manuelle au formulaire (pas d'heuristique de tagging
-- comme vegetarien/accompagnement/saisons → AUCUN UPDATE du catalogue global
-- ici). Les 74 recettes seedées restent sans étapes : la valeur s'active sur les
-- recettes que l'utilisateur crée/édite (la duplication+masquage de #105 PR2
-- permet d'ajouter des étapes à une recette du catalogue).
--
-- L'optionnalité côté domaine (Recette.etapes?) suit le même contrat que saisons
-- (cf. lib/adapters.ts) ; la colonne doit être lue par TOUS les selects qui
-- hydratent une recette (SELECT_RECETTE, SELECT_PLANNING, route de génération)
-- sinon les étapes disparaissent d'un planning persisté relu (piège #164).

alter table recette
  add column etapes text[];
