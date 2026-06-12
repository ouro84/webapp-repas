"use client";

// Page Liste de courses — agrégation depuis le planning courant (US-03, RG-05)
// + articles cochables en magasin (US-05, RG-10 à RG-14).
//
// États d'interface (RG-09) : chargement (avant hydratation), vide (aucun
// planning sauvegardé), chargé. La liste est recalculée à la volée depuis
// localStorage["planning_courant"] (section 5.6) via genererListeCourses() ;
// les coches vivent dans localStorage["courses_cochees"] (RG-12).
//
// Les deux clés localStorage sont branchées via useSyncExternalStore et les
// mini-stores partagés de lib/stockage.ts. Côté serveur les snapshots valent
// null : la page est prérendue en état "Chargement…", puis hydratée.
//
// Animation de réordonnancement (RG-11) : un article coché glisse en fin de
// catégorie via l'API View Transitions quand le navigateur la supporte —
// repli sans animation sinon, et si `prefers-reduced-motion` est actif.

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Users } from "lucide-react";
import { genererListeCourses } from "@/lib/courses";
import {
  aDesCoches,
  basculerCoche,
  categorieComplete,
  compterProgression,
  estCoche,
  parserCoches,
  trierAvecCoches,
} from "@/lib/coches";
import { storeCoches, storePlanning } from "@/lib/stockage";
import { useSync, usePresenceCourses } from "@/lib/sync";
import { formaterSemaine } from "@/lib/semaines";
import { accorderNom } from "@/lib/pluriels";
import { formaterQuantite } from "@/lib/unites";
import type {
  CategorieIngredient,
  Ingredient,
  ListeCourses,
  Planning,
} from "@/types";

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

// Le formatage quantité + unité (« 400 g », « 3 ») vit dans lib/unites.ts —
// partagé avec la fiche de recette (US-10).

// ============================================================================
// Animation de réordonnancement (View Transitions)
// ============================================================================

// `view-transition-name` exige un identifiant CSS valide et unique : on
// dérive un slug ASCII de la clé d'agrégation (accents décomposés puis
// caractères hors [a-z0-9] remplacés). Unicité garantie par l'agrégation
// RG-05 : une seule ligne par nom|unité dans toute la liste.
function nomTransition(ingredient: Ingredient): string {
  const slug = `${ingredient.nom}-${ingredient.unite}`
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques décomposés par NFD
    .replace(/[^a-z0-9]+/g, "-");
  return `article-${slug}`;
}

// Applique une mise à jour d'état dans une View Transition quand c'est
// possible — sinon directement (navigateur sans support, reduced motion).
function avecTransition(majEtat: () => void): void {
  const reduireAnimations = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  if (!document.startViewTransition || reduireAnimations) {
    majEtat();
    return;
  }
  // flushSync : la View Transition capture l'état AVANT/APRÈS — le rendu
  // React doit être synchrone à l'intérieur du callback.
  document.startViewTransition(() => {
    flushSync(majEtat);
  });
}

// ============================================================================
// Composant page
// ============================================================================

export default function PageCourses() {
  const hydrate = useHydratation();
  const brutPlanning = useSyncExternalStore(
    storePlanning.sAbonner,
    storePlanning.lire,
    storePlanning.lireServeur
  );
  const brutCoches = useSyncExternalStore(
    storeCoches.sAbonner,
    storeCoches.lire,
    storeCoches.lireServeur
  );
  // Synchro multi-device (US-13) : hydrate le planning depuis la base au
  // montage (ouvrir /courses sur un device neuf récupère le planning).
  useSync();
  // Présence anonyme « en magasin » (#56 PR4, RG-31) : vrai si un autre membre
  // du foyer est aussi sur la liste de courses en ce moment.
  const autresPresents = usePresenceCourses();

  // Catégories repliées (US-05) — état volontairement non persisté :
  // réinitialisé à chaque chargement de page. "fond-de-placard" est une
  // pseudo-catégorie pour la section dédiée.
  const [replies, setReplies] = useState<ReadonlySet<string>>(new Set());

  // Agrégation (RG-05) recalculée uniquement quand le planning change.
  const liste = useMemo<ListeCourses | null>(() => {
    if (brutPlanning === null) return null;
    try {
      const planning = JSON.parse(brutPlanning) as Planning;
      return genererListeCourses(planning);
    } catch (erreur) {
      // Donnée corrompue : on la signale et on retombe en état vide.
      console.error(`localStorage["planning_courant"] illisible.`, erreur);
      return null;
    }
  }, [brutPlanning]);

  // Semaine du planning affiché (#5) — affichée en tête, même format que le planning.
  const semainePlanning = useMemo<string | null>(() => {
    if (brutPlanning === null) return null;
    try {
      return (JSON.parse(brutPlanning) as Planning).semaine;
    } catch {
      return null;
    }
  }, [brutPlanning]);

  // Coches valides ou non : parserCoches tolère l'absence et la corruption.
  const coches = useMemo(() => parserCoches(brutCoches), [brutCoches]);

  function basculer(ingredient: Ingredient): void {
    const suivantes = basculerCoche(coches, ingredient);
    // Repli automatique (#111) : cocher le DERNIER article d'une section la
    // replie. On détermine la section (catégorie normale ou pseudo-catégorie
    // « fond-de-placard ») et ses articles, puis on teste la complétude sur
    // les coches RÉSULTANTES. On ne fait qu'ajouter au repli — décocher ne
    // déplie pas (le titre rayé, lui, est dérivé et se met à jour seul).
    const cleSection = ingredient.fondDePlacard
      ? "fond-de-placard"
      : ingredient.categorie;
    const articlesSection = !liste
      ? []
      : ingredient.fondDePlacard
        ? liste.fondDePlacard
        : liste.normal.find((l) => l.categorie === ingredient.categorie)
            ?.ingredients ?? [];
    const replierApres = categorieComplete(articlesSection, suivantes);

    avecTransition(() => {
      storeCoches.ecrire(JSON.stringify(suivantes));
      if (replierApres) {
        setReplies((courantes) =>
          courantes.has(cleSection)
            ? courantes
            : new Set(courantes).add(cleSection)
        );
      }
    });
  }

  function toutDecocher(): void {
    avecTransition(() => {
      storeCoches.effacer();
    });
  }

  function basculerSection(cle: string): void {
    setReplies((courantes) => {
      const suivantes = new Set(courantes);
      if (suivantes.has(cle)) {
        suivantes.delete(cle);
      } else {
        suivantes.add(cle);
      }
      return suivantes;
    });
  }

  // --- État chargement (RG-09) : prérendu serveur + calcul initial ---
  if (!hydrate) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
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
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold text-brand-900">Liste de courses</h1>
          <p className="mt-2 text-brand-700/85">Génère d&apos;abord un planning</p>
        </div>
        <Link
          href="/planning"
          className="rounded-full bg-primary px-8 py-4 text-lg font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Aller au planning
        </Link>
      </main>
    );
  }

  // --- État chargé : liste agrégée par catégorie (écran 3) ---
  // Progression "n/N" : articles à acheter uniquement (RG-14).
  const progression = compterProgression(liste, coches);

  return (
    <main id="contenu" className="mx-auto flex-1 w-full max-w-2xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-brand-900">Liste de courses</h1>
          {/* N° de semaine (RG #5) : même format que le planning */}
          {semainePlanning && (
            <p className="text-xs text-brand-700/85">
              {formaterSemaine(semainePlanning)}
            </p>
          )}
          {/* aria-live : la progression est annoncée à chaque coche */}
          <p aria-live="polite" className="text-sm text-brand-700/85">
            {progression.coches}/{progression.total} article
            {progression.total > 1 ? "s" : ""}
            {liste.fondDePlacard.length > 0 && (
              <span className="text-accent-700">
                {" · "}
                {liste.fondDePlacard.length} à vérifier
              </span>
            )}
          </p>
          {/* Présence anonyme « en magasin » (#56 PR4, RG-31) : discret, sans
              nom. aria-live pour annoncer l'arrivée/le départ d'un membre. */}
          <p
            aria-live="polite"
            className={`mt-1 flex items-center gap-1.5 text-xs text-brand-700/70 transition-opacity ${
              autresPresents ? "opacity-100" : "opacity-0"
            }`}
          >
            <Users aria-hidden="true" className="size-3.5 shrink-0" />
            {autresPresents ? "Un autre membre est aussi sur la liste" : ""}
          </p>
        </div>
        {aDesCoches(liste, coches) && (
          <button
            type="button"
            onClick={toutDecocher}
            // after:-inset-1 : étend la zone tactile à ≥ 44px sans changer le visuel
            className="relative rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Tout décocher
          </button>
        )}
        <Link
          href="/planning"
          className="relative rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          ← Planning
        </Link>
      </header>

      {/* Une section par catégorie présente, dans l'ordre canonique (RG-05).
          Articles non cochés d'abord, cochés en fin de catégorie (RG-11). */}
      <div className="space-y-6">
        {liste.normal.map((ligne) => {
          const repliee = replies.has(ligne.categorie);
          // Titre rayé quand tous les articles sont cochés (#111).
          const complete = categorieComplete(ligne.ingredients, coches);
          return (
            <section key={ligne.categorie}>
              <h2 className="mb-2">
                <button
                  type="button"
                  onClick={() => basculerSection(ligne.categorie)}
                  aria-expanded={!repliee}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-brand-700/85 transition-colors hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <span className={complete ? "line-through opacity-50" : ""}>
                    {LIBELLES_CATEGORIES[ligne.categorie]}
                  </span>
                  <Chevron repliee={repliee} />
                </button>
              </h2>
              {!repliee && (
                <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
                  {trierAvecCoches(ligne.ingredients, coches).map((ingredient) => (
                    <ArticleCochable
                      key={`${ingredient.nom}-${ingredient.unite}`}
                      ingredient={ingredient}
                      coche={estCoche(coches, ingredient)}
                      onBasculer={() => basculer(ingredient)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {/* Section fond de placard (F-09) : cochable aussi, mais hors
            compteur de progression (RG-14). */}
        {liste.fondDePlacard.length > 0 && (
          <section className="rounded-lg bg-accent-50 p-4">
            <h2>
              <button
                type="button"
                onClick={() => basculerSection("fond-de-placard")}
                aria-expanded={!replies.has("fond-de-placard")}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-accent-700 transition-colors hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span
                  className={
                    categorieComplete(liste.fondDePlacard, coches)
                      ? "line-through opacity-50"
                      : ""
                  }
                >
                  Fond de placard
                </span>
                <Chevron repliee={replies.has("fond-de-placard")} />
              </button>
            </h2>
            {!replies.has("fond-de-placard") && (
              <>
                <p className="mb-2 text-xs text-accent-700">
                  À vérifier avant d&apos;acheter
                </p>
                <ul className="divide-y divide-accent-100">
                  {trierAvecCoches(liste.fondDePlacard, coches).map((ingredient) => (
                    <ArticleCochable
                      key={`${ingredient.nom}-${ingredient.unite}`}
                      ingredient={ingredient}
                      coche={estCoche(coches, ingredient)}
                      onBasculer={() => basculer(ingredient)}
                      placard
                    />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

// Ligne d'article cochable (RG-10) : le <label> couvre toute la ligne
// (min-h-11 ≈ 44px) — checkbox native = clavier et lecteurs d'écran gratuits.
// Coché : rayé + grisé (RG-11) — l'état ne repose pas que sur la couleur.
function ArticleCochable({
  ingredient,
  coche,
  onBasculer,
  placard = false,
}: {
  ingredient: Ingredient;
  coche: boolean;
  onBasculer: () => void;
  placard?: boolean;
}) {
  const couleurNom = placard ? "text-accent-800" : "text-brand-900";
  const couleurQuantite = placard
    ? "text-accent-700"
    : "text-brand-700/85";
  return (
    <li style={{ viewTransitionName: nomTransition(ingredient) }}>
      <label
        className={`flex min-h-11 cursor-pointer items-center gap-3 py-2.5 transition-colors ${
          placard ? "" : "px-4 hover:bg-brand-50/60"
        }`}
      >
        <input
          type="checkbox"
          checked={coche}
          onChange={onBasculer}
          className="size-4 shrink-0 cursor-pointer accent-brand-600"
        />
        <span
          className={`flex-1 text-sm transition-colors ${
            coche ? `line-through ${couleurNom} opacity-40` : couleurNom
          }`}
        >
          {accorderNom(ingredient)}
        </span>
        <span
          className={`shrink-0 text-sm font-medium ${
            coche ? `line-through ${couleurQuantite} opacity-40` : couleurQuantite
          }`}
        >
          {formaterQuantite(ingredient)}
        </span>
      </label>
    </li>
  );
}

// Chevron de section repliable — SVG inline (pas d'emoji ni de glyphe,
// cf. audit #51), pivote selon l'état.
function Chevron({ repliee }: { repliee: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${
        repliee ? "-rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
