"use client";

// Fiche d'identité d'une recette — consultation depuis le planning (US-10).
//
// Élément <dialog> natif ouvert en showModal() : focus piégé, fermeture Échap,
// backdrop et restitution du focus au déclencheur sont fournis par la
// plateforme (même pattern que SelecteurRecette). Le composant n'est monté que
// pendant la consultation : l'ouverture se fait au montage, la fermeture
// remonte via onClose.
//
// La recette vient du slot du planning (déjà en localStorage) — AUCUN appel
// réseau. Le corps (badges, ingrédients mis à l'échelle, étapes) est partagé
// avec la page /ce-soir via ContenuRecette (#336).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BadgesRecette, ContenuRecette } from "@/components/planning/contenu-recette";
import { TogglePreferenceRecette } from "@/components/ui/toggle-preference-recette";
import { chargerPreference, definirPreference } from "@/lib/preferences";
import type { RecettePreference } from "@/lib/generateur";
import type { Recette } from "@/types";

export function FicheRecette({
  recette,
  personnes,
  modifiable,
  onFermer,
}: {
  recette: Recette;
  personnes: number;
  /**
   * La recette est présente dans le catalogue chargé (perso OU par défaut non
   * masquée) → un raccourci « Modifier » est proposé (RG-20, #137). Faux pour
   * une recette hors-base (fixture injectée) ou masquée encore présente dans un
   * planning persisté → pas de raccourci (évite un lien mort vers
   * `/recettes?edition=<id>`).
   */
  modifiable: boolean;
  onFermer: () => void;
}) {
  const refDialog = useRef<HTMLDialogElement>(null);

  // Favoris/évités du foyer (#219, RG-58/63) : chargés pour CETTE recette
  // (consultation isolée) au montage — `null` tant que non chargé/neutre, les
  // deux cas rendent le toggle inactif de façon identique (RG-59, jamais
  // bloquant, pas d'état de chargement visible nécessaire ici).
  const [preference, setPreference] = useState<RecettePreference | null>(null);
  // Garde anti-course : si l'utilisateur clique AVANT que le chargement initial
  // ne réponde, la réponse tardive ne doit pas écraser son choix optimiste (bug
  // constaté en e2e — la fiche s'ouvre, un clic immédiat sur le toggle pouvait
  // être effacé par le `setPreference(p)` du chargement, arrivé après coup).
  const modifieRef = useRef(false);
  useEffect(() => {
    modifieRef.current = false;
    let actif = true;
    chargerPreference(recette.id)
      .then((p) => {
        if (actif && !modifieRef.current) setPreference(p);
      })
      .catch((erreur) => {
        console.error("Chargement de la préférence échoué.", erreur);
      });
    return () => {
      actif = false;
    };
  }, [recette.id]);

  function surChangementPreference(nouvelle: RecettePreference | null): void {
    modifieRef.current = true;
    const precedente = preference;
    setPreference(nouvelle); // optimiste
    definirPreference(recette.id, nouvelle).catch((erreur) => {
      console.error("Mise à jour de la préférence échouée.", erreur);
      setPreference(precedente); // repli
      toast.error("Impossible de mettre à jour la préférence. Réessaie.");
    });
  }

  // Ouverture au montage : le parent ne monte ce composant que pendant la
  // consultation. Pas de setState ici — showModal est un effet DOM pur.
  useEffect(() => {
    refDialog.current?.showModal();
  }, []);

  // Clic sur le backdrop : la cible est alors l'élément <dialog> lui-même.
  function surClic(evenement: React.MouseEvent<HTMLDialogElement>): void {
    if (evenement.target === refDialog.current) {
      refDialog.current?.close();
    }
  }

  return (
    <dialog
      ref={refDialog}
      onClose={onFermer}
      onClick={surClic}
      aria-labelledby="titre-fiche"
      className="fixed mx-auto mb-0 mt-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-surface p-0 text-brand-900 shadow-xl backdrop:bg-black/50 md:my-auto md:max-w-lg md:rounded-2xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-brand-100 p-4">
        <div className="min-w-0">
          <h2 id="titre-fiche" className="text-lg font-bold text-brand-900">
            {recette.nom}
          </h2>
          <BadgesRecette recette={recette} personnes={personnes} />
        </div>
        <TogglePreferenceRecette
          preference={preference}
          onChange={surChangementPreference}
        />
        <button
          type="button"
          onClick={() => refDialog.current?.close()}
          aria-label="Fermer la fiche"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-brand-700 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {/* Croix SVG inline — pas de glyphe texte (audit #51) */}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        <ContenuRecette recette={recette} personnes={personnes} />
      </div>

      {/* Raccourci d'édition (RG-20, #137) : proposé pour toute recette du
          catalogue chargé (perso ou par défaut). Sur une recette par défaut,
          l'édition créera une copie perso + masquera l'originale (#105 PR2). */}
      {modifiable && (
        <footer className="border-t border-brand-100 p-4">
          <Link
            href={`/recettes?edition=${recette.id}`}
            className="inline-flex items-center rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Modifier la recette
          </Link>
        </footer>
      )}
    </dialog>
  );
}
