"use client";

// Navigateur de période unique (#352) : stepper ‹ [libellé relatif + dates] ›
// partagé par la vue Semaine, la vue Cycle et /courses. Purement présentatif :
// l'appelant calcule libellé, dates, bornes et gère la navigation (US-14, #5).
//
// Rendu après hydratation uniquement côté appelants (le libellé relatif dépend
// de la date du client).
//
// Focus conservé au remontage (#352) : quand la navigation fait passer d'une
// période remplie à une vide (ou l'inverse), l'appelant démonte l'en-tête et
// monte l'état vide ; le navigateur est remonté ailleurs et la flèche cliquée
// perd le focus. La flèche activée est donc retenue (`flecheEnAttente`), si elle
// a pris le focus au clic et tant qu'elle le garde ; le navigateur de même unité
// qui se monte dans le même rendu le lui rend, si le focus est retombé sur
// <body> (jamais de vol de focus).

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type UnitePeriode = "semaine" | "cycle";

type Sens = "precedente" | "suivante";

// État module (navigateur) : une seule flèche activée à la fois dans la page.
let flecheEnAttente: { unite: UnitePeriode; sens: Sens } | null = null;

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
  const refPrecedente = useRef<HTMLButtonElement>(null);
  const refSuivante = useRef<HTMLButtonElement>(null);

  // Montage : rend le focus à la flèche activée sur le navigateur démonté.
  useEffect(() => {
    const attente = flecheEnAttente;
    if (attente !== null && attente.unite === unite) {
      flecheEnAttente = null;
      const actif = document.activeElement;
      if (actif === null || actif === document.body) {
        const cible = attente.sens === "precedente" ? refPrecedente.current : refSuivante.current;
        cible?.focus();
      }
    }
    // Démontage : le remontage rempli ↔ vide a lieu dans le même rendu, ses
    // effets passent avant cette microtâche. Si aucun navigateur ne l'a reprise
    // d'ici là (changement de page, flèche désactivée à une borne qui a perdu le
    // focus sans `blur`), l'attente est effacée : jamais de vol de focus au
    // retour sur la page.
    return () => {
      queueMicrotask(() => {
        if (flecheEnAttente?.unite === unite) flecheEnAttente = null;
      });
    };
  }, [unite]);

  // Retenue seulement si la flèche a pris le focus : Safari (macOS, iOS) et
  // Firefox macOS ne focalisent pas un bouton au clic, il n'y a alors rien à
  // rendre (et aucun `blur` ne viendrait effacer l'attente).
  function activer(sens: Sens, action: () => void, bouton: HTMLButtonElement): void {
    flecheEnAttente = document.activeElement === bouton ? { unite, sens } : null;
    action();
  }

  // Le focus quitte la flèche par un geste de l'utilisateur : plus rien à rendre.
  // Vérifié après coup : un `blur` émis par le retrait du bouton du DOM (remontage)
  // ne doit pas effacer l'attente.
  function surBlur(bouton: HTMLButtonElement): void {
    queueMicrotask(() => {
      if (bouton.isConnected && flecheEnAttente?.unite === unite) flecheEnAttente = null;
    });
  }

  return (
    <div
      role="group"
      aria-label={textes.groupe}
      className="inline-flex items-center gap-2"
    >
      <button
        type="button"
        ref={refPrecedente}
        onClick={(e) => activer("precedente", onPrecedente, e.currentTarget)}
        onBlur={(e) => surBlur(e.currentTarget)}
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
        ref={refSuivante}
        onClick={(e) => activer("suivante", onSuivante, e.currentTarget)}
        onBlur={(e) => surBlur(e.currentTarget)}
        disabled={disabled || !peutAvancer}
        aria-label={textes.suivante}
        className={STYLE_FLECHE}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
