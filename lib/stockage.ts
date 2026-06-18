// Mini-stores localStorage — source de vérité de la persistance locale
// (SPECS section 5.6), branchés dans React via useSyncExternalStore.
//
// Pourquoi un store et pas un simple localStorage.setItem ?
// L'événement natif "storage" ne se déclenche que dans les AUTRES onglets :
// chaque store maintient donc un Set d'abonnés notifiés manuellement à
// chaque écriture pour rafraîchir l'onglet courant. Écrire dans localStorage
// sans passer par ces fonctions = UI qui ne se rafraîchit pas.
//
// Côté serveur, le snapshot vaut null : les pages sont prérendues en état
// vide/chargement, puis hydratées avec les valeurs réelles.

import type { Planning } from "@/types"

type StoreLocal = {
  sAbonner: (rappel: () => void) => () => void
  lire: () => string | null
  lireServeur: () => null
  ecrire: (valeur: string) => void
  effacer: () => void
}

function creerStoreLocal(cle: string): StoreLocal {
  // Abonnés du même onglet, notifiés manuellement (cf. en-tête de fichier).
  const abonnes = new Set<() => void>()

  function notifier(): void {
    for (const rappel of abonnes) rappel()
  }

  return {
    sAbonner(rappel: () => void): () => void {
      abonnes.add(rappel)
      window.addEventListener("storage", rappel) // modifications des autres onglets
      return () => {
        abonnes.delete(rappel)
        window.removeEventListener("storage", rappel)
      }
    },
    lire(): string | null {
      // localStorage peut lever (mode privé strict Safari/ITP) — on dégrade en
      // « pas de cache » plutôt que de casser le rendu (#170).
      try {
        return localStorage.getItem(cle)
      } catch (erreur) {
        console.error(`localStorage indisponible (lecture "${cle}").`, erreur)
        return null
      }
    },
    // Pas de localStorage côté serveur : prérendu en état vide.
    lireServeur(): null {
      return null
    },
    ecrire(valeur: string): void {
      // setItem peut lever (quota dépassé, mode privé) : le cache local est
      // best-effort (la base reste la source de vérité, #6) → on ne bloque pas
      // l'app, mais on notifie quand même les abonnés de l'intention (#170).
      try {
        localStorage.setItem(cle, valeur)
      } catch (erreur) {
        console.error(`localStorage indisponible (écriture "${cle}").`, erreur)
      }
      notifier()
    },
    effacer(): void {
      try {
        localStorage.removeItem(cle)
      } catch (erreur) {
        console.error(`localStorage indisponible (effacement "${cle}").`, erreur)
      }
      notifier()
    },
  }
}

// ============================================================================
// Stores de l'application
// ============================================================================

/** Planning courant (SPECS 5.6, clé `planning_courant`). */
export const storePlanning = creerStoreLocal("planning_courant")

/** Coches de la liste de courses (US-05, RG-12, clé `courses_cochees`). */
export const storeCoches = creerStoreLocal("courses_cochees")

// ============================================================================
// Écritures métier — le cycle de vie des coches (RG-13) est centralisé ici
// pour ne pas disperser la règle dans les pages.
// ============================================================================

/**
 * Génération complète d'un planning : écrase la sauvegarde ET réinitialise
 * toutes les coches de la liste de courses (RG-13 — nouvelles courses).
 */
export function sauvegarderPlanningComplet(planning: Planning): void {
  storePlanning.ecrire(JSON.stringify(planning))
  storeCoches.effacer()
}

/**
 * Remplacement d'un slot (US-04) : écrase la sauvegarde SANS toucher aux
 * coches — l'invalidation par quantité (RG-12) protège les articles dont
 * l'agrégat a changé.
 */
export function sauvegarderRemplacementSlot(planning: Planning): void {
  storePlanning.ecrire(JSON.stringify(planning))
}

// ============================================================================
// Annulation (US-09, RG-19) — snapshot mono-niveau du planning ET des coches.
//
// Pourquoi figer AUSSI les coches ? Une régénération efface les coches
// (sauvegarderPlanningComplet → RG-13) : restaurer le seul planning laisserait
// les coches perdues, l'undo ne serait pas « à l'identique ». La restauration
// réécrit donc les deux clés directement (sans repasser par
// sauvegarderPlanningComplet, qui ré-effacerait les coches qu'on veut rendre).
// ============================================================================

/** Clé localStorage du snapshot d'annulation (SPECS 5.6). */
const CLE_SNAPSHOT = "planning_snapshot"

/** Fenêtre d'undo : marge au-dessus des ~5 s du toast (RG-19). */
const FENETRE_UNDO_MS = 6000

type SnapshotAnnulation = {
  planning: string // valeur de planning_courant figée
  coches: string | null // valeur de courses_cochees figée (null si aucune)
  horodatage: number
}

/**
 * Fige l'état courant (planning + coches) avant une action destructive
 * (RG-19). À appeler juste AVANT sauvegarderPlanningComplet /
 * sauvegarderRemplacementSlot. Ne capture rien s'il n'existe pas de planning
 * (première génération : rien à annuler — RG-19).
 */
export function capturerSnapshotAnnulation(
  maintenant: number = Date.now()
): void {
  const planning = storePlanning.lire()
  if (planning === null) return
  const snapshot: SnapshotAnnulation = {
    planning,
    coches: storeCoches.lire(),
    horodatage: maintenant,
  }
  localStorage.setItem(CLE_SNAPSHOT, JSON.stringify(snapshot))
}

/**
 * Restaure le dernier snapshot (US-09) : réécrit planning ET coches à
 * l'identique — inverse l'effacement RG-13. Un snapshot expiré (au-delà de
 * la fenêtre d'undo, RG-19) est purgé sans restauration. Renvoie true si une
 * restauration a effectivement eu lieu.
 */
export function restaurerSnapshotAnnulation(
  maintenant: number = Date.now()
): boolean {
  const brut = localStorage.getItem(CLE_SNAPSHOT)
  if (brut === null) return false

  let snapshot: SnapshotAnnulation
  try {
    snapshot = JSON.parse(brut) as SnapshotAnnulation
  } catch (erreur) {
    // Donnée corrompue : on la purge et on signale (jamais de catch muet).
    console.error(`localStorage["${CLE_SNAPSHOT}"] illisible.`, erreur)
    localStorage.removeItem(CLE_SNAPSHOT)
    return false
  }

  // Snapshot expiré : on le purge sans restaurer (RG-19).
  if (maintenant - snapshot.horodatage > FENETRE_UNDO_MS) {
    localStorage.removeItem(CLE_SNAPSHOT)
    return false
  }

  storePlanning.ecrire(snapshot.planning)
  if (snapshot.coches === null) {
    storeCoches.effacer()
  } else {
    storeCoches.ecrire(snapshot.coches)
  }
  localStorage.removeItem(CLE_SNAPSHOT)
  return true
}
