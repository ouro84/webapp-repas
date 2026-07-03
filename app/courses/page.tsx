"use client";

// Page Liste de courses — agrégation depuis le CYCLE de courses affiché (#257,
// remplace la semaine ISO fixe de US-03/RG-05) + articles cochables en magasin
// (US-05, RG-10 à RG-14).
//
// États d'interface (RG-09) : chargement (avant hydratation), vide (aucun
// repas planifié sur le cycle affiché), chargé. La liste est recalculée à la
// volée depuis le planning PROJETÉ du cycle (lib/sync.ts, useCyclePlanning —
// store en mémoire, distinct du planning par semaine de /planning) via
// genererListeCourses() ; les coches vivent dans localStorage["courses_cochees"]
// (RG-12), synchronisées par ancre de cycle (cf. lib/sync.ts).
//
// Le cycle affiché et son planning projeté sont branchés via useSyncExternalStore
// (useCycleAffiche/useCyclePlanning) ; les coches via storeCoches (lib/stockage.ts).
// Côté serveur les snapshots valent null : la page est prérendue en état
// "Chargement…", puis hydratée.
//
// Animation de réordonnancement (RG-11) : un article coché glisse en fin de
// catégorie via l'API View Transitions quand le navigateur la supporte —
// repli sans animation sinon, et si `prefers-reduced-motion` est actif.

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { genererListeCourses } from "@/lib/courses";
import {
  aDesCoches,
  basculerCoche,
  categorieTerminee,
  compterProgression,
  estCoche,
  parserCoches,
  trierAvecCoches,
  trierCategoriesAvecCoches,
} from "@/lib/coches";
import { storeCoches } from "@/lib/stockage";
import {
  useSyncCourses,
  usePresenceCourses,
  useCycleAffiche,
  useCyclePlanning,
  naviguerCycle,
  etirerCycle,
  type CycleAffiche,
} from "@/lib/sync";
import { libelleCycle, LONGUEUR_MAX } from "@/lib/cycles";
import { accorderNom } from "@/lib/pluriels";
import { formaterQuantite } from "@/lib/unites";
import type {
  CategorieIngredient,
  Ingredient,
  ListeCourses,
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

// Nom de transition d'une section de catégorie (#111) : permet d'animer le
// glissement d'une catégorie terminée vers le bas via View Transitions, comme
// les articles cochés (RG-11). La clé de catégorie est déjà un slug ASCII.
function nomTransitionCategorie(cle: string): string {
  return `categorie-${cle}`;
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
// Navigateur de cycle (#257, M1) — extrait pour être rendu à la fois dans
// l'état vide et l'état chargé : un cycle SANS repas planifié peut avoir un
// voisin (précédent/suivant) qui EN a — sans ce navigateur dans l'état vide,
// impossible d'anticiper/consulter un cycle adjacent depuis un cycle vide.
// ============================================================================
function NavigateurCycle({ cycle }: { cycle: CycleAffiche }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Cycle précédent"
          onClick={() => void naviguerCycle(-1)}
          className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span className="text-xs font-medium text-brand-700/85">
          {libelleCycle(cycle.ancre, cycle.longueur)}
        </span>
        <button
          type="button"
          aria-label="Cycle suivant"
          onClick={() => void naviguerCycle(1)}
          className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-brand-700/85">
        <span>Couvre {cycle.longueur} j</span>
        <button
          type="button"
          aria-label="Réduire d’un jour"
          disabled={cycle.longueur <= 1}
          onClick={() => void etirerCycle(cycle.longueur - 1)}
          className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-200 font-medium transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Ajouter un jour"
          disabled={cycle.longueur >= LONGUEUR_MAX}
          onClick={() => void etirerCycle(cycle.longueur + 1)}
          className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-200 font-medium transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Composant page
// ============================================================================

export default function PageCourses() {
  const hydrate = useHydratation();
  const brutCoches = useSyncExternalStore(
    storeCoches.sAbonner,
    storeCoches.lire,
    storeCoches.lireServeur
  );
  // Synchro par cycle (#257) : hydrate le CYCLE (planning projeté, en mémoire)
  // et les coches (par ancre) au montage — pas de push planning, pas de temps
  // réel planning (/courses n'écrit jamais le planning, cf. lib/sync.ts).
  useSyncCourses();
  // Cycle actuellement affiché ({ ancre, longueur }) et son planning projeté —
  // stores dédiés (#257), distincts de storePlanning (semaine unique).
  const cycle = useCycleAffiche();
  const planningCycle = useCyclePlanning();
  // Présence anonyme « en magasin » (#56 PR4, RG-31) : vrai si un autre membre
  // du foyer est aussi sur la liste de courses en ce moment.
  const autresPresents = usePresenceCourses();

  // Catégories repliées (US-05) — état volontairement non persisté :
  // réinitialisé à chaque chargement de page. "fond-de-placard" est une
  // pseudo-catégorie pour la section dédiée.
  const [replies, setReplies] = useState<ReadonlySet<string>>(new Set());

  // Agrégation (RG-05) recalculée uniquement quand le planning projeté du
  // cycle change. Un cycle sans aucun repas planifié (aucune semaine chargée
  // ne couvre ses jours) produit une liste sans lignes : traité comme l'état
  // vide, au même titre qu'aucun cycle hydraté (planningCycle === null).
  const liste = useMemo<ListeCourses | null>(() => {
    if (planningCycle === null) return null;
    const resultat = genererListeCourses(planningCycle);
    const vide = resultat.normal.length === 0 && resultat.fondDePlacard.length === 0;
    return vide ? null : resultat;
  }, [planningCycle]);

  // Coches valides ou non : parserCoches tolère l'absence et la corruption.
  const coches = useMemo(() => parserCoches(brutCoches), [brutCoches]);

  function basculer(ingredient: Ingredient): void {
    avecTransition(() => {
      storeCoches.ecrire(JSON.stringify(basculerCoche(coches, ingredient)));
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

  // --- État chargement (RG-09) : prérendu serveur + calcul initial. Couvre
  // aussi le cycle pas encore résolu (`cycle === null`, hydraterCycle() en
  // cours) — sans cette garde, la toute première visite (rien en
  // localStorage) tombait dans l'état vide le temps d'un rendu, même pour un
  // utilisateur qui a bien un planning (#257). ---
  if (!hydrate || cycle === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        {/* role="status" : annonce le chargement aux lecteurs d'écran */}
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  // --- État vide (RG-09) : cycle résolu mais aucun repas planifié dessus
  // (aucun planning n'a encore été généré, ou aucune semaine chargée ne
  // couvre les jours du cycle courant) ---
  if (liste === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="flex flex-col items-center text-center">
          <h1 className="font-display text-2xl font-semibold text-brand-900">Liste de courses</h1>
          <p className="mt-2 text-brand-700/85">Aucun repas planifié sur ce cycle</p>
          {/* Navigateur de cycle (#257, M1) : un cycle vide peut avoir un
              voisin non vide — permettre d'anticiper/consulter sans repasser
              par /planning. */}
          {cycle && <NavigateurCycle cycle={cycle} />}
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
      {/* En-tête (#211, audit #51) : titre PLEINE LARGEUR (ne se coupe plus en
          compétition avec les boutons), actions en-dessous sur mobile et à droite
          dès sm. Compteur reformulé pour expliciter coché / total / à vérifier. */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-brand-900">Liste de courses</h1>
          {/* Cycle de courses (#257) : libellé + navigateur ‹ / › (remplace le
              n° de semaine, US-03 devient « une fenêtre de N jours » plutôt
              qu'une semaine ISO fixe) + étirement de la fenêtre. Rendu
              seulement une fois le cycle hydraté (évite un flash sans libellé). */}
          {cycle && <NavigateurCycle cycle={cycle} />}
          {/* aria-live : la progression est annoncée à chaque coche. Le « à
              vérifier » reste en terracotta = couleur de marque « Fond de placard »
              (#67 P15), pas un signal d'alerte (cf. #212, clos by-design). */}
          <p aria-live="polite" className="text-sm text-brand-700/85">
            {progression.coches} coché{progression.coches > 1 ? "s" : ""} sur{" "}
            {progression.total}
            {liste.fondDePlacard.length > 0 && (
              <span className="text-accent-700">
                {" · "}
                {liste.fondDePlacard.length} à vérifier dans tes placards
              </span>
            )}
          </p>
          {/* Présence anonyme « en magasin » (#56 PR4, RG-31) : discret, sans
              nom. aria-live pour annoncer l'arrivée/le départ d'un membre. */}
          <p
            aria-live="polite"
            className={`mt-1 flex items-center gap-1.5 text-xs text-brand-700/85 transition-opacity ${
              autresPresents ? "opacity-100" : "opacity-0"
            }`}
          >
            <Users aria-hidden="true" className="size-3.5 shrink-0" />
            {autresPresents ? "Un autre membre est aussi sur la liste" : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
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
        </div>
      </header>

      {/* Une section par catégorie présente, dans l'ordre canonique (RG-05).
          Articles non cochés d'abord, cochés en fin de catégorie (RG-11).
          Les catégories entièrement cochées glissent en bas de liste, titre
          rayé, en restant ouvertes (RG-39, #111). */}
      <div className="space-y-6">
        {trierCategoriesAvecCoches(liste.normal, coches).map((ligne) => {
          const repliee = replies.has(ligne.categorie);
          const terminee = categorieTerminee(ligne, coches);
          return (
            <section
              key={ligne.categorie}
              style={{ viewTransitionName: nomTransitionCategorie(ligne.categorie) }}
            >
              <h2 className="mb-2">
                <button
                  type="button"
                  onClick={() => basculerSection(ligne.categorie)}
                  aria-expanded={!repliee}
                  className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                    terminee
                      ? "text-brand-700/85 line-through opacity-40 hover:text-brand-900"
                      : "text-brand-700/85 hover:text-brand-900"
                  }`}
                >
                  {LIBELLES_CATEGORIES[ligne.categorie]}
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
                className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-accent-700 transition-colors hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  // RG-39 : titre rayé quand tout est vérifié — pas de
                  // réordonnancement (le fond de placard reste en dernier).
                  liste.fondDePlacard.every((i) => estCoche(coches, i))
                    ? "line-through opacity-40"
                    : ""
                }`}
              >
                Fond de placard
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
