-- Migration — socle du Foyer partagé (#56 PR1, US-19).
-- Date : 2026-06-11
--
-- Introduit la notion de Foyer (groupe d'utilisateurs partageant recettes,
-- planning et liste de courses). Modèle « foyer de 1 systématique » : TOUT
-- utilisateur appartient toujours à un foyer (jamais NULL), créé à
-- l'inscription. Ce choix évite le double-chemin « solo (NULL) vs foyer »
-- dans les RLS et requêtes des PR suivantes.
--
-- ⚠️ Cette PR ne change PAS le comportement applicatif : aucune RLS « foyer »
-- ni bascule de données ici (c'est #56 PR2). On pose seulement les tables, le
-- trigger d'inscription, le backfill, le helper mon_foyer() et la génération
-- de code d'invitation.
--
-- ⚠️ Ordre migrations (staging partagé) : merger cette PR avant les suivantes
-- de l'épopée #56.

-- gen_random_bytes() pour un code d'invitation à randomness cryptographique
-- (JAMAIS random(), PRNG non sûr).
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

-- Un foyer. Le code d'invitation est NULLable et généré PARESSEUSEMENT (au clic
-- « Inviter », PR3), pas à la création du foyer : un foyer solo qui n'invite
-- jamais n'a aucun code valide → surface de brute-force minimale.
create table foyers (
  id uuid primary key default uuid_generate_v4(),
  code_invitation text unique,
  expire_le timestamptz,
  created_at timestamptz not null default now()
);

-- Profil applicatif : rattache un compte auth.users à son foyer (FK non-null,
-- modèle « foyer de 1 »). Les réglages de génération restent une table séparée,
-- PAR-UTILISATEUR (non basculée en foyer — RG #56).
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  foyer_id uuid not null references foyers(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Helper RLS : le foyer de l'utilisateur courant
--
-- SECURITY DEFINER : contourne la RLS de `profiles` (sinon récursion quand une
-- policy de `profiles` appellerait mon_foyer()) et reste utilisable depuis
-- toutes les policies des PR suivantes. search_path figé (bonne pratique
-- SECURITY DEFINER : empêche le détournement par un schéma malveillant).
-- ------------------------------------------------------------
create or replace function mon_foyer()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select foyer_id from profiles where user_id = auth.uid();
$$;

-- ------------------------------------------------------------
-- Génération du code d'invitation (durci, expirable, réutilisable)
--
-- 8 caractères d'un alphabet de 32 (sans I/O/0/1 ambigus). 32 divise 256 : le
-- modulo sur un octet aléatoire est donc SANS biais. Retry en cas de collision
-- sur la contrainte unique. Expiration à 7 jours ; le code reste valide jusque-
-- là (multi-jonction, pas usage unique — décision produit).
--
-- Parameterless + dérivation via mon_foyer() : impossible de cibler le foyer
-- d'un autre (pas de surface de spoofing). Tout membre peut (re)générer (RG-30).
-- Exposée en RPC PostgREST (appelée par l'app en PR3).
-- ------------------------------------------------------------
create or replace function generer_code_invitation()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 car., sans I O 0 1
  v_foyer uuid := mon_foyer();
  v_code text;
  i int;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(
        alphabet,
        1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;

    begin
      update foyers
        set code_invitation = v_code,
            expire_le = now() + interval '7 days'
        where id = v_foyer;
      return v_code; -- pas de collision : on sort
    exception when unique_violation then
      -- code déjà pris par un autre foyer : on retente
    end;
  end loop;
end;
$$;

revoke execute on function generer_code_invitation() from public;
grant execute on function generer_code_invitation() to authenticated;

-- ------------------------------------------------------------
-- Création automatique foyer + profil à l'inscription
--
-- SECURITY DEFINER : le trigger écrit dans public.* depuis le contexte auth.
-- Le foyer est créé SANS code (génération paresseuse, cf. ci-dessus).
-- ------------------------------------------------------------
create or replace function creer_foyer_et_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid;
begin
  insert into foyers default values returning id into v_foyer;
  insert into profiles (user_id, foyer_id) values (new.id, v_foyer);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function creer_foyer_et_profil();

-- ------------------------------------------------------------
-- Backfill : un foyer de taille 1 pour chaque utilisateur existant
-- (idempotent : ne touche pas les comptes ayant déjà un profil).
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_foyer uuid;
begin
  for r in select id from auth.users loop
    if not exists (select 1 from profiles where user_id = r.id) then
      insert into foyers default values returning id into v_foyer;
      insert into profiles (user_id, foyer_id) values (r.id, v_foyer);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Row Level Security
--
-- INSERT/UPDATE/DELETE passent par des fonctions SECURITY DEFINER (trigger
-- d'inscription, RPC de génération de code, RPC jonction/sortie en PR3/PR6) qui
-- contournent la RLS — d'où l'absence (volontaire) de policies d'écriture ici.
-- ------------------------------------------------------------
alter table foyers enable row level security;
alter table profiles enable row level security;

-- foyers : un utilisateur ne voit que SON foyer (code/expiration inclus). La
-- jonction par code (PR3) passera par une RPC SECURITY DEFINER → pas de
-- lecture publique « par code » ici (les codes restent non énumérables).
create policy "foyers: lecture de mon foyer"
  on foyers for select
  using (id = mon_foyer());

-- profiles : un utilisateur voit tous les membres de son foyer (comptage des
-- membres en PR3). mon_foyer() étant SECURITY DEFINER, pas de récursion RLS.
create policy "profiles: lecture des membres de mon foyer"
  on profiles for select
  using (foyer_id = mon_foyer());
