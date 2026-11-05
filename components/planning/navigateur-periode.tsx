// Navigateur de période unique (#352) : stepper ‹ [libellé relatif + dates] ›
// partagé par la vue Semaine, la vue Cycle et /courses. Purement présentatif :
// l'appelant calcule libellé, dates, bornes et gère la navigation (US-14, #5).
//
// Rendu après hydratation uniquement côté appelants (le libellé relatif dépend
// de la date du client).

import { ChevronLeft, ChevronRight } from "lucide-react";

export type UnitePeriode = "semaine" | "cycle";

const LIBELLES: Record<
  UnitePeriode,
  { groupe: string; precedente: string; suivante: string }
> = {
  semaine: {
    groupe: "Naviguer entre les semaines",
    precedente: "Semaine précédente",
    suivante: "Semaine suivante",
  },
  cycle: {
    groupe: "Naviguer entre les cycles",
    precedente: "Cycle précédent",
    suivante: "Cycle suivant",
  },
};

const STYLE_FLECHE =
  "relative flex size-8 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function NavigateurPeriode({
  unite,
  libelle,
  dates,
  courante,
  peutReculer,
  peutAvancer,
  onPrecedente,
  onSuivante,
  disabled,
}: {
  unite: UnitePeriode;
  libelle: string; // position relative : « Cette semaine », « Ce cycle »…
  dates: string; // plage de dates : « du 5 au 14 novembre »
  courante: boolean; // période courante (offset 0) : marquée visuellement
  peutReculer: boolean;
  peutAvancer: boolean;
  onPrecedente: () => void;
  onSuivante: () => void;
  disabled?: boolean;
}) {
  const textes = LIBELLES[unite];
  return (
    <div
      role="group"
      aria-label={textes.groupe}
      className="inline-flex items-center gap-2"
    >
      <button
        type="button"
        onClick={onPrecedente}
        disabled={disabled || !peutReculer}
        aria-label={textes.precedente}
        className={STYLE_FLECHE}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      {/* Période courante marquée (RG) : fond brand + texte accentué. */}
      <span
        aria-live="polite"
        data-courante={courante ? "" : undefined}
        className={`min-w-[11rem] rounded-lg px-3 py-1 text-center ${courante ? "bg-brand-50" : ""}`}
      >
        <span
          className={`block text-sm font-medium ${courante ? "text-brand-700" : "text-brand-900"}`}
        >
          {libelle}
        </span>
        {/* Espace explicite : le texte brut (lecteurs d'écran, copie, e2e) lit
            « Ce cycle du 5 au 14 novembre » et non « Ce cycledu… ». */}
        {" "}
        <span className="block text-xs text-brand-700/85">{dates}</span>
      </span>
      <button
        type="button"
        onClick={onSuivante}
        disabled={disabled || !peutAvancer}
        aria-label={textes.suivante}
        className={STYLE_FLECHE}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
