// Badge / icône « végétarien » (#86, P10). Icône lucide (règle no-emoji-icons).
//
// - `compact` : icône seule (card du planning) — porte un aria-label car elle
//   véhicule l'information à elle seule.
// - défaut : pastille icône + texte « Végétarien » (fiche, liste de recettes) —
//   l'icône est décorative (aria-hidden), le texte porte le sens.

import { Leaf } from "lucide-react";

export function BadgeVegetarien({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Leaf
        className="size-4 shrink-0 text-brand-600"
        role="img"
        aria-label="Végétarien"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
      <Leaf className="size-3.5" aria-hidden="true" />
      Végétarien
    </span>
  );
}
