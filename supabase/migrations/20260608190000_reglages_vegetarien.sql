-- Migration — préférence « privilégier le végétarien » par créneau (#86 PR2).
-- Date : 2026-06-08
--
-- Étend la table `reglages` (#45) de 4 booléens : un par créneau (jour × repas).
-- Défaut false → aucune préférence = comportement antérieur (pas de régression).
-- Préférence SOUPLE côté applicatif : la génération biaise vers les recettes
-- végétariennes mais n'échoue jamais si le vivier végé est insuffisant (RG-26).
-- Aucune contrainte CHECK : un booléen NOT NULL DEFAULT false se suffit.

alter table reglages
  add column vege_dejeuner_semaine boolean not null default false,
  add column vege_diner_semaine boolean not null default false,
  add column vege_dejeuner_weekend boolean not null default false,
  add column vege_diner_weekend boolean not null default false;
