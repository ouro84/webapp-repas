// Accès aux préférences favoris/évités de recette — lecture/écriture côté
// client (#219, US-49, RG-58→63).
//
// Portée FOYER (RG-60) : la RLS de recette_preference ne renvoie/n'accepte
// que les lignes du foyer courant (mon_foyer()), pas besoin de filtrer
// nous-mêmes. Présence de ligne = préférence non-neutre ; absence = neutre
// (même schéma que recette_masquee, #105).

import { createClient } from "@/lib/supabase/client"
import { clientParDefaut } from "@/lib/supabase/par-defaut"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { PreferencesRecettes, RecettePreference } from "@/lib/generateur"

// Écritures en vol par recette (#352) : chaque écriture part après la
// précédente de la même recette, et une lecture attend leur fin. Pourquoi :
// deux bascules rapides (favorite puis évitée) partaient en parallèle et
// pouvaient se valider dans le désordre (la base gardait « favorite »), et une
// fiche rouverte aussitôt relisait la base avant la dernière écriture.
const ecrituresEnVol = new Map<string, Promise<void>>()

// Attend la fin (succès ou échec) des écritures en vol, d'une recette ou de toutes.
async function attendreEcritures(recetteId?: string): Promise<void> {
  const enVol =
    recetteId === undefined ? [...ecrituresEnVol.values()] : [ecrituresEnVol.get(recetteId)]
  await Promise.allSettled(enVol)
}

/**
 * Charge toutes les préférences du foyer courant (id de recette → préférence).
 * Sert la vue en liste (« Mes recettes ») qui affiche N recettes à la fois —
 * un seul aller-retour plutôt qu'une requête par recette.
 */
export async function chargerPreferences(
  client: ClientSupabase = clientParDefaut()
): Promise<PreferencesRecettes> {
  await attendreEcritures()
  const { data, error } = await client
    .from("recette_preference")
    .select("recette_id, preference")
  if (error) {
    throw new Error(`Chargement des préférences impossible : ${error.message}`)
  }
  return new Map(
    (data ?? []).map((ligne) => [
      (ligne as { recette_id: string }).recette_id,
      (ligne as { preference: RecettePreference }).preference,
    ])
  )
}

/**
 * Charge la préférence d'UNE recette (fiche recette, consultation isolée).
 * `null` si neutre (aucune ligne).
 */
export async function chargerPreference(
  recetteId: string
): Promise<RecettePreference | null> {
  await attendreEcritures(recetteId)
  const client = createClient()
  const { data, error } = await client
    .from("recette_preference")
    .select("preference")
    .eq("recette_id", recetteId)
    .maybeSingle()
  if (error) {
    throw new Error(`Chargement de la préférence impossible : ${error.message}`)
  }
  return (data as { preference: RecettePreference } | null)?.preference ?? null
}

/**
 * Bascule la préférence d'une recette (RG-63) : passer à `null` revient au
 * neutre (delete) ; passer à `"favorite"`/`"evitee"` remplace directement
 * l'état précédent (upsert — un seul aller-retour, pas de delete+insert).
 * `foyer_id` est posé par le default `mon_foyer()` (#56 PR2) ; la RLS rejette
 * si non connecté ou hors foyer. Écritures d'une même recette sérialisées
 * (cf. `ecrituresEnVol`) : la dernière demandée est la dernière écrite.
 */
export function definirPreference(
  recetteId: string,
  preference: RecettePreference | null
): Promise<void> {
  const precedente = ecrituresEnVol.get(recetteId) ?? Promise.resolve()
  const ecriture = precedente
    .catch(() => {}) // un échec précédent (déjà remonté à son appelant) ne bloque pas
    .then(() => ecrirePreference(recetteId, preference))
  ecrituresEnVol.set(recetteId, ecriture)
  const nettoyer = () => {
    if (ecrituresEnVol.get(recetteId) === ecriture) ecrituresEnVol.delete(recetteId)
  }
  ecriture.then(nettoyer, nettoyer)
  return ecriture
}

async function ecrirePreference(
  recetteId: string,
  preference: RecettePreference | null
): Promise<void> {
  const client = createClient()
  if (preference === null) {
    const { error } = await client
      .from("recette_preference")
      .delete()
      .eq("recette_id", recetteId)
    if (error) {
      throw new Error(`Mise à jour de la préférence impossible : ${error.message}`)
    }
    return
  }
  const { error } = await client
    .from("recette_preference")
    .upsert({ recette_id: recetteId, preference })
  if (error) {
    throw new Error(`Mise à jour de la préférence impossible : ${error.message}`)
  }
}
