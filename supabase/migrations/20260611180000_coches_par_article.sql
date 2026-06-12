-- Migration — coches de courses par-article + temps réel (#56 PR4, US-20, RG-32).
-- Date : 2026-06-11
--
-- Refonte de `etat_courses` : le blob JSONB unique par (foyer, semaine) est
-- remplacé par des LIGNES par-article (foyer, semaine, clé) → anti-clobber RÉEL.
-- Avec le blob, l'upsert remplaçait l'objet ENTIER : deux membres cochant des
-- articles différents en parallèle s'écrasaient (dernier écrit gagne). Avec une
-- ligne par article, chaque coche/décoche est une opération atomique au niveau
-- LIGNE → les modifications concurrentes sur des articles distincts fusionnent.
--
-- Le client applique des opérations par-article (upsert au cochage, delete au
-- décochage — accès DIRECT sous RLS, plus besoin de RPC atomique contrairement
-- au blob #56 PR2) et s'abonne au TEMPS RÉEL (Supabase Realtime) pour recevoir
-- les coches des autres membres. La RLS « foyer » s'applique aussi aux events
-- Realtime (autorisation évaluée avec le JWT de l'abonné).

-- ============================================================================
-- 1. Nouvelle table par-article
-- ============================================================================
create table etat_courses_article (
  -- default mon_foyer() : le client n'a pas à fournir le foyer (comme recette).
  foyer_id uuid not null default mon_foyer() references foyers(id),
  semaine text not null,
  -- Clé d'agrégation de la liste de courses : « nom|unité » (RG-05).
  cle text not null,
  -- Quantité au moment du cochage : invalidation RG-12 si l'agrégat change.
  quantite double precision not null,
  updated_at timestamptz not null default now(),
  primary key (foyer_id, semaine, cle)
);

create index etat_courses_article_foyer_semaine_idx
  on etat_courses_article (foyer_id, semaine);

-- Horodatage 100 % serveur (#104) : même trigger que planning/etat_courses.
create trigger etat_courses_article_set_updated_at
  before insert or update on etat_courses_article
  for each row execute function set_updated_at();

-- ============================================================================
-- 2. Migration des coches existantes (blob → lignes)
-- ============================================================================
-- jsonb_each_text déplie { "nom|unité": quantité } en lignes. Le default
-- mon_foyer() ne s'applique PAS ici (foyer_id fourni explicitement).
insert into etat_courses_article (foyer_id, semaine, cle, quantite)
select ec.foyer_id, ec.semaine, kv.key, kv.value::double precision
from etat_courses ec, jsonb_each_text(ec.coches) as kv
where ec.foyer_id is not null
on conflict do nothing;

-- ============================================================================
-- 3. RLS « foyer » — lecture + écriture directe (chaque op est atomique)
-- ============================================================================
alter table etat_courses_article enable row level security;

create policy "etat_courses_article: lecture foyer"
  on etat_courses_article for select
  using (foyer_id = mon_foyer());

create policy "etat_courses_article: insertion foyer"
  on etat_courses_article for insert
  with check (foyer_id = mon_foyer());

create policy "etat_courses_article: modification foyer"
  on etat_courses_article for update
  using (foyer_id = mon_foyer())
  with check (foyer_id = mon_foyer());

create policy "etat_courses_article: suppression foyer"
  on etat_courses_article for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 4. Temps réel — publier la table
-- ============================================================================
-- REPLICA IDENTITY FULL : les events UPDATE/DELETE portent la ligne complète
-- (dont foyer_id + cle), nécessaire pour retirer la bonne ligne côté client et
-- pour le filtrage défensif par foyer. (La PK seule suffirait pour la clé, mais
-- FULL garantit foyer_id dans le payload DELETE.)
alter table etat_courses_article replica identity full;
alter publication supabase_realtime add table etat_courses_article;

-- ============================================================================
-- 5. Repointage de rejoindre_foyer (#56 PR3) vers la nouvelle table
-- ============================================================================
-- rejoindre_foyer purgeait `etat_courses` du foyer solo quitté. On recrée la
-- fonction à l'identique (corps PR3), en remplaçant cette seule ligne par la
-- table par-article. quitter_foyer ne touche pas aux coches → inchangée.
create or replace function rejoindre_foyer(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid := mon_foyer();
  v_target uuid;
  v_membres_old int;
begin
  if v_old is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  select id into v_target
    from foyers
    where code_invitation = upper(trim(p_code))
      and expire_le > now();

  if v_target is null then
    raise exception 'Code invalide ou expiré';
  end if;
  if v_target = v_old then
    raise exception 'Tu fais déjà partie de ce foyer';
  end if;

  -- RG-29 : un seul foyer à la fois.
  select count(*) into v_membres_old from profiles where foyer_id = v_old;
  if v_membres_old > 1 then
    raise exception 'Quitte d''abord ton foyer actuel avant d''en rejoindre un autre';
  end if;

  -- RG-33 : fusion cumulative des catalogues (collisions de noms conservées).
  update recette set foyer_id = v_target where foyer_id = v_old;

  -- Rattachement du profil au foyer rejoint.
  update profiles set foyer_id = v_target where user_id = auth.uid();

  -- Nettoyage du foyer solo quitté (FK foyers non ON DELETE CASCADE).
  delete from recette_masquee where foyer_id = v_old;
  delete from etat_courses_article where foyer_id = v_old;
  delete from planning where foyer_id = v_old;
  delete from foyers where id = v_old;
end;
$$;

revoke execute on function rejoindre_foyer(text) from public;
grant execute on function rejoindre_foyer(text) to authenticated;

-- ============================================================================
-- 6. Suppression de l'ancien blob + sa RPC d'upsert
-- ============================================================================
drop function if exists sauvegarder_coches(text, jsonb);
drop table etat_courses;
