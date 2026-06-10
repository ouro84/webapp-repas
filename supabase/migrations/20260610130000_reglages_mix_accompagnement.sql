-- Migration — préférence « au moins un repas légumes par jour » (#49 PR2).
-- Date : 2026-06-10
--
-- Étend la table `reglages` (#45) d'un booléen unique : la préférence s'applique
-- à toute la semaine (≠ les 4 booléens végé par créneau de #86 PR2).
-- Défaut false → préférence désactivée = comportement antérieur (pas de
-- régression). Préférence SOUPLE et JOINTE par jour côté applicatif : la
-- génération biaise pour qu'au moins un des deux repas d'une journée soit
-- « légumes » mais n'échoue jamais si le vivier ne le permet pas (RG-27).
-- Aucune contrainte CHECK : un booléen NOT NULL DEFAULT false se suffit.

alter table reglages
  add column mix_accompagnement_jour boolean not null default false;
