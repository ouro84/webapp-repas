-- Migration — interrupteur de saisonnalité (#23 PR2).
-- Date : 2026-06-10
--
-- Étend la table `reglages` (#45) d'un booléen unique. ⚠️ Défaut TRUE (≠ les
-- préférences végé #86 / mix #49 qui valent false par défaut) : la
-- saisonnalité est ACTIVE par défaut (les lignes existantes passent donc à
-- true). Côté applicatif, le filtre est DUR mais à dégradation gracieuse : la
-- génération ne propose que des recettes de la saison de la semaine cible, et
-- complète hors-saison (sans jamais échouer) si le vivier de saison est
-- insuffisant (RG-28). Aucun CHECK nécessaire.

alter table reglages
  add column saisonnalite boolean not null default true;
