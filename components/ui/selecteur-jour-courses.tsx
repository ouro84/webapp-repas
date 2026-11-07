"use client";

// Sélecteur du jour de courses (#386, US-23, RG-90/RG-91) : ancre du cycle de
// courses non calendaire (#257). Partagé par /profil (PanneauFoyer) et l'écran
// « Tu fais tes courses quel jour ? » du tunnel /bienvenue. Présentatif : la
// persistance (et son toast) reste à l'appelant via onChange.

// Jours ISO (1 = lundi … 7 = dimanche). La lettre affichée peut se répéter
// (mardi/mercredi = « M ») ; aria-label/title portent le nom complet distinct.
export const JOURS_SEMAINE = [
  { valeur: 1, lettre: "L", nom: "lundi" },
  { valeur: 2, lettre: "M", nom: "mardi" },
  { valeur: 3, lettre: "M", nom: "mercredi" },
  { valeur: 4, lettre: "J", nom: "jeudi" },
  { valeur: 5, lettre: "V", nom: "vendredi" },
  { valeur: 6, lettre: "S", nom: "samedi" },
  { valeur: 7, lettre: "D", nom: "dimanche" },
] as const;

export function SelecteurJourCourses({
  valeur,
  onChange,
  desactive = false,
  libelle,
}: {
  valeur: number | null;
  onChange: (jour: number, nom: string) => void;
  desactive?: boolean;
  libelle?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={libelle ?? "Jour de courses"}
      className="inline-flex rounded-full border border-brand-200 bg-surface p-0.5"
    >
      {JOURS_SEMAINE.map((jour) => {
        const actif = valeur === jour.valeur;
        return (
          <button
            key={jour.valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            aria-label={jour.nom}
            title={jour.nom}
            disabled={desactive}
            onClick={() => onChange(jour.valeur, jour.nom)}
            className={`min-w-9 rounded-full px-3 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-95 motion-reduce:active:scale-100 ${
              actif
                ? "bg-primary text-white"
                : "text-brand-700 hover:bg-brand-50"
            }`}
          >
            {jour.lettre}
          </button>
        );
      })}
    </div>
  );
}
