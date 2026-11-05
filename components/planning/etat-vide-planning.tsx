// État vide partagé des vues Semaine et Cycle de /planning (#352, RG-09).
// Reprend le hero de la vitrine (#337) : logo, baseline, aperçu (qui « respire »
// pendant la génération), avec la bascule Semaine | Cycle et le navigateur de
// période. Le bouton principal génère la période affichée (semaine ou cycle).
// Rechargement (`chargement`, navigation entre cycles) : seul le corps (aperçu +
// message + bouton) est estompé et `aria-busy`, comme le cycle rempli n'estompe
// que sa grille ; titre, bascule et navigateur restent nets.

import type { ReactNode } from "react";
import { ApercuPlanning } from "@/components/ui/apercu-planning";
import { Logo } from "@/components/ui/logo";
import { BasculeVue, type VuePlanning } from "@/components/planning/entete-planning";

export function EtatVidePlanning({
  titre,
  vue,
  onChangerVue,
  navigateur,
  enAttente,
  message,
  libelleBouton,
  libelleAttente,
  onGenerer,
  generationEnCours,
  chargement = false,
}: {
  titre: string;
  vue: VuePlanning;
  onChangerVue: (v: VuePlanning) => void;
  // Navigateur de période (#5, #352) ; absent avant hydratation.
  navigateur?: ReactNode;
  // Attente visible de la génération (#337) : libellé d'attente + aperçu qui respire.
  enAttente: boolean;
  message: string;
  libelleBouton: string;
  libelleAttente: string;
  onGenerer: () => void;
  generationEnCours: boolean;
  // Rechargement de la période (#352) : corps estompé, toujours cliquable.
  chargement?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center text-center">
        <Logo className="mb-5 size-20 text-brand-600" />
        <h1 className="font-display text-3xl font-semibold text-brand-900">{titre}</h1>
        <p className="mt-3 max-w-sm text-brand-700/85">
          La question du soir a enfin sa réponse
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        {/* Bascule Semaine | Cycle (#260) : accessible même sans planning, pour
            consulter l'autre vue. */}
        <BasculeVue vue={vue} onChange={onChangerVue} />
        {navigateur}
      </div>
      <div
        aria-busy={chargement}
        className={`flex flex-col items-center gap-8 transition-opacity duration-200 ${chargement ? "opacity-50" : ""}`}
      >
        <ApercuPlanning enAttente={enAttente} />
        <div className="flex flex-col items-center gap-4">
          <p className="text-brand-700/85">{message}</p>
          <button
            type="button"
            onClick={onGenerer}
            disabled={generationEnCours}
            aria-busy={generationEnCours}
            className="rounded-full bg-primary px-8 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
          >
            {enAttente ? libelleAttente : libelleBouton}
          </button>
        </div>
      </div>
    </div>
  );
}
