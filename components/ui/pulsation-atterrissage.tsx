// Pulsation d'atterrissage — « il est ICI maintenant ». Partagée par la liste
// de courses (RG-11 / RG-39 : article ou catégorie qui vient de se ranger) et
// le planning (#337 : carte d'aujourd'hui à la fin de la chorégraphie de
// génération).
//
// Pourquoi l'arrivée : les premiers utilisateurs croyaient qu'un article coché
// avait DISPARU (en magasin, on regarde son doigt, pas le trajet).
//
// Contraintes :
//   - un calque de couleur STATIQUE dont on anime l'opacité, jamais un
//     `background-color` animé (contrat transform/opacity-only, globals.css) ;
//   - un <div>, JAMAIS un <span> : e2e/courses.spec.ts cible
//     `li.last().locator("span").first()` pour vérifier le rayé ;
//   - la couleur passe par le token sémantique `--color-atterrissage`, qui a
//     sa propre valeur en sombre ;
//   - `opacity-0` de base : invisible pendant un éventuel `animationDelay`
//     (l'animation n'a pas de remplissage `backwards`).
// Pas de `motion-safe:` : l'appelant ne le monte pas sous reduced motion. Un
// `motion-safe:` en ferait au contraire un calque figé (jamais d'animationend).

export function PulsationAtterrissage({
  onFin,
  delaiMs = 0,
  className = "inset-0 rounded-lg",
}: {
  onFin: () => void;
  delaiMs?: number;
  /** Position et arrondi du calque (défaut : recouvre son parent `relative`). */
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      onAnimationEnd={onFin}
      style={delaiMs > 0 ? { animationDelay: `${delaiMs}ms` } : undefined}
      className={`pointer-events-none absolute bg-atterrissage opacity-0 animate-atterrissage ${className}`}
    />
  );
}
