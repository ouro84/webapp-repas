"use client"

// Coches d'ingrédients « sorti du placard » sur /ce-soir (#336, RG-89).
//
// Aide-mémoire PERSONNEL et éphémère : localStorage uniquement, jamais poussé
// en base ni partagé avec le foyer (≠ coches de la liste de courses, RG-12,
// synchronisées). Une seule clé `coches_repas` = { cle du repas, ids cochés } :
// tant que le repas affiché garde la même clé (date + créneau), les coches
// survivent au rechargement ; dès qu'il change (repas suivant), la lecture
// renvoie « rien de coché » et la première coche écrase l'ancien contenu —
// remise à zéro sans purge explicite.

import { useCallback, useMemo, useSyncExternalStore } from "react"
import { creerStoreJSON } from "@/lib/stockage"
import type { Ingredient } from "@/types"
import type { TypeRepas } from "@/lib/prochain-repas"

export type CochesRepas = { cle: string; ids: string[] }

const CLE_COCHES_REPAS = "coches_repas"

/** Identité d'un repas : jour + créneau (une régénération garde la même clé). */
export function cleRepas(dateISO: string, typeRepas: TypeRepas): string {
  return `${dateISO}|${typeRepas}`
}

/** Identité d'un ingrédient dans une recette : même clé nom|unité que RG-12. */
export function idIngredient(ingredient: Pick<Ingredient, "nom" | "unite">): string {
  return `${ingredient.nom}|${ingredient.unite}`
}

/** Ids cochés pour CE repas ; vide si l'état stocké concerne un autre repas
 *  ou est illisible (donnée corrompue / format antérieur). */
export function cochesPour(etat: CochesRepas | null, cle: string): ReadonlySet<string> {
  if (!etat || etat.cle !== cle || !Array.isArray(etat.ids)) return new Set()
  return new Set(etat.ids.filter((id): id is string => typeof id === "string"))
}

/** Coche ou décoche `id` pour le repas `cle` ; un état d'un autre repas est
 *  remplacé (remise à zéro au repas suivant). */
export function basculerCoche(etat: CochesRepas | null, cle: string, id: string): CochesRepas {
  const ids = new Set(cochesPour(etat, cle))
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { cle, ids: [...ids] }
}

const storeCochesRepas = creerStoreJSON<CochesRepas>(CLE_COCHES_REPAS)

/** Coches du repas `cle` + bascule. Snapshot serveur `null` → rien de coché
 *  au prérendu, puis hydratation (cf. .claude/rules/next-react.md). */
export function useCochesRepas(cle: string): {
  coches: ReadonlySet<string>
  basculer: (id: string) => void
} {
  const etat = useSyncExternalStore(
    storeCochesRepas.sAbonner,
    storeCochesRepas.lire,
    storeCochesRepas.lireServeur
  )
  const coches = useMemo(() => cochesPour(etat, cle), [etat, cle])
  const basculer = useCallback(
    (id: string) => {
      try {
        storeCochesRepas.ecrire(basculerCoche(storeCochesRepas.lire(), cle, id))
      } catch (erreur) {
        // Quota / mode privé : l'aide-mémoire est best-effort, on ne casse pas la page.
        console.error("Enregistrement de la coche d'ingrédient impossible.", erreur)
      }
    },
    [cle]
  )
  return { coches, basculer }
}
