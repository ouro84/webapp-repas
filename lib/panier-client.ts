// Panier Chronodrive côté navigateur (#308) : lecture de l'état (RG-81 : le
// bouton n'existe que pour un foyer doté d'un exécuteur) et lancement d'une
// demande (RG-83 : une seule demande active par foyer, arbitrée côté serveur).

import { parseApiError } from "@/lib/errors"
import type { EtatPanier } from "@/lib/panier-affichage"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"

/**
 * Lit `etat_panier()` (RPC `SECURITY DEFINER` : l'existence de l'exécuteur ne
 * se lit pas autrement). Lève sur erreur sans l'avaler : c'est l'appelant qui
 * logge et garde son dernier état connu.
 */
export async function chargerEtatPanier(
  supabase: ClientSupabase = clientParDefaut()
): Promise<EtatPanier> {
  const { data, error } = await supabase.rpc("etat_panier")
  if (error) throw new Error(`Lecture de l’état du panier impossible : ${error.message}`)
  if (!data) throw new Error("Lecture de l’état du panier impossible : aucune donnée renvoyée.")
  return data as EtatPanier
}

/**
 * Jour de courses du foyer, lu directement et SANS repli : jumeau de la route
 * `POST /api/panier/demande`. `chargerJourCoursesFoyer` retombe sur lundi en
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
 * `POST /api/panier/demande`, sans corps : la route vise toujours le cycle
 * courant du foyer. 202 → `ok` ; tout autre statut → message de la route.
 * Ne lève jamais : l'échec réseau devient un message affichable.
 */
export async function lancerDemandePanier(
  options: { fetch?: typeof fetch } = {}
): Promise<ResultatLancement> {
  const appeler = options.fetch ?? fetch
  try {
    const reponse = await appeler("/api/panier/demande", { method: "POST" })
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
