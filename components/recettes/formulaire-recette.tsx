"use client";

// Formulaire de création / édition d'une recette personnelle (#2, PR2).
//
// RG-02 : rien n'est enregistré tant que l'utilisateur n'a pas cliqué
// « Enregistrer ». Validation avant envoi : nom non vide, au moins un
// ingrédient, quantités strictement positives. Aux couleurs du design system.

import { useId, useState } from "react";
import type {
  Accompagnement,
  CategorieIngredient,
  Ingredient,
  Saison,
  TempsPreparation,
  Unite,
} from "@/types";
import type { SaisieRecette } from "@/lib/recettes";
import { suggererAccompagnement } from "@/lib/accompagnement";
import { LIBELLE_SAISON, SAISONS, suggererSaisons } from "@/lib/saisons";

// Options des selects (côté saisie : toutes les valeurs du domaine).
const TEMPS: { valeur: TempsPreparation; libelle: string }[] = [
  { valeur: "rapide", libelle: "Rapide (< 20 min)" },
  { valeur: "normal", libelle: "Normal (20–45 min)" },
  { valeur: "long", libelle: "Long (> 45 min)" },
];

// Options du select accompagnement (#49) : "" = aucun (non caractérisé).
const ACCOMPAGNEMENTS: { valeur: Accompagnement | ""; libelle: string }[] = [
  { valeur: "", libelle: "Aucun / non précisé" },
  { valeur: "feculents", libelle: "Féculents" },
  { valeur: "legumes", libelle: "Légumes" },
];

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

// Ligne d'ingrédient en cours de saisie : quantité en texte pour un contrôle
// d'input propre, convertie en nombre à l'enregistrement.
type LigneSaisie = {
  nom: string;
  quantite: string;
  unite: Unite;
  categorie: CategorieIngredient;
  fondDePlacard: boolean;
};

function ligneVide(): LigneSaisie {
  return {
    nom: "",
    quantite: "",
    unite: "piece",
    categorie: "legumes-fruits",
    fondDePlacard: false,
  };
}

function ingredientVersLigne(ing: Ingredient): LigneSaisie {
  return {
    nom: ing.nom,
    quantite: String(ing.quantite),
    unite: ing.unite,
    categorie: ing.categorie,
    fondDePlacard: ing.fondDePlacard,
  };
}

const INPUT =
  "rounded-lg border border-brand-200 bg-surface px-3 py-2 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600";

export function FormulaireRecette({
  valeurInitiale,
  titre,
  onEnregistrer,
  onAnnuler,
}: {
  /** Recette à éditer ; absent = création. */
  valeurInitiale?: {
    nom: string;
    tempsPreparation: TempsPreparation;
    vegetarien?: boolean;
    accompagnement?: Accompagnement;
    saisons?: Saison[];
    ingredients: Ingredient[];
  };
  titre: string;
  onEnregistrer: (saisie: SaisieRecette) => Promise<void>;
  onAnnuler: () => void;
}) {
  const [nom, setNom] = useState(valeurInitiale?.nom ?? "");
  const [temps, setTemps] = useState<TempsPreparation>(
    valeurInitiale?.tempsPreparation ?? "rapide"
  );
  const [lignes, setLignes] = useState<LigneSaisie[]>(
    valeurInitiale ? valeurInitiale.ingredients.map(ingredientVersLigne) : [ligneVide()]
  );
  // Flag végétarien (#86). Pré-cochage heuristique (B3) à la CRÉATION : tant
  // que l'utilisateur n'y a pas touché, on suit la suggestion « aucun ingrédient
  // viande/poisson ». À l'édition, on respecte la valeur enregistrée (figée).
  const [vegetarien, setVegetarien] = useState(valeurInitiale?.vegetarien ?? false);
  const [vegeTouche, setVegeTouche] = useState(valeurInitiale !== undefined);
  // Accompagnement (#49). Même mécanique de pré-cochage heuristique (Bonus B)
  // que le végé : tant que l'utilisateur n'y a pas touché (création), on suit la
  // suggestion par nom d'ingrédient ; à l'édition, on respecte la valeur figée.
  const [accompagnement, setAccompagnement] = useState<Accompagnement | "">(
    valeurInitiale?.accompagnement ?? ""
  );
  const [accompTouche, setAccompTouche] = useState(valeurInitiale !== undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const idErreur = useId();

  const suggestionVege = lignes.every((l) => l.categorie !== "viandes-poissons");
  const vegeEffectif = vegeTouche ? vegetarien : suggestionVege;

  const suggestionAccomp = suggererAccompagnement(lignes) ?? "";
  const accompEffectif = accompTouche ? accompagnement : suggestionAccomp;

  // Saisons (#23). Même mécanique de pré-suggestion : tant que l'utilisateur n'y
  // a pas touché (création), on suit la suggestion dérivée des ingrédients
  // (intersection des saisons des produits) ; à l'édition, on respecte la valeur
  // figée. Vide = toute l'année.
  const [saisons, setSaisons] = useState<Saison[]>(valeurInitiale?.saisons ?? []);
  const [saisonsTouche, setSaisonsTouche] = useState(valeurInitiale !== undefined);
  const suggestionSaisons = suggererSaisons(lignes);
  const saisonsEffectif = saisonsTouche ? saisons : suggestionSaisons;

  function basculerSaison(s: Saison): void {
    setSaisonsTouche(true);
    setSaisons(
      saisonsEffectif.includes(s)
        ? saisonsEffectif.filter((x) => x !== s)
        : [...saisonsEffectif, s]
    );
  }

  function majLigne(index: number, champ: Partial<LigneSaisie>): void {
    setLignes((courantes) =>
      courantes.map((l, i) => (i === index ? { ...l, ...champ } : l))
    );
  }

  function ajouterLigne(): void {
    setLignes((courantes) => [...courantes, ligneVide()]);
  }

  function retirerLigne(index: number): void {
    setLignes((courantes) => courantes.filter((_, i) => i !== index));
  }

  // Valide et convertit la saisie ; retourne null + message si invalide.
  function valider(): SaisieRecette | string {
    if (nom.trim() === "") return "Donne un nom à la recette.";
    if (lignes.length === 0) return "Ajoute au moins un ingrédient.";

    const ingredients: Ingredient[] = [];
    for (const l of lignes) {
      if (l.nom.trim() === "") return "Chaque ingrédient doit avoir un nom.";
      const quantite = Number(l.quantite.replace(",", "."));
      if (!Number.isFinite(quantite) || quantite <= 0) {
        return `Quantité invalide pour « ${l.nom.trim()} ».`;
      }
      ingredients.push({
        nom: l.nom.trim(),
        quantite,
        unite: l.unite,
        categorie: l.categorie,
        fondDePlacard: l.fondDePlacard,
      });
    }
    return {
      nom: nom.trim(),
      tempsPreparation: temps,
      vegetarien: vegeEffectif,
      accompagnement: accompEffectif === "" ? null : accompEffectif,
      saisons: saisonsEffectif,
      ingredients,
    };
  }

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    const resultat = valider();
    if (typeof resultat === "string") {
      setErreur(resultat);
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      await onEnregistrer(resultat);
    } catch (e) {
      setErreur(
        e instanceof Error ? e.message : "Enregistrement impossible. Réessaie."
      );
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-semibold text-brand-900">{titre}</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="nom-recette" className="text-sm font-medium text-brand-900">
          Nom de la recette
        </label>
        <input
          id="nom-recette"
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          className={INPUT}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="temps-recette" className="text-sm font-medium text-brand-900">
          Temps de préparation
        </label>
        <select
          id="temps-recette"
          value={temps}
          onChange={(e) => setTemps(e.target.value as TempsPreparation)}
          className={`${INPUT} cursor-pointer`}
        >
          {TEMPS.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.libelle}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-brand-900">
        <input
          type="checkbox"
          checked={vegeEffectif}
          onChange={(e) => {
            setVegeTouche(true);
            setVegetarien(e.target.checked);
          }}
          className="size-4 cursor-pointer accent-brand-600"
        />
        Recette végétarienne
      </label>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="accompagnement-recette"
          className="text-sm font-medium text-brand-900"
        >
          Accompagnement
        </label>
        <select
          id="accompagnement-recette"
          value={accompEffectif}
          onChange={(e) => {
            setAccompTouche(true);
            setAccompagnement(e.target.value as Accompagnement | "");
          }}
          className={`${INPUT} cursor-pointer`}
        >
          {ACCOMPAGNEMENTS.map((a) => (
            <option key={a.valeur} value={a.valeur}>
              {a.libelle}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-brand-900">Saisons</legend>
        <p className="text-xs text-brand-700/85">
          Saisons où la recette est de saison. Laisser vide = toute l’année.
        </p>
        <div className="flex flex-wrap gap-2">
          {SAISONS.map((s) => {
            const actif = saisonsEffectif.includes(s);
            return (
              <button
                key={s}
                type="button"
                role="checkbox"
                aria-checked={actif}
                onClick={() => basculerSaison(s)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  actif
                    ? "border-brand-600 bg-primary text-white"
                    : "border-brand-200 text-brand-700 hover:bg-brand-50"
                }`}
              >
                {LIBELLE_SAISON[s]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-brand-900">
          Ingrédients
        </legend>
        {lignes.map((ligne, index) => (
          <div
            key={index}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-100 bg-surface p-3"
          >
            <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
              <label className="text-xs text-brand-700/85">Nom</label>
              <input
                type="text"
                aria-label={`Nom de l'ingrédient ${index + 1}`}
                value={ligne.nom}
                onChange={(e) => majLigne(index, { nom: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="flex w-20 flex-col gap-1">
              <label className="text-xs text-brand-700/85">Qté</label>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Quantité de l'ingrédient ${index + 1}`}
                value={ligne.quantite}
                onChange={(e) => majLigne(index, { quantite: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="flex w-28 flex-col gap-1">
              <label className="text-xs text-brand-700/85">Unité</label>
              <select
                aria-label={`Unité de l'ingrédient ${index + 1}`}
                value={ligne.unite}
                onChange={(e) => majLigne(index, { unite: e.target.value as Unite })}
                className={`${INPUT} cursor-pointer`}
              >
                {UNITES.map((u) => (
                  <option key={u.valeur} value={u.valeur}>
                    {u.libelle}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex w-40 flex-col gap-1">
              <label className="text-xs text-brand-700/85">Catégorie</label>
              <select
                aria-label={`Catégorie de l'ingrédient ${index + 1}`}
                value={ligne.categorie}
                onChange={(e) =>
                  majLigne(index, { categorie: e.target.value as CategorieIngredient })
                }
                className={`${INPUT} cursor-pointer`}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.valeur} value={c.valeur}>
                    {c.libelle}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 py-2 text-xs text-brand-700/85">
              <input
                type="checkbox"
                checked={ligne.fondDePlacard}
                onChange={(e) => majLigne(index, { fondDePlacard: e.target.checked })}
                className="size-4 cursor-pointer accent-brand-600"
              />
              Fond de placard
            </label>
            <button
              type="button"
              onClick={() => retirerLigne(index)}
              aria-label={`Retirer l'ingrédient ${index + 1}`}
              className="ml-auto rounded-full px-3 py-2 text-sm text-brand-700/85 transition-colors hover:bg-brand-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Retirer
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={ajouterLigne}
          className="self-start rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          + Ajouter un ingrédient
        </button>
      </fieldset>

      {erreur !== null && (
        <p id={idErreur} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {erreur}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={enCours}
          aria-busy={enCours}
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
        >
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          className="rounded-full border border-brand-200 px-6 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
