-- Migration — aperçu d'une invitation par code (#22 PR3, US-23/US-24).
-- Date : 2026-06-12
--
-- Permet d'afficher « Vous rejoignez le foyer de [Prénom] » AVANT de rejoindre,
-- côté tunnel d'onboarding (deep-link /signup?code=) et interstitiel d'un membre
-- existant (/login?code=). On ne peut pas lire un foyer arbitraire par son code
-- via la RLS (les codes restent non énumérables, cf. #56 PR1) — d'où cette RPC
-- SECURITY DEFINER, qui valide le code (existence + non expiré) et renvoie le
-- prénom du membre le plus ancien (≈ le créateur/invitant).
--
-- Sécurité : ne révèle qu'un prénom à qui détient DÉJÀ un code valide (8 car.
-- aléatoires, non énumérables) — soit quelqu'un de délibérément invité. Aucune
-- énumération possible. search_path figé (+ pas d'appel d'extension ici).
--
-- Contrat : renvoie 0 ligne si le code est invalide/expiré ; 1 ligne sinon
-- (`prenom` pouvant être NULL si l'invitant n'a pas encore renseigné le sien →
-- l'UI affiche alors un libellé générique).

create or replace function apercu_invitation(p_code text)
returns table (prenom text)
language sql
security definer
set search_path = public
stable
as $$
  select p.prenom
  from foyers f
  join profiles p on p.foyer_id = f.id
  where f.code_invitation = upper(trim(p_code))
    and f.expire_le is not null
    and f.expire_le > now()
  order by p.created_at
  limit 1;
$$;

grant execute on function apercu_invitation(text) to authenticated;
