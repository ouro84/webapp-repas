// Clavier virtuel mobile (#98) — expose la hauteur occultée par le clavier
// logiciel via l'API visualViewport, branchée dans React par useSyncExternalStore.
//
// Pourquoi ce hook EN PLUS du viewport `interactive-widget=resizes-content`
// (app/layout.tsx) ? Ce dernier corrige Android/Chrome, mais iOS/Safari
// n'implémente pas `interactive-widget` : le clavier y recouvre la page sans
// réduire le viewport de layout, donc un bottom sheet ancré en bas (`dvh`)
// passe derrière le clavier. visualViewport, lui, reflète la zone réellement
// visible sur les deux plateformes — on s'en sert pour soulever et borner le
// sélecteur au-dessus du clavier.
//
// Côté serveur (prérendu), pas de visualViewport : snapshot constant {0,0},
// donc aucun style appliqué tant qu'on n'est pas hydraté (pas de mismatch SSR).

import { useSyncExternalStore } from "react"

export type EtatClavier = {
  /** Hauteur (px) occultée par le clavier en bas du viewport (0 = fermé). */
  hauteurClavier: number
  /** Hauteur (px) réellement visible (visualViewport.height). */
  hauteurVisible: number
}

// Snapshot serveur (et navigateurs sans visualViewport) : référence stable
// exigée par useSyncExternalStore — ne jamais recréer cet objet.
const ETAT_INACTIF: EtatClavier = { hauteurClavier: 0, hauteurVisible: 0 }

// Cache du dernier snapshot : getSnapshot doit renvoyer une référence stable
// tant que les valeurs ne changent pas, sinon React boucle.
let cache: EtatClavier = ETAT_INACTIF

/**
 * Hauteur (px) occultée en bas par le clavier, fonction pure et testable.
 * `offsetTop` est soustrait car le navigateur peut « paner » le visual
 * viewport quand un champ prend le focus (le contenu défile sous le clavier).
 * Jamais négatif.
 */
export function hauteurOccultee(
  innerHeight: number,
  hauteurVisuelle: number,
  offsetTop: number
): number {
  return Math.max(0, innerHeight - hauteurVisuelle - offsetTop)
}

function calculer(): EtatClavier {
  const vv = window.visualViewport
  if (!vv) return ETAT_INACTIF

  const hauteurClavier = hauteurOccultee(
    window.innerHeight,
    vv.height,
    vv.offsetTop
  )
  const hauteurVisible = vv.height

  if (
    hauteurClavier !== cache.hauteurClavier ||
    hauteurVisible !== cache.hauteurVisible
  ) {
    cache = { hauteurClavier, hauteurVisible }
  }
  return cache
}

function sAbonner(rappel: () => void): () => void {
  const vv = window.visualViewport
  // resize : ouverture/fermeture du clavier ; scroll : panoramique du viewport.
  vv?.addEventListener("resize", rappel)
  vv?.addEventListener("scroll", rappel)
  window.addEventListener("resize", rappel)
  return () => {
    vv?.removeEventListener("resize", rappel)
    vv?.removeEventListener("scroll", rappel)
    window.removeEventListener("resize", rappel)
  }
}

/**
 * Géométrie du clavier virtuel. Renvoie `{0, 0}` au rendu serveur, avant
 * hydratation et quand le clavier est fermé — l'appelant n'applique alors
 * aucun ajustement (comportement par défaut inchangé).
 */
export function useClavierVirtuel(): EtatClavier {
  return useSyncExternalStore(sAbonner, calculer, () => ETAT_INACTIF)
}
