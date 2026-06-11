-- Migration — correctif search_path de generer_code_invitation (#56 PR3).
-- Date : 2026-06-11
--
-- Bug LATENT introduit en #56 PR1 : `generer_code_invitation` était définie avec
-- `set search_path = public`, mais sur Supabase l'extension **pgcrypto** est
-- installée dans le schéma `extensions` (vérifié) → `gen_random_bytes` y est
-- introuvable depuis le search_path `public` seul :
--   ERROR 42883: function gen_random_bytes(integer) does not exist
-- PR1 n'appelait JAMAIS la fonction (l'UI d'invitation arrive en PR3), d'où la
-- découverte tardive (au premier clic « Inviter », e2e PR3).
--
-- Correctif : on ajoute `extensions` au search_path (toujours FIGÉ — bonne
-- pratique SECURITY DEFINER : pas de search_path mutable). Corps identique à PR1.
--
-- Fichier de migration SÉPARÉ (et non une édition de PR1/du fichier PR3) : ces
-- migrations sont déjà appliquées sur staging → `db push` ne les rejouerait pas.

create or replace function generer_code_invitation()
returns text
language plpgsql
security definer
set search_path = public, extensions
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
