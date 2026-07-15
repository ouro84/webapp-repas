-- Migration — créneau désactivable « Aucun » (#217, US-48).
-- Date : 2026-07-15
--
-- RG-44 : chaque plafond max_* accepte désormais 'aucun' en plus de
-- 'rapide'/'normal'/'long' — le créneau n'est alors pas généré (RG-46).
-- RG-47 : au moins un créneau doit rester actif — défense en profondeur en
-- plus de la validation applicative (validerReglages / page /reglages).
-- Les contraintes CHECK sans nom explicite ont été nommées automatiquement
-- par Postgres <table>_<colonne>_check (cf. migration d'origine 20260608160000).

alter table reglages
  drop constraint reglages_max_dejeuner_semaine_check,
  drop constraint reglages_max_diner_semaine_check,
  drop constraint reglages_max_dejeuner_weekend_check,
  drop constraint reglages_max_diner_weekend_check;

alter table reglages
  add constraint reglages_max_dejeuner_semaine_check
    check (max_dejeuner_semaine in ('rapide', 'normal', 'long', 'aucun')),
  add constraint reglages_max_diner_semaine_check
    check (max_diner_semaine in ('rapide', 'normal', 'long', 'aucun')),
  add constraint reglages_max_dejeuner_weekend_check
    check (max_dejeuner_weekend in ('rapide', 'normal', 'long', 'aucun')),
  add constraint reglages_max_diner_weekend_check
    check (max_diner_weekend in ('rapide', 'normal', 'long', 'aucun'));

-- RG-47 — au moins un créneau actif (la génération d'un planning entièrement
-- vide est interdite).
alter table reglages
  add constraint reglages_au_moins_un_creneau_actif_check
    check (
      max_dejeuner_semaine <> 'aucun'
      or max_diner_semaine <> 'aucun'
      or max_dejeuner_weekend <> 'aucun'
      or max_diner_weekend <> 'aucun'
    );
