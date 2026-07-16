// Badge / icône « saison » (#23, P12). Icônes lucide (règle no-emoji-icons).
// Style OUTLINE (bordure, fond blanc) pour se distinguer des badges pleins
// végétarien (vert) et accompagnement (vert/terracotta) — une recette peut
// porter les trois.
//
// Une recette peut avoir plusieurs saisons (RG-01) : on affiche une icône par
// saison.
// - `compact` : icônes seules (card du planning), chacune avec un aria-label.
// - défaut : pastille outline icônes + libellés (« Automne · Hiver »).

import { Flower2, Snowflake, Sun, TreeDeciduous } from "lucide-react";
import type { Saison } from "@/types";
import { LIBELLE_SAISON, SAISONS } from "@/lib/saisons";

// Automne = TreeDeciduous, PAS Leaf (audit critique, #23/#86) : Leaf est déjà
// l'icône compacte de BadgeVegetarien (même taille, même couleur brand-600) —
// une recette végétarienne ET de saison automnale affichait deux pastilles
// visuellement identiques côte à côte, indiscernables sans lire l'aria-label.
const ICONE: Record<Saison, typeof Sun> = {
  printemps: Flower2,
  ete: Sun,
  automne: TreeDeciduous,
  hiver: Snowflake,
};

export function BadgeSaison({
  saisons,
  compact = false,
}: {
  saisons: Saison[];
  compact?: boolean;
}) {
  // Affichage dans l'ordre canonique des saisons, filtré sur celles de la recette.
  const ordonnees = SAISONS.filter((s) => saisons.includes(s));
  if (ordonnees.length === 0) return null;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {ordonnees.map((s) => {
          const Icone = ICONE[s];
          return (
            <Icone
              key={s}
              className="size-4 shrink-0 text-brand-600"
              role="img"
              aria-label={`De saison : ${LIBELLE_SAISON[s].toLowerCase()}`}
            />
          );
        })}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-surface px-2 py-0.5 text-xs font-medium text-brand-700">
      {ordonnees.map((s) => {
        const Icone = ICONE[s];
        return <Icone key={s} className="size-3.5 text-brand-600" aria-hidden="true" />;
      })}
      {ordonnees.map((s) => LIBELLE_SAISON[s]).join(" · ")}
    </span>
  );
}
