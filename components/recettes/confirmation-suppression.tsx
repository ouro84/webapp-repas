"use client";

// Confirmation de suppression d'une recette (#2 PR3, RG-01) — la suppression
// est définitive, on demande confirmation. Garde-fou : si la recette est dans
// le planning courant, on prévient que le planning/la liste de courses ne
// seront plus à jour tant qu'elle n'est pas remplacée.
//
// <dialog> natif en showModal() : focus piégé, Échap, backdrop et restitution
// du focus fournis par la plateforme (cf. sélecteur de recette).

import { useEffect, useRef } from "react";

export function ConfirmationSuppression({
  nom,
  dansPlanning,
  enCours,
  onConfirmer,
  onAnnuler,
}: {
  nom: string;
  dansPlanning: boolean;
  enCours: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  const refDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    refDialog.current?.showModal();
  }, []);

  function surClic(evenement: React.MouseEvent<HTMLDialogElement>): void {
    if (evenement.target === refDialog.current) refDialog.current?.close();
  }

  return (
    <dialog
      ref={refDialog}
      onClose={onAnnuler}
      onClick={surClic}
      aria-labelledby="titre-suppression"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-0 text-brand-900 shadow-xl backdrop:bg-brand-900/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="titre-suppression" className="text-lg font-bold text-brand-900">
          Supprimer cette recette ?
        </h2>
        <p className="text-sm text-brand-700/85">
          «&nbsp;{nom}&nbsp;» sera définitivement supprimée. Cette action est
          irréversible.
        </p>
        {dansPlanning && (
          <p
            role="alert"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            Cette recette est dans ton planning de la semaine : il restera
            affiché, mais une régénération ne pourra plus la proposer.
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => refDialog.current?.close()}
            disabled={enCours}
            className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            disabled={enCours}
            aria-busy={enCours}
            className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
          >
            {enCours ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
