"use client";

// Consentement analytics (#236, US-30) — bandeau cookies.
//
// Fondation AUTONOME, indépendante de PostHog (US-37, non installé dans cette
// PR) : `consentementAnalytics()` est le point d'accroche documenté pour la
// future init conditionnelle. Stocké en localStorage (clé `consentement_analytics`,
// "true"/"false") ; null = aucun choix fait, le bandeau doit s'afficher.
//
// Do Not Track (navigator.doNotTrack) prime toujours sur tout choix stocké :
// un refus déjà exprimé au niveau navigateur ne redemande jamais — le bandeau
// ne s'affiche même pas (cf. useConsentementAnalytics).

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

export type ChoixConsentement = boolean | null;

const CLE = "consentement_analytics";
const abonnes = new Set<() => void>();

/** Vrai si le navigateur signale Do Not Track (legacy inclus). */
export function refusImposeParDNT(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack ?? (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack;
  return dnt === "1" || dnt === "yes";
}

/**
 * Logique pure de décision : DNT prime toujours (force `false`) ; sinon le
 * choix stocké (`"true"`/`"false"`) ; sinon `null` (aucun choix — bandeau à
 * afficher). Une valeur stockée corrompue/inattendue est traitée comme absente.
 */
export function resoudreConsentement(
  brut: string | null,
  dntActif: boolean
): ChoixConsentement {
  if (dntActif) return false;
  if (brut === "true") return true;
  if (brut === "false") return false;
  return null;
}

/** Accesseur boolean simple (point d'accroche PostHog, US-37) : faux tant
 *  qu'aucun choix explicite d'acceptation n'a été fait. */
export function consentementDepuisChoix(choix: ChoixConsentement): boolean {
  return choix === true;
}

function lireBrut(): ChoixConsentement {
  if (typeof localStorage === "undefined") return resoudreConsentement(null, refusImposeParDNT());
  return resoudreConsentement(localStorage.getItem(CLE), refusImposeParDNT());
}

function notifier(): void {
  abonnes.forEach((cb) => cb());
}

export const storeConsentement = {
  sAbonner(cb: () => void): () => void {
    abonnes.add(cb);
    return () => abonnes.delete(cb);
  },
  lire: lireBrut,
  // SSR / prérendu : aucun choix connu (le bandeau ne se décide que côté client).
  lireServeur: (): ChoixConsentement => null,
};

/** Enregistre le choix (Accepter/Refuser depuis le bandeau ou /profil). */
export function definirConsentement(valeur: boolean): void {
  try {
    localStorage.setItem(CLE, String(valeur));
  } catch {
    // localStorage indisponible (mode privé strict) : le choix vaut pour la
    // session courante seulement, sans persistance — pas d'erreur bloquante.
  }
  notifier();
}

/** Choix courant (null = aucun choix, bandeau à afficher), réactif. */
export function useConsentementAnalytics(): ChoixConsentement {
  return useSyncExternalStore(
    storeConsentement.sAbonner,
    storeConsentement.lire,
    storeConsentement.lireServeur
  );
}

/** Point d'accroche pour la future init PostHog (US-37) : faux tant qu'aucun
 *  choix explicite d'acceptation n'a été fait. PostHog n'est pas installé dans
 *  cette PR — cette fonction n'a aucun appelant fonctionnel pour l'instant. */
export function consentementAnalytics(): boolean {
  return consentementDepuisChoix(lireBrut());
}

// ---------------------------------------------------------------------------
// Synchronisation serveur (profiles.consentement_analytics) — best-effort,
// jamais bloquant pour l'UI. Le local (localStorage) reste la source
// d'affichage immédiate (bandeau/interrupteur) ; le serveur ne sert qu'à
// rendre le choix consultable/révocable depuis /profil et entre appareils
// SANS mécanique de fusion (pas de pull qui écraserait un choix local plus
// récent — hors scope de cette PR).
// ---------------------------------------------------------------------------

async function synchroniserConsentementServeur(valeur: boolean): Promise<void> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // Déconnecté (bandeau visible sur les pages publiques).
    const { error } = await supabase
      .from("profiles")
      .update({ consentement_analytics: valeur })
      .eq("user_id", user.id);
    if (error) throw error;
  } catch (erreur) {
    console.error("Synchronisation du consentement analytics échouée (best-effort).", erreur);
  }
}

/** Accepte le suivi analytics : écrit en local (immédiat) puis synchronise le
 *  profil serveur (best-effort). Utilisé par le bandeau et /profil. */
export function accepterConsentement(): void {
  definirConsentement(true);
  void synchroniserConsentementServeur(true);
}

/** Refuse le suivi analytics : mêmes garanties qu'accepterConsentement. */
export function refuserConsentement(): void {
  definirConsentement(false);
  void synchroniserConsentementServeur(false);
}
