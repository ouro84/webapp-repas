// Accès au profil utilisateur — lecture/écriture côté CLIENT (#22 PR1).
//
// Source de vérité : Supabase (table `profiles`, RLS « ma propre ligne » pour
// l'écriture, « membres de mon foyer » pour la lecture). Sert la page /profil
// (édition prénom + couleur d'avatar) et le tunnel d'onboarding (#22 PR2 :
// saisie du prénom, clôture de l'onboarding).
//
// Le changement de FOYER ne passe PAS par ici (cf. lib/foyer.ts + RPC) : le
// grant au niveau colonne (migration) interdit d'écrire foyer_id par cette voie.

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { couleurValide } from "@/lib/avatar";
import type { DbProfil, Profil } from "@/types";

function dbProfilToDomain(db: DbProfil): Profil {
  return {
    prenom: db.prenom,
    couleurAvatar: db.couleur_avatar,
    onboardingComplete: db.onboarding_complete,
  };
}

/**
 * Charge le profil de l'utilisateur connecté (prénom, couleur, onboarding).
 * La RLS restreint la lecture aux membres du foyer ; on filtre sur user_id pour
 * ne récupérer QUE sa propre ligne.
 */
export async function chargerProfil(): Promise<Profil> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Tu dois être connecté pour accéder à ton profil.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("prenom, couleur_avatar, onboarding_complete")
    .eq("user_id", user.id)
    .single();

  if (error) {
    throw new Error(`Chargement du profil impossible : ${error.message}`);
  }
  return dbProfilToDomain(data as DbProfil);
}

/**
 * Met à jour l'identité visible du profil (prénom et/ou couleur d'avatar).
 * Le prénom est `trim`é ; la couleur est validée contre la palette (une valeur
 * hors palette est ignorée plutôt que persistée). N'écrit que les champs
 * fournis (UPDATE partiel).
 */
export async function sauvegarderProfil(champs: {
  prenom?: string;
  couleurAvatar?: string;
}): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Tu dois être connecté pour modifier ton profil.");
  }

  const maj: Partial<DbProfil> = {};
  if (champs.prenom !== undefined) maj.prenom = champs.prenom.trim();
  if (champs.couleurAvatar !== undefined) {
    const couleur = couleurValide(champs.couleurAvatar);
    if (couleur) maj.couleur_avatar = couleur;
  }
  if (Object.keys(maj).length === 0) return;

  const { error } = await supabase
    .from("profiles")
    .update(maj)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Enregistrement du profil impossible : ${error.message}`);
  }

  // Reflète l'édition dans le store partagé → la nav (avatar) se met à jour sans
  // rechargement (cf. store ci-dessous).
  majProfilStore({
    ...(maj.prenom !== undefined ? { prenom: maj.prenom } : {}),
    ...(maj.couleur_avatar !== undefined
      ? { couleurAvatar: maj.couleur_avatar }
      : {}),
  });
}

/**
 * Clôture l'onboarding (passe onboarding_complete à true). Appelé à la fin du
 * tunnel /bienvenue (#22 PR2) ; isolé ici pour que la PR2 n'ait pas à retoucher
 * la couche d'accès.
 */
export async function marquerOnboardingComplete(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Tu dois être connecté.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_complete: true })
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Clôture de l'onboarding impossible : ${error.message}`);
  }
}

// ============================================================================
// Store du profil courant (#22 PR1)
//
// Le profil vit dans Supabase, mais la nav (avatar) doit l'afficher sur toutes
// les pages ET refléter une édition faite dans /profil sans rechargement. On le
// cache donc en mémoire avec le motif maison `useSyncExternalStore` (l'état
// React n'est pas partagé entre composants ; cf. lib/theme.ts / lib/stockage.ts).
//
// Chargement PARESSEUX au premier abonnement (la nav, montée dans le layout) :
// un seul appel réseau par chargement de page. Déconnecté → chargerProfil lève,
// l'erreur est avalée, le store reste null → avatar neutre. Pas de snapshot
// serveur (SSR rend null → avatar neutre, hydratation ensuite).
// ============================================================================

let profilCourant: Profil | null = null;
let chargementLance = false;
const abonnesProfil = new Set<() => void>();

function notifierProfil(): void {
  for (const cb of abonnesProfil) cb();
}

function majProfilStore(champs: Partial<Profil>): void {
  if (profilCourant) {
    profilCourant = { ...profilCourant, ...champs };
    notifierProfil();
  }
}

function sabonnerProfil(cb: () => void): () => void {
  abonnesProfil.add(cb);
  if (!chargementLance) {
    chargementLance = true;
    chargerProfil()
      .then((p) => {
        profilCourant = p;
        notifierProfil();
      })
      .catch(() => {
        // Déconnecté / erreur réseau : on reste sur l'avatar neutre. On relâche
        // le verrou de chargement (#166) pour qu'un prochain abonnement (ex. la
        // page /profil qui monte plus tard) RÉESSAIE — sinon un échec réseau
        // transitoire neutraliserait le profil pour toute la session (avatar
        // neutre + EditionIdentite figée sur « Chargement… »).
        chargementLance = false;
      });
  }
  return () => {
    abonnesProfil.delete(cb);
  };
}

function lireProfil(): Profil | null {
  return profilCourant;
}

function lireProfilServeur(): null {
  return null;
}

/** Profil courant pour la nav (null tant que non chargé / déconnecté). */
export function useProfil(): Profil | null {
  return useSyncExternalStore(sabonnerProfil, lireProfil, lireProfilServeur);
}
