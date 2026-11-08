// Connexion avec Google — logique pure (US-57).
//
// Aucune dépendance Supabase : consommé par la route /auth/callback, le bouton
// Google, la page profil et l'onboarding. Testable sans navigateur.

import { cheminDeRetour } from "@/lib/redirection"

/** Route qui échange le `code` OAuth contre une session (US-57). */
export const CHEMIN_CALLBACK = "/auth/callback"

/**
 * URL de retour passée à `signInWithOAuth({ options: { redirectTo } })`.
 * `suivant` (chemin de retour après connexion, #305) n'est transmis que s'il
 * survit tel quel à `cheminDeRetour` : un chemin rejeté (open-redirect) ou que
 * l'analyseur d'URL réécrirait n'est pas propagé, le callback retombera sur
 * « /planning ».
 */
export function urlRetourOAuth(origine: string, suivant: string | null): string {
  const base = `${origine}${CHEMIN_CALLBACK}`
  if (suivant === null || cheminDeRetour(suivant) !== suivant) return base
  return `${base}?${new URLSearchParams({ suivant }).toString()}`
}

export type ErreurOAuth = "annule" | "echec"

/**
 * Lit les paramètres du callback OAuth : `access_denied` = l'utilisateur a
 * refusé chez Google (annulation, pas une panne) ; toute autre erreur, ou un
 * retour sans `code`, est un échec ; sinon pas d'erreur (`null`).
 */
export function erreurOAuthDepuisCallback(params: URLSearchParams): ErreurOAuth | null {
  const erreur = params.get("error")
  if (erreur === "access_denied") return "annule"
  if (erreur) return "echec"
  if (!params.get("code")) return "echec"
  return null
}

const MESSAGES_ERREUR_OAUTH: Record<ErreurOAuth, string> = {
  annule: "Connexion avec Google annulée. Tu peux réessayer ou utiliser ton email.",
  echec: "La connexion avec Google a échoué. Réessaie dans un instant ou utilise ton email.",
}

/** Message français pour la clé `?erreur_oauth=` de /login ; `null` si inconnue. */
export function messageErreurOAuth(cle: string | null): string | null {
  if (cle === "annule" || cle === "echec") return MESSAGES_ERREUR_OAUTH[cle]
  return null
}

function texteNonVide(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.trim() : ""
}

/**
 * Prénom proposé à l'onboarding depuis les métadonnées Google (RG-94) :
 * `given_name`, sinon premier mot de `full_name`, sinon de `name`, sinon "".
 */
export function prenomDepuisMetadonnees(
  meta: Record<string, unknown> | null | undefined
): string {
  if (!meta) return ""
  const prenom = texteNonVide(meta.given_name)
  if (prenom) return prenom
  for (const cle of ["full_name", "name"]) {
    const premierMot = texteNonVide(meta[cle]).split(/\s+/)[0]
    if (premierMot) return premierMot
  }
  return ""
}

/**
 * PWA iOS installée (mode standalone) : le flux OAuth y sort vers Safari et ne
 * revient pas dans l'app, d'où l'indice « ouvre OMQ dans Safari ».
 */
export function estPwaIos(nav: { standalone?: unknown }): boolean {
  return nav.standalone === true
}
