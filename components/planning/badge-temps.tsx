// Badge de temps de préparation — partagé entre les cartes du planning
// et le sélecteur de recettes (US-06).
//
// Couleurs aux tokens du design system (#61) : rapide = vert brand,
// normal/long = terracotta accent (le rouge est réservé aux erreurs, cf.
// app/error.tsx). Le sens n'est jamais porté par la seule couleur (guideline
// color-not-only) : le libellé texte est toujours présent.
//
// Échelle de temps lisible d'un coup d'œil (#209, audit #51) : une horloge
// GRADUÉE renforce le libellé — rien sur « rapide », 1 sur « normal », 2 sur
// « long ». La couleur seule ne suffisait pas (normal/long partagent le
// terracotta) ; le nombre d'horloges encode la durée (et reste perceptible aux
// daltoniens). Icônes décoratives (aria-hidden) : le texte porte déjà le sens.

import type { TempsPreparation } from "@/types";

const STYLES: Record<TempsPreparation, string> = {
  rapide: "bg-brand-50 text-brand-700",
  normal: "bg-accent-50 text-accent-700",
  long: "bg-accent-100 text-accent-700",
};

const LIBELLES: Record<TempsPreparation, string> = {
  rapide: "Rapide",
  normal: "Normal",
  long: "Long",
};

export function BadgeTemps({ temps }: { temps: TempsPreparation }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[temps]}`}
    >
      {/* Horloge graduée (#209) : rien (rapide) / 1 (normal) / 2 (long).
          Regroupées serré (gap-px) pour se lire comme une jauge unique. */}
      {temps !== "rapide" && (
        <span className="inline-flex items-center gap-px" aria-hidden="true">
          <IconeHorloge />
          {temps === "long" && <IconeHorloge />}
        </span>
      )}
      {LIBELLES[temps]}
    </span>
  );
}

// Horloge — SVG inline (pas de glyphe ni de dépendance d'icônes, cf. audit #51).
function IconeHorloge() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
