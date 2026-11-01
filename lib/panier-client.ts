// Panier Chronodrive côté navigateur (#308) : lecture de l'état (RG-81 : le
// bouton n'existe que pour un foyer doté d'un exécuteur) et lancement d'une
// demande (RG-83 : une seule demande active par foyer, arbitrée côté serveur).

import { parseApiError } from "@/lib/errors"
import type { EtatPanier } from "@/lib/panier-affichage"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"

/**
 * Lit `etat_panier(p_ancre)` (RPC `SECURITY DEFINER` : l'existence de l'exécuteur
 * ne se lit pas autrement) : `derniere` est la demande de l'ancre affichée,
 * `active` la demande en cours du foyer quel que soit son cycle (#320, RG-83).
 * `null` : pas de cycle affiché, la base ne renvoie que `active`. Lève sur
 * erreur sans l'avaler : c'est l'appelant qui logge et garde son dernier état.
 */
export async function chargerEtatPanier(
  ancre: string | null,
  supabase: ClientSupabase = clientParDefaut()
): Promise<EtatPanier> {
  const { data, error } = await supabase.rpc("etat_panier", { p_ancre: ancre })
  if (error) throw new Error(`Lecture de l’état du panier impossible : ${error.message}`)
  if (!data) throw new Error("Lecture de l’état du panier impossible : aucune donnée renvoyée.")
  return data as EtatPanier
}

/**
 * Jour de courses du foyer, lu directement et SANS repli : jumeau de la route
 * `POST /api/panier/demande` (ancre par défaut quand le corps n'en porte pas). `chargerJourCoursesFoyer` retombe sur lundi en
 * cas d'erreur, ce qui ferait croire que le cycle courant est un autre cycle
 * (bouton montré ou masqué à tort). Lève sur erreur ; la RLS borne la ligne.
 */
export async function chargerJourCoursesPanier(
  supabase: ClientSupabase = clientParDefaut()
): Promise<number> {
  const { data, error } = await supabase.from("foyers").select("jour_courses").maybeSingle()
  if (error) throw new Error(`Lecture du jour de courses impossible : ${error.message}`)
  if (!data) throw new Error("Lecture du jour de courses impossible : foyer introuvable.")
  return (data as { jour_courses: number }).jour_courses
}

/** `statut` : code HTTP de la route, `null` si la requête n'a pas abouti (réseau). */
export type ResultatLancement =
  | { ok: true }
  | { ok: false; statut: number | null; message: string }

/**
 * `POST /api/panier/demande` avec `{ ancre }` : la demande vise le cycle affiché
 * (#320). 202 → `ok` ; tout autre statut → message de la route (dont 409 pour
 * un cycle terminé). Ne lève jamais : l'échec réseau devient un message affichable.
 */
export async function lancerDemandePanier(
  ancre: string,
  options: { fetch?: typeof fetch } = {}
): Promise<ResultatLancement> {
  const appeler = options.fetch ?? fetch
  try {
    const reponse = await appeler("/api/panier/demande", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ancre }),
    })
    if (reponse.status === 202) return { ok: true }
    return { ok: false, statut: reponse.status, message: await parseApiError(reponse) }
  } catch (err) {
    console.error("Lancement du panier impossible :", err)
    return {
      ok: false,
      statut: null,
      message: "Connexion impossible : vérifie ton réseau, puis réessaie.",
    }
  }
}
