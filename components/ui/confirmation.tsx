"use client";

// Modale de confirmation générique (#5) — garde-fou avant une action sur un
// planning passé (régénérer / modifier un slot, RG-24). <dialog> natif en
// showModal() : focus piégé, Échap, backdrop et restitution du focus fournis
// par la plateforme (même motif que SelecteurRecette).
//
// Montée uniquement pendant la confirmation : ouverture au montage, fermeture
// remontée via onAnnuler ; onConfirmer ferme aussi (le parent démonte).

import { useEffect, useRef } from "react";

export function ConfirmationModale({
  titre,
  message,
  libelleConfirmer = "Confirmer",
  onConfirmer,
  onAnnuler,
}: {
  titre: string;
  message: string;
  libelleConfirmer?: string;
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
      aria-labelledby="titre-confirmation"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-brand-900 shadow-xl backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="titre-confirmation" className="text-lg font-bold text-brand-900">
          {titre}
        </h2>
        <p className="text-sm text-brand-700/85">{message}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => refDialog.current?.close()}
            className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            {libelleConfirmer}
          </button>
        </div>
      </div>
    </dialog>
  );
}
