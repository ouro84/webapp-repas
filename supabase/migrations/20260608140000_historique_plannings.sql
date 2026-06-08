-- Migration — historique des plannings (#5, US-14, PR1).
-- Prépare le multi-semaines : les coches de la liste de courses deviennent
-- propres à CHAQUE semaine (et non plus une seule ligne par utilisateur).
--
-- `planning` a déjà unique(user_id, semaine) → il peut stocker plusieurs
-- semaines ; côté code, la persistance passe d'un remplacement global
-- (mono-actif) à un upsert par semaine (cf. lib/persistance.ts).
--
-- etat_courses : la PK passe de (user_id) à (user_id, semaine). Les coches
-- étant transitoires (US-13), on repart d'une table vide — l'utilisateur
-- recochera ; aucune donnée métier durable n'est perdue.

truncate table etat_courses;

alter table etat_courses drop constraint etat_courses_pkey;

alter table etat_courses
  add column semaine text not null;

alter table etat_courses
  add primary key (user_id, semaine);
