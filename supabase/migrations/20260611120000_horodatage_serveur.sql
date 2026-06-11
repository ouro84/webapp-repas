-- Migration — horodatage 100 % serveur de updated_at (#104).
-- Date : 2026-06-11
--
-- Suite à la sync multi-device (#6, RG-23, révision ADR-02 du 2026-06-08), le
-- last-write-wins compare l'updated_at des tables planning et etat_courses.
-- Jusqu'ici cet horodatage était posé par LE CLIENT (new Date().toISOString()),
-- donc soumis aux horloges désynchronisées entre appareils : un appareil en
-- retard pouvait « gagner » à tort.
--
-- Parade : un trigger BEFORE INSERT OR UPDATE écrase updated_at avec now()
-- (horloge serveur, début de transaction). Contrairement à `default now()`,
-- il couvre aussi les UPDATE et ignore toute valeur fournie par le client.
-- PostgREST renvoie la valeur post-trigger dans le RETURNING (.select()).

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger planning_set_updated_at
  before insert or update on planning
  for each row execute function set_updated_at();

create trigger etat_courses_set_updated_at
  before insert or update on etat_courses
  for each row execute function set_updated_at();
