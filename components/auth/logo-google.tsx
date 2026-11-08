// Éléments visuels partagés des boutons Google (US-57) : « Continuer avec
// Google » (/login, /signup) et « Confirmer avec Google » (/profil, D10).
//
// Aucun import de police ici : la police Roboto (charte Google) reste limitée
// au bouton de connexion, qui l'applique lui-même (cf. `ui.md`).

/**
 * Classes communes des boutons Google : couleurs de la charte par thème
 * (tokens --color-google-*), forme, focus et retour tactile. L'appelant ajoute
 * le padding, l'alignement et la police. Désactivé (redirection en cours) :
 * curseur d'attente sans baisse d'opacité, le spinner porte le signal visuel
 * et garde ainsi le contraste du texte dans les deux thèmes.
 */
export const CLASSES_BOUTON_GOOGLE =
  "flex items-center justify-center gap-3 rounded-full border border-google-bordure bg-google-fond text-sm font-medium text-google-texte transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-wait disabled:active:scale-100"

// Logo « G » officiel de Google (4 tracés aux couleurs de la charte) — SVG
// inline, masqué aux lecteurs d'écran (le libellé du bouton porte le nom).
export function LogoGoogle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

// Spinner d'un bouton Google en redirection (aria-busy porte déjà
// l'information) ; `currentColor` = texte Google du thème courant.
export function SpinnerGoogle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 animate-spin" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
