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

// Journal des intentions non confirmées (#404) : la dernière préférence voulue
// par recette, écrite en localStorage AVANT l'envoi et retirée quand l'écriture
// se termine. Rejouée au chargement suivant (`rejouerIntentionsEnAttente`).
// Pourquoi : la bascule est optimiste ; une page rechargée (ou l'app fermée)
// pendant l'écriture la perdait, et la seconde écriture d'une bascule rapide
// (sérialisée derrière la première) n'était même jamais envoyée. Purgé au
// changement de foyer (`reinitialiserCacheFoyer`, lib/sync.ts).
export const CLE_PREFERENCES_EN_ATTENTE = "preferences_en_attente"
type Intention = RecettePreference | "neutre"

function lireJournal(): Record<string, Intention> {
  if (typeof window === "undefined") return {} // serveur (MCP) : pas de journal
  try {
    return JSON.parse(localStorage.getItem(CLE_PREFERENCES_EN_ATTENTE) ?? "{}")
  } catch (erreur) {
    console.error("Journal des préférences illisible (ignoré).", erreur)
    return {}
  }
}

function majJournal(maj: (journal: Record<string, Intention>) => void): void {
  if (typeof window === "undefined") return
  const journal = lireJournal()
  maj(journal)
  try {
    if (Object.keys(journal).length === 0) localStorage.removeItem(CLE_PREFERENCES_EN_ATTENTE)
    else localStorage.setItem(CLE_PREFERENCES_EN_ATTENTE, JSON.stringify(journal))
  } catch (erreur) {
    console.error("Journal des préférences non enregistré.", erreur)
  }
}

// Page quittée (rechargement, fermeture) : une écriture qui échoue ensuite a
// été coupée par le navigateur, pas refusée ; son intention reste à rejouer.
let pageQuittee = false
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => (pageQuittee = true))
  window.addEventListener("pageshow", () => (pageQuittee = false))
}

// Rejoue les intentions d'une page précédente (aucune écriture en vol pour
// elles dans ce chargement). Leur échec est journalisé, la lecture suit.
function rejouerIntentionsEnAttente(): void {
  for (const [recetteId, intention] of Object.entries(lireJournal())) {
    if (ecrituresEnVol.has(recetteId)) continue
    definirPreference(recetteId, intention === "neutre" ? null : intention).catch((erreur) => {
      console.error("Préférence en attente non rejouée.", erreur)
    })
  }
}

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
  rejouerIntentionsEnAttente() // #404
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
  rejouerIntentionsEnAttente() // #404
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
  // Intention journalisée avant tout `await` (#404) : un rechargement
  // immédiat la retrouve.
  majJournal((journal) => {
    journal[recetteId] = preference ?? "neutre"
  })
  const precedente = ecrituresEnVol.get(recetteId) ?? Promise.resolve()
  const ecriture = precedente
    .catch(() => {}) // un échec précédent (déjà remonté à son appelant) ne bloque pas
    .then(() => ecrirePreference(recetteId, preference))
  ecrituresEnVol.set(recetteId, ecriture)
  // Fin de la DERNIÈRE écriture demandée pour la recette : l'intention est
  // retirée (confirmée, ou refusée et déjà remontée à l'écran), sauf échec
  // après que la page a été quittée (requête coupée : à rejouer).
  const terminer = (echec: boolean) => {
    if (ecrituresEnVol.get(recetteId) !== ecriture) return
    ecrituresEnVol.delete(recetteId)
    if (echec && pageQuittee) return
    majJournal((journal) => {
      delete journal[recetteId]
    })
  }
  ecriture.then(
    () => terminer(false),
    () => terminer(true)
  )
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
