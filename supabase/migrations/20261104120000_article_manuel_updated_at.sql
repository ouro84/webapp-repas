-- Migration — horloge serveur sur article_manuel (ordre des échos Realtime).
-- Date : 2026-11-04
--
-- Le temps réel ne garantit pas l'ordre de livraison des événements : l'écho
-- INSERT de la création d'un article manuel (coche false) pouvait arriver
-- APRÈS l'écho de la coche posée juste ensuite, et redécocher l'article chez
-- l'auteur. Le client n'applique désormais un écho que s'il est strictement
-- plus récent que l'état connu, sur cette horloge serveur.
--
-- Même mécanisme que planning / etat_courses_article (20260611120000) :
-- trigger BEFORE INSERT OR UPDATE qui écrase toute valeur client par now().
-- PostgREST renvoie la valeur post-trigger dans le RETURNING (.select()).
-- REPLICA IDENTITY FULL (déjà posé) inclut la colonne dans les événements.
--
-- quitter_foyer() clone article_manuel avec une liste de colonnes explicite :
-- la nouvelle colonne prend son default, rien à recréer.

alter table article_manuel
  add column updated_at timestamptz not null default now();

create trigger article_manuel_set_updated_at
  before insert or update on article_manuel
  for each row execute function set_updated_at();
