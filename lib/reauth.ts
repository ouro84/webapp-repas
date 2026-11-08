/**
 * Ré-authentification avant une action destructive (RG-93, D9).
 *
 * Logique pure : la route lit le claim `amr` du JWT de la session courante
 * (`supabase.auth.getClaims()`) et le passe ici. On n’utilise volontairement
 * pas `last_sign_in_at` : il est par utilisateur, pas par session.
 */

/**
 * Âge maximal (en secondes) de la dernière authentification acceptée.
 * Jumeau SQL : `authentification_recente(p_max_s default 300)` et le contrôle
 * OMQ06 de `supprimer_mon_compte()`
 * (`supabase/migrations/20261108120000_suppression_compte_fraicheur.sql`) :
 * garder le seuil et la sémantique alignés.
 */
export const FRAICHEUR_MAX_S = 300

/**
 * Vrai si la session s’est authentifiée il y a au plus `FRAICHEUR_MAX_S`.
 * `amr` vient d’un JWT : type `AMREntry[] | string[]` côté SDK. La forme
 * `string[]` n’a pas d’horodatage, donc refus (fail-safe), comme pour tout
 * tableau vide, non-tableau ou timestamp non numérique.
 */
export function authentificationRecente(
  amr: unknown,
  maintenantS: number
): boolean {
  if (!Array.isArray(amr)) return false

  let dernier = -Infinity
  for (const entree of amr) {
    if (typeof entree !== "object" || entree === null) continue
    const ts = (entree as { timestamp?: unknown }).timestamp
    if (typeof ts === "number" && Number.isFinite(ts) && ts > dernier) {
      dernier = ts
    }
  }
  if (dernier === -Infinity) return false

  return maintenantS - dernier <= FRAICHEUR_MAX_S
}

type Identites = ReadonlyArray<{ provider: string }> | null | undefined

/** Vrai si le compte a une identité mot de passe (provider `email`). */
export function aMotDePasse(identites: Identites): boolean {
  return !!identites?.some((i) => i.provider === "email")
}

export type MethodeReauth = "mot-de-passe" | "google"

/** Méthode de ré-authentification à proposer : mot de passe si le compte en a un, sinon Google. */
export function methodeReauth(identites: Identites): MethodeReauth {
  return aMotDePasse(identites) ? "mot-de-passe" : "google"
}
