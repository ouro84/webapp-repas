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
      return localStorage.getItem(cle)
    },
    // Pas de localStorage côté serveur : prérendu en état vide.
    lireServeur(): null {
      return null
    },
    ecrire(valeur: string): void {
      localStorage.setItem(cle, valeur)
      notifier()
    },
    effacer(): void {
      localStorage.removeItem(cle)
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
