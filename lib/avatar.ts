// Avatar à initiales (#22 PR1, RG-35) — cœur PUR, sans réseau ni React.
//
// Choix produit : « zéro upload ». Pas de photo, pas de dépendance externe
// (pas de DiceBear) → un disque coloré portant l'initiale du prénom. La couleur
// par DÉFAUT est dérivée d'un hash de l'email (déterministe : un même email
// retombe toujours sur la même teinte), puis l'utilisateur peut la remplacer
// par l'une des huit teintes de la charte depuis /profil.
//
// La couleur est calculée UNE fois et stockée (profiles.couleur_avatar) ; ce
// module ne fait que la dériver et fournir la palette. L'initiale, elle, se
// recalcule à l'affichage à partir du prénom.

// Palette fixe de l'avatar (RG-35) — huit teintes de la charte (brand vert +
// accent terracotta + un éventail froid/chaud pour distinguer les membres d'un
// foyer). Valeurs hex stockables telles quelles dans couleur_avatar.
export const PALETTE_AVATAR = [
  "#3D7A44", // brand (vert signature)
  "#C2683E", // accent (terracotta)
  "#4A7C9E", // bleu ardoise
  "#8A5A9E", // prune
  "#B0843A", // ocre
  "#3E8E8E", // sarcelle
  "#9E4A5E", // grenat
  "#5E7A3E", // olive
] as const;

export type CouleurAvatar = (typeof PALETTE_AVATAR)[number];

// Couleur par défaut si aucune ne peut être dérivée (email vide). Première de
// la palette = vert de marque.
const COULEUR_DEFAUT = PALETTE_AVATAR[0];

/**
 * Initiale affichée dans l'avatar : première lettre du prénom, en majuscule.
 * Ignore les espaces de tête. Renvoie "?" si le prénom est vide/absent (état
 * transitoire avant la fin de l'onboarding).
 */
export function initiale(prenom: string | null | undefined): string {
  const premier = (prenom ?? "").trim()[0];
  return premier ? premier.toLocaleUpperCase("fr-FR") : "?";
}

/**
 * Teinte par défaut dérivée de l'email (déterministe). Hash simple (djb2) replié
 * sur l'index de la palette : un même email retombe toujours sur la même
 * couleur, et les emails distincts se répartissent sur les huit teintes.
 */
export function couleurAvatar(email: string | null | undefined): CouleurAvatar {
  const cle = (email ?? "").trim().toLocaleLowerCase("fr-FR");
  if (!cle) return COULEUR_DEFAUT;
  // djb2 : hash entier stable, sans Math.random (déterminisme requis).
  let hash = 5381;
  for (let i = 0; i < cle.length; i++) {
    hash = (hash * 33 + cle.charCodeAt(i)) >>> 0;
  }
  return PALETTE_AVATAR[hash % PALETTE_AVATAR.length];
}

/**
 * Valide qu'une chaîne fait partie de la palette (garde-fou avant écriture en
 * base : la couleur n'est jamais saisie librement, seulement choisie). Renvoie
 * la couleur si valide, sinon `null`.
 */
export function couleurValide(
  valeur: string | null | undefined
): CouleurAvatar | null {
  return (PALETTE_AVATAR as readonly string[]).includes(valeur ?? "")
    ? (valeur as CouleurAvatar)
    : null;
}
