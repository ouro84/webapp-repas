// Aperçu décoratif du planning — hero d'accueil (#68, P16).
//
// Montre la « promesse produit » : une mini-grille de 3 cartes repas qui
// reprend EXACTEMENT le langage visuel des vraies cartes du planning
// (rounded-lg border-brand-100 bg-surface shadow-sm, label jour, nom de plat,
// badges) et réutilise `BadgeTemps` / `BadgeVegetarien` pour rester cohérent
// et profiter de la palette accent (#67 : Normal/Long en terracotta).
//
// 100 % décoratif : données factices, aucun élément interactif (le nom est un
// simple texte, pas un bouton comme dans le vrai planning). Le conteneur est
// `aria-hidden` — les lecteurs d'écran s'appuient sur le h1 + la tagline, pas
// sur ces faux plats. Pas d'animation ici : les micro-interactions sont #69.

import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import type { TempsPreparation } from "@/types";

type CarteApercu = {
  jour: string;
  plat: string;
  temps: TempsPreparation;
  vegetarien?: boolean;
};

// Trois repas plausibles, variés pour faire respirer les badges (rapide / vert
// brand, normal+végé, long / terracotta accent).
const CARTES: CarteApercu[] = [
  { jour: "Lundi", plat: "Pâtes au pesto", temps: "rapide" },
  { jour: "Mardi", plat: "Curry de légumes", temps: "normal", vegetarien: true },
  { jour: "Mercredi", plat: "Saumon rôti", temps: "long" },
];

export function ApercuPlanning({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`grid w-full max-w-lg grid-cols-3 gap-2 sm:gap-3 ${className ?? ""}`}
    >
      {CARTES.map((carte) => (
        <div
          key={carte.jour}
          className="flex flex-col gap-1.5 rounded-lg border border-brand-100 bg-surface p-2.5 shadow-sm sm:p-3"
        >
          <p className="text-[0.65rem] font-medium uppercase tracking-wide text-brand-700/85">
            {carte.jour}
          </p>
          <p className="text-xs font-medium leading-snug text-brand-900 sm:text-sm">
            {carte.plat}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            <BadgeTemps temps={carte.temps} />
            {carte.vegetarien && <BadgeVegetarien compact />}
          </div>
        </div>
      ))}
    </div>
  );
}
