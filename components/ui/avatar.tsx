// Avatar à initiales (#22 PR1, RG-35) — disque coloré portant l'initiale du
// prénom. Pas de photo (« zéro upload »). Réutilisé par la nav (taille sm) et la
// page /profil (taille lg).
//
// La couleur vient de profiles.couleur_avatar (dérivée de l'email par défaut,
// puis choisie par l'utilisateur). Le texte est blanc : les huit teintes de
// PALETTE_AVATAR sont des tons moyens/saturés → contraste suffisant en blanc.

import { initiale } from "@/lib/avatar";

const TAILLES = {
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-20 text-3xl",
} as const;

export function Avatar({
  prenom,
  couleur,
  taille = "md",
  className = "",
}: {
  prenom: string | null | undefined;
  /** Teinte hex (couleur_avatar). Repli sur le vert de marque si absente. */
  couleur: string | null | undefined;
  taille?: keyof typeof TAILLES;
  className?: string;
}) {
  return (
    <span
      // Décoratif : l'identité est portée par le texte voisin (prénom) ou
      // l'aria-label du lien parent (nav). aria-hidden évite la redite.
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${TAILLES[taille]} ${className}`}
      style={{ backgroundColor: couleur ?? "#3D7A44" }}
    >
      {initiale(prenom)}
    </span>
  );
}
