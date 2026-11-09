// Primitives de squelette de chargement (#400, RG-09).
//
// - Textes fixes = vrai texte ; données = `TexteSquelette` ; contrôles = `Squelette`.
// - La pulsation n'existe que sous `motion-safe:` : sous `prefers-reduced-motion`
//   les blocs restent statiques.
// - `ZoneChargement` annonce « Chargement… » une seule fois aux lecteurs d'écran
//   (`role="status"`) et masque tous les blocs (`aria-hidden`).
import type { ReactNode } from "react"

type Teinte = "fond" | "carte" | "placard"

// `bg-squelette` sur le fond de page, `bg-squelette-carte` dans une carte
// `bg-surface`, `bg-squelette-placard` dans la section « Fond de placard »
// (`bg-accent-50`) de /courses.
const TEINTE: Record<Teinte, string> = {
  fond: "bg-squelette",
  carte: "bg-squelette-carte",
  placard: "bg-squelette-placard",
}

// `rounded`, `rounded-<taille>` ou `rounded-[…]`, sans préfixe de variante.
const RAYON_TOUS_COINS = /(^|\s)rounded(-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full)|-\[[^\]\s]+\])?(?=\s|$)/

/** Bloc plein de la taille d'un contrôle ; l'appelant donne taille et forme via `className` (`rounded-md` par défaut). */
export function Squelette({ className = "", sur = "fond" }: { className?: string; sur?: Teinte }) {
  // Tailwind v4 émet les utilitaires de même propriété par ordre alphabétique :
  // `rounded-md` l'emporterait sur un `rounded-full` de l'appelant. On ne pose
  // donc le rayon par défaut que si l'appelant donne un rayon tous coins ; un
  // rayon partiel (`rounded-t-lg`, `rounded-s-full`…) garde `rounded-md` ailleurs.
  const rayon = RAYON_TOUS_COINS.test(className) ? "" : "rounded-md "
  return (
    <span
      className={`block ${rayon}${TEINTE[sur]} motion-safe:animate-pulse ${className}`.trim()}
    />
  )
}

/**
 * Barre au gabarit exact d'un texte de donnée : `children` est un texte factice
 * de longueur plausible, rendu transparent, donc la barre a la métrique du texte
 * qu'elle remplace (pas de CLS au remplacement).
 */
export function TexteSquelette({ children, sur = "fond" }: { children: string; sur?: Teinte }) {
  return (
    <span
      className={`rounded-md ${TEINTE[sur]} text-transparent select-none box-decoration-clone motion-safe:animate-pulse`}
    >
      {children}
    </span>
  )
}

/** Zone en chargement : une seule annonce vocale, blocs masqués aux lecteurs d'écran. */
export function ZoneChargement({
  children,
  className,
  as: Balise = "div",
}: {
  children: ReactNode
  className?: string
  // Pas de `li` : `role="status"` y écraserait la sémantique listitem.
  as?: "div" | "section"
}) {
  return (
    <Balise role="status" className={className}>
      <span className="sr-only">Chargement…</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </Balise>
  )
}
