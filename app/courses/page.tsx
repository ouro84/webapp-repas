"use client";

// Page Liste de courses — agrégation depuis le planning courant (US-03, RG-05)
//
// États d'interface (RG-09) : chargement (avant hydratation), vide (aucun
// planning sauvegardé), chargé. La liste est recalculée à la volée depuis
// localStorage["planning_courant"] (section 5.6) via genererListeCourses().
//
// Comme sur la page Planning, localStorage est branché via
// useSyncExternalStore (la règle ESLint react-hooks/set-state-in-effect
// interdit le setState synchrone dans un useEffect au montage). Côté serveur
// le snapshot vaut null : la page est prérendue en état "Chargement…", puis
// hydratée avec la liste réelle.

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { genererListeCourses } from "@/lib/courses";
import type {
  CategorieIngredient,
  Ingredient,
  ListeCourses,
  Planning,
  Unite,
} from "@/types";

const CLE_STORAGE = "planning_courant";

// ============================================================================
// Lecture localStorage (système externe)
// ============================================================================

// Cette page ne fait que lire : seul l'événement "storage" (modifications
// depuis d'autres onglets) peut invalider le snapshot.
function sAbonner(rappel: () => void): () => void {
  window.addEventListener("storage", rappel);
  return () => window.removeEventListener("storage", rappel);
}

function lireSnapshot(): string | null {
  return localStorage.getItem(CLE_STORAGE);
}

// Pas de localStorage côté serveur : prérendu en état "chargement",
// le vrai contenu arrive à l'hydratation.
function lireSnapshotServeur(): null {
  return null;
}

// Vrai uniquement après hydratation côté navigateur — permet d'afficher
// "Chargement…" pendant le prérendu/calcul initial sans setState (RG-09).
function useHydratation(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

// ============================================================================
// Libellés
// ============================================================================

// Ordre d'affichage garanti par genererListeCourses (RG-05, étape 5) —
// ici on ne fait que traduire les identifiants en titres de section.
const LIBELLES_CATEGORIES: Record<CategorieIngredient, string> = {
  "viandes-poissons": "Viandes & Poissons",
  "legumes-fruits": "Légumes & Fruits",
  "produits-frais": "Produits frais",
  epicerie: "Épicerie",
  boulangerie: "Boulangerie",
  surgeles: "Surgelés",
  autre: "Autre",
};

// Libellé d'unité affiché à droite de la quantité. Chaîne vide = on
// n'affiche que le nombre : "piece" (ex: "3"), "autre" (unité précisée
// dans le nom de l'ingrédient, section 5.3).
const LIBELLES_UNITES: Record<Unite, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  cl: "cl",
  l: "l",
  piece: "",
  briquette: "briquette",
  bouteille: "bouteille",
  boite: "boîte",
  sachet: "sachet",
  cas: "c.à.s",
  cac: "c.à.c",
  autre: "",
};

// "400 g", "20 cl", "2 c.à.s" — et juste "3" pour les pièces.
function formaterQuantite(ingredient: Ingredient): string {
  const libelle = LIBELLES_UNITES[ingredient.unite];
  return libelle === ""
    ? String(ingredient.quantite)
    : `${ingredient.quantite} ${libelle}`;
}

// ============================================================================
// Composant page
// ============================================================================

export default function PageCourses() {
  const hydrate = useHydratation();
  const brut = useSyncExternalStore(sAbonner, lireSnapshot, lireSnapshotServeur);

  // Agrégation (RG-05) recalculée uniquement quand le planning change.
  const liste = useMemo<ListeCourses | null>(() => {
    if (brut === null) return null;
    try {
      const planning = JSON.parse(brut) as Planning;
      return genererListeCourses(planning);
    } catch (erreur) {
      // Donnée corrompue : on la signale et on retombe en état vide.
      console.error(`localStorage["${CLE_STORAGE}"] illisible.`, erreur);
      return null;
    }
  }, [brut]);

  // --- État chargement (RG-09) : prérendu serveur + calcul initial ---
  if (!hydrate) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8">
        {/* role="status" : annonce le chargement aux lecteurs d'écran */}
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  // --- État vide (RG-09) : aucun planning à agréger ---
  if (liste === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-brand-900">Liste de courses</h1>
          <p className="mt-2 text-brand-700/85">Génère d&apos;abord un planning</p>
        </div>
        <Link
          href="/planning"
          className="rounded-full bg-brand-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Aller au planning
        </Link>
      </main>
    );
  }

  // --- État chargé : liste agrégée par catégorie (écran 3) ---
  const nbArticles = liste.normal.reduce(
    (total, ligne) => total + ligne.ingredients.length,
    0
  );

  return (
    <main className="mx-auto flex-1 w-full max-w-2xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-brand-900">Liste de courses</h1>
          <p className="text-sm text-brand-700/85">
            {nbArticles} article{nbArticles > 1 ? "s" : ""}
            {liste.fondDePlacard.length > 0 &&
              ` · ${liste.fondDePlacard.length} à vérifier`}
          </p>
        </div>
        <Link
          href="/planning"
          // after:-inset-1 : étend la zone tactile à ≥ 44px sans changer le visuel
          className="relative rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          ← Planning
        </Link>
      </header>

      {/* Une section par catégorie présente, dans l'ordre canonique (RG-05) */}
      <div className="space-y-6">
        {liste.normal.map((ligne) => (
          <section key={ligne.categorie}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-700/85">
              {LIBELLES_CATEGORIES[ligne.categorie]}
            </h2>
            <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-white">
              {ligne.ingredients.map((ingredient) => (
                <li
                  key={`${ingredient.nom}-${ingredient.unite}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-2.5"
                >
                  <span className="text-sm text-brand-900">{ingredient.nom}</span>
                  <span className="shrink-0 text-sm font-medium text-brand-700/85">
                    {formaterQuantite(ingredient)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Section fond de placard (F-09) : fond distinct, à vérifier avant d'acheter */}
        {liste.fondDePlacard.length > 0 && (
          <section className="rounded-lg bg-amber-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Fond de placard
            </h2>
            <p className="mb-2 text-xs text-amber-700">
              À vérifier avant d&apos;acheter
            </p>
            <ul className="divide-y divide-amber-100">
              {liste.fondDePlacard.map((ingredient) => (
                <li
                  key={`${ingredient.nom}-${ingredient.unite}`}
                  className="flex items-baseline justify-between gap-4 py-2.5"
                >
                  <span className="text-sm text-amber-900">{ingredient.nom}</span>
                  <span className="shrink-0 text-sm font-medium text-amber-700">
                    {formaterQuantite(ingredient)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
