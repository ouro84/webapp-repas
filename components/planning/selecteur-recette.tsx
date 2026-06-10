"use client";

// Sélecteur de recette — choix manuel pour un slot du planning (US-06, RG-15).
//
// Élément <dialog> natif ouvert en showModal() : focus piégé, fermeture
// Échap, backdrop et restitution du focus au bouton déclencheur sont fournis
// par la plateforme. Le composant n'est monté que pendant la sélection —
// l'ouverture se fait au montage, la fermeture remonte via onClose.
//
// Mobile-first : bottom sheet (collé en bas, coins hauts arrondis) ;
// à partir de md, modale centrée. Champ de recherche en tête (filtrage
// insensible à la casse et aux accents, cf. lib/recherche.ts) : avec un
// vivier qui grandit, pas de scroll interminable.
//
// Les recettes arrivent en prop (chargées depuis Supabase via lib/recettes.ts,
// catalogue global + recettes de l'utilisateur) — le composant ne change pas
// quand le CRUD perso arrive (#2, PR2/3).

import { useEffect, useMemo, useRef, useState } from "react";
import { filtrerRecettes } from "@/lib/recherche";
import { useClavierVirtuel } from "@/lib/clavier";
import { BadgeTemps } from "@/components/planning/badge-temps";
import type { Recette } from "@/types";

export function SelecteurRecette({
  titre,
  recettes,
  idsAuPlanning,
  onSelectionner,
  onRestes,
  onFermer,
}: {
  titre: string;
  recettes: Recette[];
  /** Badge « déjà au planning » (RG-15) — le doublon reste permis. */
  idsAuPlanning: ReadonlySet<string>;
  onSelectionner: (recette: Recette) => void;
  /** Marquer le slot en « restes » (US-12) — option proposée en tête. */
  onRestes?: () => void;
  onFermer: () => void;
}) {
  const refDialog = useRef<HTMLDialogElement>(null);
  const [requete, setRequete] = useState("");

  // Clavier mobile (#98) : sur iOS (où `interactive-widget` n'est pas
  // implémenté) le clavier recouvre le bas du viewport. On soulève le sheet
  // au-dessus du clavier et on borne sa hauteur à la zone visible pour que les
  // résultats restent atteignables. Clavier fermé / desktop / SSR → {0,0},
  // aucun style inline (on retombe sur le `max-h-[85dvh]` du className).
  const { hauteurClavier, hauteurVisible } = useClavierVirtuel();
  const styleClavier =
    hauteurClavier > 0
      ? {
          marginBottom: `${hauteurClavier}px`,
          maxHeight: `${Math.round(hauteurVisible * 0.92)}px`,
        }
      : undefined;

  // Liste alphabétique stable (US-06) — l'ordre du JSON n'est pas garanti.
  const triees = useMemo(
    () =>
      [...recettes].sort((a, b) =>
        a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" })
      ),
    [recettes]
  );
  const visibles = filtrerRecettes(triees, requete);

  // Ouverture au montage : le parent ne monte ce composant que pendant la
  // sélection. Pas de setState ici — showModal est un effet DOM pur.
  useEffect(() => {
    refDialog.current?.showModal();
  }, []);

  // Clic sur le backdrop : l'événement cible alors l'élément <dialog>
  // lui-même (le panneau intérieur intercepte les clics sur le contenu).
  function surClic(evenement: React.MouseEvent<HTMLDialogElement>): void {
    if (evenement.target === refDialog.current) {
      refDialog.current?.close();
    }
  }

  function choisir(recette: Recette): void {
    onSelectionner(recette);
    // close() déclenche onClose → onFermer → démontage par le parent,
    // avec restitution native du focus au bouton « Sélectionner » d'origine.
    refDialog.current?.close();
  }

  function choisirRestes(): void {
    onRestes?.();
    refDialog.current?.close();
  }

  return (
    <dialog
      ref={refDialog}
      onClose={onFermer}
      onClick={surClic}
      aria-labelledby="titre-selecteur"
      style={styleClavier}
      className="fixed mx-auto mb-0 mt-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-white p-0 text-brand-900 shadow-xl backdrop:bg-brand-900/50 md:my-auto md:max-w-lg md:rounded-2xl"
    >
      <header className="flex items-center justify-between gap-3 border-b border-brand-100 p-4">
        <h2 id="titre-selecteur" className="text-lg font-bold text-brand-900">
          {titre}
        </h2>
        <button
          type="button"
          onClick={() => refDialog.current?.close()}
          aria-label="Fermer le sélecteur"
          className="relative flex size-8 items-center justify-center rounded-full text-brand-700 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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

      <div className="border-b border-brand-100 p-4">
        <label htmlFor="recherche-recette" className="sr-only">
          Rechercher une recette
        </label>
        <input
          id="recherche-recette"
          type="search"
          // autoFocus : le champ de recherche est l'action attendue à
          // l'ouverture — c'est le premier focusable du dialog de toute façon.
          autoFocus
          value={requete}
          onChange={(evenement) => setRequete(evenement.target.value)}
          placeholder="Rechercher une recette…"
          className="w-full rounded-full border border-brand-200 bg-white px-4 py-2.5 text-sm text-brand-900 placeholder:text-brand-700/50 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
        />
        {/* Annonce du nombre de résultats aux lecteurs d'écran */}
        <p aria-live="polite" className="sr-only">
          {visibles.length} recette{visibles.length > 1 ? "s" : ""}
        </p>

        {/* Option « Restes » (US-12) : ne pas cuisiner ce repas. Hors liste de
            recettes (toujours visible, non filtrée par la recherche). */}
        {onRestes && (
          <button
            type="button"
            onClick={choisirRestes}
            className="mt-3 flex w-full items-center gap-2 rounded-full border border-dashed border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12h16M6 12a6 6 0 0 0 12 0M9 3c-.6 1-.6 2 0 3M13 3c-.6 1-.6 2 0 3" />
            </svg>
            Restes (je ne cuisine pas)
          </button>
        )}
      </div>

      {/* État vide de la recherche (RG-09 : tout écran gère son état vide) */}
      {visibles.length === 0 ? (
        <p className="p-8 text-center text-sm text-brand-700/85">
          Aucune recette ne correspond à «&nbsp;{requete.trim()}&nbsp;»
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-brand-100 overflow-y-auto overscroll-contain">
          {visibles.map((recette) => {
            const dejaPresente = idsAuPlanning.has(recette.id);
            return (
              <li key={recette.id}>
                <button
                  type="button"
                  onClick={() => choisir(recette)}
                  className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-brand-50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <span className="flex-1 text-sm font-medium text-brand-900">
                    {recette.nom}
                  </span>
                  {/* Doublon éclairé (RG-15) : signalé, jamais bloqué */}
                  {dejaPresente && (
                    <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">
                      déjà au planning
                    </span>
                  )}
                  <BadgeTemps temps={recette.tempsPreparation} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </dialog>
  );
}
