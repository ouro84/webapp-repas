-- Migration — planning en temps réel pour l'alerte intrusive (#56 PR5, US-21).
-- Date : 2026-06-12
--
-- Publie la table `planning` dans le flux temps réel : un membre « en magasin »
-- (sur /courses ou /planning) reçoit un event quand un autre membre du foyer
-- modifie le planning de la semaine à la maison → alerte bloquante + re-pull
-- (cf. lib/sync.ts). La RLS « foyer » (#56 PR2 : `foyer_id = mon_foyer()`)
-- s'applique aux events (autorisation évaluée avec le JWT de l'abonné).
--
-- On lit uniquement le `new` du payload (updated_at / semaine / foyer_id), tous
-- présents sur INSERT/UPDATE quelle que soit la REPLICA IDENTITY → pas besoin de
-- la passer à FULL (contrairement à etat_courses_article qui exploite `old` au
-- DELETE). Le discriminant « changement distant vs écho de ma propre écriture »
-- côté client est l'`updated_at` posé par le trigger serveur (#104), déjà suivi
-- comme horloge du last-write-wins (la colonne `version` #56 PR2 joue le même
-- rôle de compteur monotone).

alter publication supabase_realtime add table planning;
