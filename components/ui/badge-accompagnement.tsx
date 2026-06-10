// Badge / icône « accompagnement » (#49, P11). Icônes lucide (règle
// no-emoji-icons). Deux variantes de couleur du design system pour distinguer
// d'un coup d'œil : féculents = terracotta (palette accent, icône épi de blé),
// légumes = vert (palette brand, icône carotte).
//
// - `compact` : icône seule (card du planning) — porte un aria-label car elle
//   véhicule l'information à elle seule.
// - défaut : pastille icône + texte — l'icône est décorative (aria-hidden), le
//   texte porte le sens.

import { Carrot, Wheat } from "lucide-react";
import type { Accompagnement } from "@/types";

const CONFIG: Record<
  Accompagnement,
  {
    Icone: typeof Wheat;
    libelle: string;
    couleurIcone: string;
    pastille: string;
  }
> = {
  feculents: {
    Icone: Wheat,
    libelle: "Féculents",
    couleurIcone: "text-accent-600",
    pastille: "bg-accent-50 text-accent-700",
  },
  legumes: {
    Icone: Carrot,
    libelle: "Légumes",
    couleurIcone: "text-brand-600",
    pastille: "bg-brand-50 text-brand-700",
  },
};

export function BadgeAccompagnement({
  accompagnement,
  compact = false,
}: {
  accompagnement: Accompagnement;
  compact?: boolean;
}) {
  const { Icone, libelle, couleurIcone, pastille } = CONFIG[accompagnement];
  if (compact) {
    return (
      <Icone
        className={`size-4 shrink-0 ${couleurIcone}`}
        role="img"
        aria-label={libelle}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pastille}`}
    >
      <Icone className="size-3.5" aria-hidden="true" />
      {libelle}
    </span>
  );
}
