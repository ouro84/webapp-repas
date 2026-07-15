// Pages légales (#235, US-29) — constantes CLIENT-SAFE (pas de node:fs ici :
// importé par app/signup/page.tsx, un Client Component — un import de
// node:fs/promises dans ce fichier casserait le bundle client, cf. la lecture
// du contenu Markdown dans lib/legal-fs.ts, réservée aux Server Components).

export type SlugLegal = "cgu" | "confidentialite" | "mentions-legales";

export const PAGES_LEGALES: { slug: SlugLegal; titre: string }[] = [
  { slug: "cgu", titre: "Conditions générales d'utilisation" },
  { slug: "confidentialite", titre: "Politique de confidentialité" },
  { slug: "mentions-legales", titre: "Mentions légales" },
];

// Version des CGU actuellement en vigueur (posée sur profiles.cgu_version au
// signup, #235). Une seule version existe : pas de comparateur ni de garde de
// re-consentement dans cette PR (YAGNI, cf. plan de session).
export const CGU_VERSION_ACTUELLE = 1;
