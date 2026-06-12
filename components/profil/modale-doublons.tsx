"use client";

// Modale de dé-doublonnage assisté (#56 PR3, bonus dédup) — affichée APRÈS une
// jonction de foyer si la fusion des catalogues (RG-33) a produit des recettes
// de même nom. Nettoyage GUIDÉ, jamais imposé : l'utilisateur supprime ce qu'il
// veut et peut fermer à tout moment (« Plus tard »). RG-33 conserve les
// collisions ; ce module ne fait que faciliter le tri manuel laissé au CRUD.
//
// <dialog> natif en showModal() (même motif que ConfirmationModale /
// SelecteurRecette) : focus piégé, Échap, backdrop fournis par la plateforme.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { GroupeDoublon } from "@/lib/doublons";
import type { Recette } from "@/types";

const LIBELLE_TEMPS = { rapide: "Rapide", normal: "Normal", long: "Long" } as const;

export function ModaleDoublons({
  groupes,
  onSupprimer,
  onFermer,
}: {
  groupes: GroupeDoublon[];
  // Supprime une recette du catalogue (le parent choisit suppression réelle
  // pour une recette du foyer, masquage pour une globale). Rejette en cas
  // d'échec → la ligne reste affichée.
  onSupprimer: (recette: Recette) => Promise<void>;
  onFermer: () => void;
}) {
  const refDialog = useRef<HTMLDialogElement>(null);
  // Copie locale mutable : on retire les recettes au fil des suppressions.
  const [groupesLocaux, setGroupesLocaux] = useState(groupes);
  const [enCours, setEnCours] = useState<string | null>(null);

  useEffect(() => {
    refDialog.current?.showModal();
  }, []);

  function surClic(evenement: React.MouseEvent<HTMLDialogElement>): void {
    if (evenement.target === refDialog.current) refDialog.current?.close();
  }

  async function supprimer(recette: Recette): Promise<void> {
    setEnCours(recette.id);
    try {
      await onSupprimer(recette);
      setGroupesLocaux((gs) =>
        gs.map((g) => ({
          ...g,
          recettes: g.recettes.filter((r) => r.id !== recette.id),
        }))
      );
      toast.success(`« ${recette.nom} » supprimée`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setEnCours(null);
    }
  }

  // Un groupe est résolu quand il ne reste qu'une recette (plus de collision).
  const restants = groupesLocaux.filter((g) => g.recettes.length > 1);

  return (
    <dialog
      ref={refDialog}
      onClose={onFermer}
      onClick={surClic}
      aria-labelledby="titre-doublons"
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-brand-900 shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="border-b border-brand-100 p-6 pb-4">
          <h2 id="titre-doublons" className="text-lg font-bold text-brand-900">
            Recettes en double
          </h2>
          <p className="mt-1 text-sm text-brand-700/85">
            La fusion des catalogues a réuni des recettes de même nom. Supprime
            celles que tu ne veux pas garder — ou laisse tel quel, tu pourras
            faire le tri plus tard.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {restants.length === 0 ? (
            <p role="status" className="text-sm text-brand-700/85">
              Plus aucun doublon. Tout est en ordre&nbsp;!
            </p>
          ) : (
            <ul className="flex flex-col gap-5">
              {restants.map((groupe) => (
                <li key={normaliserCle(groupe)}>
                  <p className="mb-2 text-sm font-semibold text-brand-900">
                    {groupe.nom}
                    <span className="ml-1 font-normal text-brand-700/70">
                      ({groupe.recettes.length})
                    </span>
                  </p>
                  <ul className="flex flex-col gap-2">
                    {groupe.recettes.map((recette) => (
                      <li
                        key={recette.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 px-3 py-2"
                      >
                        <span className="min-w-0 text-sm text-brand-700">
                          <span className="block truncate">{recette.nom}</span>
                          <span className="text-xs text-brand-700/60">
                            {LIBELLE_TEMPS[recette.tempsPreparation]} ·{" "}
                            {recette.ingredients.length} ingrédient
                            {recette.ingredients.length > 1 ? "s" : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => supprimer(recette)}
                          disabled={enCours !== null}
                          className="shrink-0 rounded-full border border-danger px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.95] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {enCours === recette.id ? "…" : "Supprimer"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-brand-100 p-4">
          <button
            type="button"
            onClick={() => refDialog.current?.close()}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            {restants.length === 0 ? "Terminé" : "Plus tard"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Clé stable d'un groupe pour React (le nom normalisé suffit : un seul groupe
// par nom normalisé par construction de detecterDoublons).
function normaliserCle(groupe: GroupeDoublon): string {
  return groupe.recettes[0]?.id ?? groupe.nom;
}
