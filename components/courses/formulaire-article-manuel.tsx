"use client";

// Bottom sheet d'ajout / édition d'un article manuel de la liste de courses
// (#216, US-47, RG-43/RG-43 bis). Même patron que SelecteurRecette (#98) :
// <dialog> natif ouvert en showModal(), bottom sheet mobile / modale centrée
// dès md, parade clavier virtuel iOS via useClavierVirtuel.
//
// Un seul composant sert à l'ajout ET à l'édition (RG-43 bis) : le parent
// fournit `initial` pré-rempli pour éditer, ou omis pour ajouter.

import { useEffect, useRef, useState } from "react";
import { useClavierVirtuel } from "@/lib/clavier";
import type { SaisieArticleManuel } from "@/lib/persistance";
import type { CategorieIngredient, Unite } from "@/types";

// Mêmes libellés que components/recettes/formulaire-recette.tsx (duplication
// volontaire : deux formulaires distincts, pas de couplage pour un détail de
// présentation — cf. convention du projet sur les petites constantes de select).
const UNITES: { valeur: Unite; libelle: string }[] = [
  { valeur: "piece", libelle: "pièce(s)" },
  { valeur: "g", libelle: "g" },
  { valeur: "kg", libelle: "kg" },
  { valeur: "ml", libelle: "ml" },
  { valeur: "cl", libelle: "cl" },
  { valeur: "l", libelle: "l" },
  { valeur: "cas", libelle: "c. à soupe" },
  { valeur: "cac", libelle: "c. à café" },
  { valeur: "briquette", libelle: "briquette(s)" },
  { valeur: "bouteille", libelle: "bouteille(s)" },
  { valeur: "boite", libelle: "boîte(s)" },
  { valeur: "sachet", libelle: "sachet(s)" },
  { valeur: "autre", libelle: "autre" },
];

const CATEGORIES: { valeur: CategorieIngredient; libelle: string }[] = [
  { valeur: "viandes-poissons", libelle: "Viandes & Poissons" },
  { valeur: "legumes-fruits", libelle: "Légumes & Fruits" },
  { valeur: "produits-frais", libelle: "Produits frais" },
  { valeur: "epicerie", libelle: "Épicerie" },
  { valeur: "boulangerie", libelle: "Boulangerie" },
  { valeur: "surgeles", libelle: "Surgelés" },
  { valeur: "autre", libelle: "Autre" },
];

export function FormulaireArticleManuel({
  titre,
  initial,
  onEnregistrer,
  onFermer,
}: {
  titre: string;
  /** Pré-remplissage en mode édition (RG-43 bis) — omis en mode ajout. */
  initial?: SaisieArticleManuel;
  onEnregistrer: (saisie: SaisieArticleManuel) => void;
  onFermer: () => void;
}) {
  const refDialog = useRef<HTMLDialogElement>(null);
  const [libelle, setLibelle] = useState(initial?.libelle ?? "");
  const [quantite, setQuantite] = useState(
    initial?.quantite != null ? String(initial.quantite) : ""
  );
  const [unite, setUnite] = useState<Unite | "">(initial?.unite ?? "");
  const [categorie, setCategorie] = useState<CategorieIngredient>(
    initial?.categorie ?? "autre"
  );
  const [fondDePlacard, setFondDePlacard] = useState(initial?.fondDePlacard ?? false);

  // Clavier mobile (#98, même parade que SelecteurRecette).
  const { hauteurClavier, hauteurVisible } = useClavierVirtuel();
  const styleClavier =
    hauteurClavier > 0
      ? {
          marginBottom: `${hauteurClavier}px`,
          maxHeight: `${Math.round(hauteurVisible * 0.92)}px`,
        }
      : undefined;

  useEffect(() => {
    refDialog.current?.showModal();
  }, []);

  function surClic(evenement: React.MouseEvent<HTMLDialogElement>): void {
    if (evenement.target === refDialog.current) {
      refDialog.current?.close();
    }
  }

  const libelleValide = libelle.trim().length > 0 && libelle.trim().length <= 200;

  function soumettre(evenement: React.FormEvent): void {
    evenement.preventDefault();
    if (!libelleValide) return;
    const quantiteNum = quantite.trim() === "" ? null : Number(quantite);
    onEnregistrer({
      libelle: libelle.trim(),
      quantite: quantiteNum !== null && Number.isFinite(quantiteNum) && quantiteNum > 0
        ? quantiteNum
        : null,
      unite: unite === "" ? null : unite,
      categorie,
      fondDePlacard,
    });
    refDialog.current?.close();
  }

  return (
    <dialog
      ref={refDialog}
      onClose={onFermer}
      onClick={surClic}
      aria-labelledby="titre-formulaire-article-manuel"
      style={styleClavier}
      className="fixed mx-auto mb-0 mt-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-surface p-0 text-brand-900 shadow-xl backdrop:bg-black/50 md:my-auto md:max-w-lg md:rounded-2xl"
    >
      <header className="flex items-center justify-between gap-3 border-b border-brand-100 p-4">
        <h2 id="titre-formulaire-article-manuel" className="text-lg font-bold text-brand-900">
          {titre}
        </h2>
        <button
          type="button"
          onClick={() => refDialog.current?.close()}
          aria-label="Fermer"
          className="relative flex size-8 items-center justify-center rounded-full text-brand-700 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
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

      <form onSubmit={soumettre} className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        <div>
          <label htmlFor="am-libelle" className="mb-1 block text-sm font-medium text-brand-700">
            Article
          </label>
          <input
            id="am-libelle"
            type="text"
            autoFocus
            required
            maxLength={200}
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Ex. Sacs poubelle"
            className="w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-sm text-brand-900 placeholder:text-brand-700/50 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="am-quantite" className="mb-1 block text-sm font-medium text-brand-700">
              Quantité (optionnel)
            </label>
            <input
              id="am-quantite"
              type="number"
              min="0"
              step="any"
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              className="w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="am-unite" className="mb-1 block text-sm font-medium text-brand-700">
              Unité
            </label>
            <select
              id="am-unite"
              value={unite}
              onChange={(e) => setUnite(e.target.value as Unite | "")}
              className="w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
            >
              <option value="">—</option>
              {UNITES.map((u) => (
                <option key={u.valeur} value={u.valeur}>
                  {u.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="am-categorie" className="mb-1 block text-sm font-medium text-brand-700">
            Catégorie
          </label>
          <select
            id="am-categorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value as CategorieIngredient)}
            className="w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          >
            {CATEGORIES.map((c) => (
              <option key={c.valeur} value={c.valeur}>
                {c.libelle}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={fondDePlacard}
            onChange={(e) => setFondDePlacard(e.target.checked)}
            className="size-4 shrink-0 cursor-pointer accent-brand-600"
          />
          <span className="text-sm text-brand-900">Fond de placard (à vérifier avant d’acheter)</span>
        </label>

        <button
          type="submit"
          disabled={!libelleValide}
          className="w-full rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Enregistrer
        </button>
      </form>
    </dialog>
  );
}
