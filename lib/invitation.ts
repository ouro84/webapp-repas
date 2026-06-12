// Deep-link d'acquisition (#22 PR3, US-24) — capture et relecture d'un code
// d'invitation qui doit SURVIVRE au flux d'auth (un destinataire sans compte
// clique un lien → s'inscrit → le code doit encore être là à la fin du tunnel).
//
// Mécanique : le code voyage en `sessionStorage` (même origine, survit aux
// navigations pleine page et aux redirections du proxy). Il est capté depuis
// l'URL (`?code=` — ou `?rejoindre=`, l'ancien nom du lien /profil) le plus tôt
// possible (composant monté dans le layout, donc actif sur toutes les pages, y
// compris /login et /signup avant tout submit), puis consommé par le tunnel
// (`/bienvenue`, nouvel inscrit) ou par l'interstitiel (membre déjà connecté).

import { createClient } from "@/lib/supabase/client";

const CLE = "code_invitation_en_attente";

/**
 * Capte un code présent dans l'URL (`?code=` ou `?rejoindre=`) vers
 * sessionStorage, puis NETTOIE l'URL (history.replaceState) pour qu'un
 * rechargement ne le re-capte pas. Renvoie le code capté (ou déjà en attente),
 * ou null. No-op côté serveur.
 */
export function capterCodeDepuisURL(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const codeUrl = params.get("code") ?? params.get("rejoindre");
  if (codeUrl) {
    const code = codeUrl.trim().toUpperCase();
    sessionStorage.setItem(CLE, code);
    // Retire le paramètre de l'URL (sans recharger) — le code vit désormais en
    // sessionStorage ; éviter de le re-capter / de le laisser traîner.
    params.delete("code");
    params.delete("rejoindre");
    const reste = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (reste ? `?${reste}` : "") + window.location.hash
    );
    return code;
  }
  return sessionStorage.getItem(CLE);
}

/** Code d'invitation en attente (sessionStorage), ou null. */
export function lireCodeEnAttente(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(CLE);
}

/** Efface le code en attente (après consommation : rejoint, ignoré, ou expiré). */
export function effacerCodeEnAttente(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(CLE);
}

export type ApercuInvitation = {
  /** true si le code est valide et non expiré. */
  valide: boolean;
  /** Prénom de l'invitant (le membre le plus ancien), ou null si non renseigné. */
  prenom: string | null;
};

/**
 * Aperçu d'une invitation (RPC `apercu_invitation`, #22 PR3) : valide le code et
 * renvoie le prénom de l'invitant, SANS rejoindre. Sert à afficher « Vous
 * rejoignez le foyer de X » avant confirmation. 0 ligne = code invalide/expiré.
 */
export async function apercuInvitation(code: string): Promise<ApercuInvitation> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("apercu_invitation", {
    p_code: code,
  });
  if (error) {
    throw new Error(error.message || "Vérification du code impossible.");
  }
  const lignes = (data ?? []) as { prenom: string | null }[];
  if (lignes.length === 0) return { valide: false, prenom: null };
  return { valide: true, prenom: lignes[0]?.prenom ?? null };
}
