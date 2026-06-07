// Badge de temps de préparation — partagé entre les cartes du planning
// et le sélecteur de recettes (US-06).
//
// Couleurs : rapide = vert (brand), normal = jaune, long = rouge.
// (La migration vers les tokens accent est suivie par l'issue #61.)

import type { TempsPreparation } from "@/types";

const STYLES: Record<TempsPreparation, string> = {
  rapide: "bg-brand-50 text-brand-700",
  normal: "bg-yellow-100 text-yellow-800",
  long: "bg-red-100 text-red-800",
};

const LIBELLES: Record<TempsPreparation, string> = {
  rapide: "Rapide",
  normal: "Normal",
  long: "Long",
};

export function BadgeTemps({ temps }: { temps: TempsPreparation }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[temps]}`}
    >
      {LIBELLES[temps]}
    </span>
  );
}
