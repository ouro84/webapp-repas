// Logique PURE de synchronisation des coches par-article (#56 PR4, US-20).
//
// La liste de courses reste représentée localement par un BLOB
// `Record<"nom|unité", quantité>` (cf. lib/coches.ts, localStorage
// "courses_cochees") — ni la page ni lib/coches.ts ne changent. Côté base, en
// revanche, chaque article est une LIGNE (#56 PR4) : pour synchroniser sans
// s'écraser entre membres (RG-32), on ne pousse plus le blob entier mais des
// OPÉRATIONS par-article, dérivées par DIFF entre l'état déjà synchronisé et le
// nouvel état local. En sens inverse, les events temps réel reçus des autres
// membres sont fusionnés dans le blob.
//
// Aucune dépendance à React, au navigateur ni à Supabase : testable en isolation.

import type { Coches } from "@/lib/coches"

/** Opération par-article à appliquer côté base (dérivée d'un diff de blobs). */
export type OpCoche =
  | { type: "cocher"; cle: string; quantite: number }
  | { type: "decocher"; cle: string }

/**
 * Dérive les opérations par-article entre l'état déjà synchronisé (`connu`) et
 * le nouvel état local (`nouveau`) :
 *  - clé ajoutée ou dont la quantité a changé (RG-12) → `cocher`,
 *  - clé disparue → `decocher`.
 * L'ordre est déterministe (ajouts/maj d'abord, puis retraits) pour des tests
 * stables ; l'ordre d'application en base est sans incidence (clés distinctes).
 */
export function deriverOps(connu: Coches, nouveau: Coches): OpCoche[] {
  const ops: OpCoche[] = []
  for (const [cle, quantite] of Object.entries(nouveau)) {
    if (connu[cle] !== quantite) ops.push({ type: "cocher", cle, quantite })
  }
  for (const cle of Object.keys(connu)) {
    if (!(cle in nouveau)) ops.push({ type: "decocher", cle })
  }
  return ops
}

/** Event temps réel normalisé (issu d'un payload Supabase postgres_changes). */
export type EventCoche =
  | { type: "upsert"; cle: string; quantite: number }
  | { type: "supprime"; cle: string }

/**
 * Applique un event temps réel à un blob (immuable) : `upsert` pose la
 * quantité, `supprime` retire la clé. Idempotent — recevoir l'écho de sa propre
 * écriture ne change rien (même valeur) et ne doit donc générer aucune nouvelle
 * opération en aval.
 */
export function appliquerEvent(blob: Coches, event: EventCoche): Coches {
  if (event.type === "supprime") {
    if (!(event.cle in blob)) return blob
    const suivant = { ...blob }
    delete suivant[event.cle]
    return suivant
  }
  if (blob[event.cle] === event.quantite) return blob
  return { ...blob, [event.cle]: event.quantite }
}
