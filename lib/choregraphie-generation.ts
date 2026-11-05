// Chorégraphie de génération du planning (#337) — cœur pur (minutage, jour
// d'atterrissage), testable sans navigateur. La mise en scène vit dans
// app/planning/page.tsx et app/globals.css.
//
// Séquence (≈ 720 ms pour 7 jours) :
//   attente   → n'apparaît que si la réponse dépasse SEUIL_ATTENTE_MS ;
//   arrivée   → jour i entre à i × DELAI_STAGGER_JOUR_MS (280 ms, translateY 8 px
//               + opacité), son nom de plat fond DECALAGE_NOM_MS plus tard ;
//   atterrissage → sur la carte d'aujourd'hui, une fois le dernier nom posé,
//               puis le toast.

import { jourDeDate } from "@/lib/prochain-repas"
import { semaineISO } from "@/lib/semaines"
import type { Jour } from "@/types"

/** En deçà, la réponse est jugée instantanée : pas de phase d'attente visible. */
export const SEUIL_ATTENTE_MS = 300
export const DELAI_STAGGER_JOUR_MS = 60
export const DECALAGE_NOM_MS = 80
/** Durée du fondu d'un nom de plat (token `--animate-crossfade`). */
export const DUREE_CROSSFADE_NOM_MS = 220
/** Filet si `animationend` ne vient pas (onglet masqué) : toast quand même. */
export const FILET_ATTERRISSAGE_MS = 2500

/** Délai d'entrée du jour d'indice `i`. */
export function delaiJour(i: number): number {
  return i * DELAI_STAGGER_JOUR_MS
}

/** Délai du fondu du nom de plat du jour d'indice `i`. */
export function delaiNom(i: number): number {
  return delaiJour(i) + DECALAGE_NOM_MS
}

/** Départ de l'atterrissage : quand le nom du dernier jour a fini de fondre. */
export function delaiAtterrissage(nbJours: number): number {
  if (nbJours <= 0) return 0
  return delaiNom(nbJours - 1) + DUREE_CROSSFADE_NOM_MS
}

/**
 * Jour sur lequel atterrir : aujourd'hui, si la semaine générée est la semaine
 * courante et que ce jour est affiché ; sinon `null` (pas d'atterrissage, le
 * toast part tout de suite).
 */
export function jourAtterrissage(
  semaineGeneree: string,
  joursAffiches: Jour[],
  maintenant: Date
): Jour | null {
  if (semaineGeneree !== semaineISO(maintenant)) return null
  const jour = jourDeDate(maintenant)
  return joursAffiches.includes(jour) ? jour : null
}
