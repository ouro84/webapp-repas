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
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { assemblerListeCourses } from "@/lib/liste-courses";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";
import {
  aDesCoches,
  basculerCoche,
  categorieTerminee,
  cibleAtterrissage,
  compterCategoriesTerminees,
  compterProgression,
  estCoche,
  libelleCategoriesTerminees,
  parserCoches,
  trierAvecCoches,
  trierCategoriesAvecCoches,
} from "@/lib/coches";
import {
  NOM_TRANSITION_FOND_DE_PLACARD,
  nomTransition,
  nomTransitionCategorie,
} from "@/lib/transitions-courses";
import { aQuantiteRenseignee } from "@/lib/articles-manuels";
import { storeCoches } from "@/lib/stockage";
import {
  useSyncCourses,
  usePresenceCourses,
  useCycleAffiche,
  useCyclePlanning,
  useArticlesManuels,
  useGenerationCycle,
  ajouterArticleManuel,
  modifierArticleManuel,
  supprimerArticleManuel,
  basculerCocheArticleManuel,
  viderCochesArticlesManuels,
  naviguerCycle,
  etirerCycle,
  type CycleAffiche,
} from "@/lib/sync";
import { libelleCycle, LONGUEUR_MAX } from "@/lib/cycles";
import { accorderNom } from "@/lib/pluriels";
import { formaterQuantite } from "@/lib/unites";
import { LIBELLES_CATEGORIES } from "@/lib/courses";
import { FormulaireArticleManuel } from "@/components/courses/formulaire-article-manuel";
import type { SaisieArticleManuel } from "@/lib/persistance";
import type {
  ArticleManuel,
  Ingredient,
  ListeCourses,
  ReglagesGeneration,
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

// Les titres de section (LIBELLES_CATEGORIES) vivent dans lib/courses.ts —
// partagés avec l'outil MCP lire_liste_courses (#305). Le formatage quantité +
// unité (« 400 g », « 3 ») vit dans lib/unites.ts — partagé avec la fiche de
// recette (US-10).

// ============================================================================
// Animation de réordonnancement (View Transitions)
//
// Les noms de transition eux-mêmes vivent dans lib/transitions-courses.ts
// (purs, testables, importés aussi par cibleAtterrissage) ; le vocabulaire
// d'animation (durée, courbe, classes `.vt-*`) dans app/globals.css.
// ============================================================================

// Applique une mise à jour d'état dans une View Transition quand c'est
// possible — sinon directement (navigateur sans support, reduced motion).
// Renvoie la transition pour permettre d'enchaîner sur sa fin (pulsation
// d'atterrissage), `null` quand aucune transition n'a été démarrée.
//
// ⚠️ CONTRAT `flushSync` : le callback ne capture que sa portion SYNCHRONE.
// Toute mutation appelée ici doit appliquer sa partie locale AVANT son
// premier `await`, sinon elle saute hors transition (cf. lib/sync.ts,
// viderCochesArticlesManuels).
function avecTransition(majEtat: () => void): ViewTransition | null {
  const reduireAnimations = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  if (!document.startViewTransition || reduireAnimations) {
    majEtat();
    return null;
  }
  // flushSync : la View Transition capture l'état AVANT/APRÈS — le rendu
  // React doit être synchrone à l'intérieur du callback.
  return document.startViewTransition(() => {
    flushSync(majEtat);
  });
}

// Pulsation d'atterrissage (RG-11 / RG-39) — « il est ICI maintenant ».
//
// Les premiers utilisateurs croyaient qu'un article coché avait DISPARU : en
// magasin on regarde son doigt, pas le trajet. Le moment focal n'est donc pas
// le départ mais l'ARRIVÉE. Trois contraintes ont dicté ce composant :
//   - un calque de couleur STATIQUE dont on anime l'opacité, jamais un
//     `background-color` animé (contrat transform/opacity-only, globals.css) ;
//   - un <div>, JAMAIS un <span> : e2e/courses.spec.ts cible
//     `li.last().locator("span").first()` pour vérifier le rayé ;
//   - la couleur passe par le token sémantique `--color-atterrissage`, qui a
//     sa propre valeur en sombre (brand-50 y serait quasi invisible sur
//     surface) — le projet n'a aucune utilitaire `dark:`, qui serait branchée
//     sur prefers-color-scheme donc fausse face au sélecteur de thème manuel.
// Pas de `motion-safe:` : sous reduced motion aucune transition n'est
// démarrée, donc pas de `finished`, donc ce composant n'est jamais monté. Un
// `motion-safe:` en ferait au contraire un bandeau vert PERMANENT.
// Le parent doit être `relative`, et le contenu en flux qui suit aussi (un
// enfant absolute peint au-dessus du contenu resté dans le flux).
function PulsationAtterrissage({ onFin }: { onFin: () => void }) {
  return (
    <div
      aria-hidden="true"
      onAnimationEnd={onFin}
      className="pointer-events-none absolute inset-0 rounded-lg bg-atterrissage animate-atterrissage"
    />
  );
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

function ContenuCourses() {
  const hydrate = useHydratation();
  // Relais one-shot depuis /planning (#279) : ancre demandée via `?ancre=` sur
  // le lien « Liste de courses → ». Lue une seule fois (mount), cf. useSyncCourses.
  const searchParams = useSearchParams();
  const ancreForcee = searchParams.get("ancre");
  const brutCoches = useSyncExternalStore(
    storeCoches.sAbonner,
    storeCoches.lire,
    storeCoches.lireServeur
  );
  // Synchro par cycle (#257) : hydrate le CYCLE (planning projeté, en mémoire)
  // et les coches (par ancre) au montage — pas de push planning, pas de temps
  // réel planning (/courses n'écrit jamais le planning, cf. lib/sync.ts).
  useSyncCourses(ancreForcee);

  // Nettoie le paramètre d'URL après lecture (#279) — même motif que
  // capterCodeDepuisURL (lib/invitation.ts) : éviter qu'un rechargement ou un
  // retour arrière ne re-déclenche le relais.
  useEffect(() => {
    if (!ancreForcee) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ancre");
    window.history.replaceState({}, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois au montage
  }, []);
  // Cycle actuellement affiché ({ ancre, longueur }) et son planning projeté —
  // stores dédiés (#257), distincts de storePlanning (semaine unique).
  const cycle = useCycleAffiche();
  const planningCycle = useCyclePlanning();
  // Articles manuels du cycle affiché (#216, US-47) — chargés/synchronisés par
  // useSyncCourses (même ancre que les coches), indépendants du planning.
  const articlesManuels = useArticlesManuels();
  // Présence anonyme « en magasin » (#56 PR4, RG-31) : vrai si un autre membre
  // du foyer est aussi sur la liste de courses en ce moment.
  const autresPresents = usePresenceCourses();

  // Bottom sheet d'ajout/édition d'un article manuel (RG-43/43 bis) : `null` =
  // fermé, sinon le mode + (pour l'édition) l'article visé.
  const [dialogueArticle, setDialogueArticle] = useState<
    { mode: "ajout" } | { mode: "edition"; article: ArticleManuel } | null
  >(null);

  // Catégories repliées (US-05) — état volontairement non persisté :
  // réinitialisé à chaque chargement de page. "fond-de-placard" est une
  // pseudo-catégorie pour la section dédiée.
  const [replies, setReplies] = useState<ReadonlySet<string>>(new Set());

  // Réglages de génération (#217) : un créneau désactivé (« Aucun ») retire
  // immédiatement ses ingrédients de la liste, même sans régénérer — même
  // filtre live que /planning (RG-46). Défaut tant que non chargés = tout actif.
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);
  useEffect(() => {
    let actif = true;
    chargerReglages()
      .then((r) => {
        if (actif) setReglages(r);
      })
      .catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  // Génération fenêtrée « Générer mon cycle » (#259, hook partagé #279) :
  // remplit d'un coup les repas du cycle affiché (1-2 semaines ISO), sans
  // quitter /courses.
  const { enGeneration, genererCycle } = useGenerationCycle(cycle);

  async function genererMonCycle(): Promise<void> {
    if (enGeneration) return;
    try {
      const { vegeNonHonore, mixNonHonore, saisonNonHonore } = await genererCycle();
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error(
        erreur instanceof Error
          ? erreur.message
          : "Impossible de générer le cycle. Vérifie ta connexion et réessaie."
      );
    }
  }

  // Agrégation (RG-05) recalculée uniquement quand le planning projeté du
  // cycle change. Un cycle sans aucun repas planifié (aucune semaine chargée
  // ne couvre ses jours) produit une liste sans lignes — mais des articles
  // manuels (#216) peuvent exister indépendamment de tout repas planifié :
  // seule l'absence des DEUX vaut état vide.
  // Composition partagée avec le service serveur du MCP (#304, règle du
  // jumeau) : filtre live des créneaux désactivés (#217, RG-46 — un slot
  // persisté avant la désactivation ne produit aucun ingrédient), agrégation
  // (RG-05), puis fusion des articles manuels (#216) AVANT tri — cf.
  // lib/liste-courses.ts (pas de duplication de trierCategoriesAvecCoches).
  const liste = useMemo<ListeCourses | null>(() => {
    const fusionnee = assemblerListeCourses(planningCycle, reglages, articlesManuels);
    const vide = fusionnee.normal.length === 0 && fusionnee.fondDePlacard.length === 0;
    return vide ? null : fusionnee;
  }, [planningCycle, reglages, articlesManuels]);

  // Coches valides ou non : parserCoches tolère l'absence et la corruption.
  const coches = useMemo(() => parserCoches(brutCoches), [brutCoches]);

  // Élément qui vient d'atterrir après un réordonnancement (RG-11 / RG-39) :
  // `cle` = son nom de transition, `nonce` = compteur monotone. Le nonce sert
  // DEUX fois : comme `key` (remonter l'overlay pour rejouer l'animation quand
  // la MÊME ligne atterrit deux fois de suite — même piège que le `genNonce`
  // du stagger de /planning), et comme garde de fraîcheur (une bascule plus
  // récente ne doit pas se faire effacer par la fin de l'ancienne).
  const [atterrissage, setAtterrissage] = useState<{
    cle: string;
    nonce: number;
  } | null>(null);
  const demandeAtterrissage = useRef(0);

  const finAtterrissage = useCallback((nonce: number) => {
    setAtterrissage((courant) =>
      courant && courant.nonce === nonce ? null : courant
    );
  }, []);

  // Programme la pulsation pour la FIN de la transition : pendant celle-ci le
  // DOM réel est masqué sous l'overlay de snapshots, une animation posée sur
  // l'élément réel n'y serait pas visible. No-op sans transition (pas de
  // support / reduced motion) ou sans cible (décoche : l'article remonte vers
  // le haut, là où l'œil est déjà).
  function signalerAtterrissage(
    transition: ViewTransition | null,
    cle: string | null
  ): void {
    if (transition === null || cle === null) return;
    demandeAtterrissage.current += 1;
    const demande = demandeAtterrissage.current;
    // `ready` REJETTE (AbortError) si un tap suivant saute cette transition —
    // à catcher, sinon rejet non géré. Le tri se fait ensuite sur `demande`.
    transition.ready.catch(() => {});
    transition.finished
      .then(() => {
        // Une bascule plus récente a pris la main : c'est le dernier geste
        // qui pulse, pas celui-ci.
        if (demande !== demandeAtterrissage.current) return;
        setAtterrissage({ cle, nonce: demande });
      })
      .catch(() => {
        /* transition avortée : rien à signaler */
      });
  }

  function basculer(ingredient: Ingredient): void {
    // Calculée AVANT la mutation : cibleAtterrissage lit l'état d'AVANT pour
    // savoir si cette coche termine la catégorie (RG-39) — auquel cas c'est
    // la section, qui part le plus loin, qu'il faut savoir retrouver.
    const cible = liste ? cibleAtterrissage(liste, coches, ingredient) : null;

    // Un article manuel porte son état coché en base (colonne dédiée, RG-41) —
    // pas dans le blob localStorage des ingrédients dérivés (RG-12).
    if (ingredient.source === "manuel") {
      const transition = avecTransition(() => {
        // La mise à jour optimiste du store est synchrone (avant le premier
        // await de basculerCocheArticleManuel) : elle est bien captée par le
        // flushSync. Seul l'aller-retour réseau est différé — et il RETHROW
        // après revert, d'où le catch (motif de supprimer(), plus bas).
        void basculerCocheArticleManuel(ingredient.id!).catch((erreur) => {
          console.error("Bascule de coche (article manuel) échouée.", erreur);
          toast.error("Impossible d'enregistrer cette coche. Réessaie.");
        });
      });
      signalerAtterrissage(transition, cible);
      return;
    }

    const transition = avecTransition(() => {
      storeCoches.ecrire(JSON.stringify(basculerCoche(coches, ingredient)));
    });
    signalerAtterrissage(transition, cible);
  }

  function toutDecocher(): void {
    // Pas de pulsation ici : tout remonte d'un coup, il n'y a pas UN élément
    // à retrouver.
    avecTransition(() => {
      storeCoches.effacer();
      void viderCochesArticlesManuels().catch((erreur) => {
        console.error("Décochage des articles manuels échoué.", erreur);
        toast.error("Impossible de tout décocher. Réessaie.");
      });
    });
  }

  function enregistrerArticleManuel(saisie: SaisieArticleManuel): void {
    const promesse =
      dialogueArticle?.mode === "edition"
        ? modifierArticleManuel(dialogueArticle.article.id, saisie)
        : ajouterArticleManuel(saisie);
    promesse.catch((erreur) => {
      console.error("Enregistrement de l'article manuel échoué.", erreur);
      toast.error("Impossible d'enregistrer cet article. Réessaie.");
    });
  }

  function supprimer(ingredient: Ingredient): void {
    if (!ingredient.id) return;
    supprimerArticleManuel(ingredient.id).catch((erreur) => {
      console.error("Suppression de l'article manuel échouée.", erreur);
      toast.error("Impossible de supprimer cet article. Réessaie.");
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
        {/* Génération fenêtrée (#259) : remplir le cycle affiché d'un clic,
            sans passer par /planning (D3 « Générer mon cycle »). */}
        <button
          type="button"
          onClick={() => void genererMonCycle()}
          disabled={enGeneration}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-lg font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles aria-hidden="true" className="size-5" />
          {enGeneration ? "Génération…" : "Générer mon cycle"}
        </button>
        {/* Article manuel (#216) : une liste de courses ad hoc n'a pas besoin
            d'un repas planifié — on peut démarrer directement ici. */}
        <button
          type="button"
          onClick={() => setDialogueArticle({ mode: "ajout" })}
          className="relative inline-flex items-center gap-1.5 rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <Plus aria-hidden="true" className="size-4" />
          Ajouter un article
        </button>
        <Link
          href="/planning"
          className="relative text-sm font-medium text-brand-700 underline-offset-4 transition after:absolute after:-inset-2 after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Aller au planning
        </Link>
        {dialogueArticle && (
          <FormulaireArticleManuel
            titre={dialogueArticle.mode === "edition" ? "Modifier l'article" : "Ajouter un article"}
            initial={
              dialogueArticle.mode === "edition"
                ? {
                    libelle: dialogueArticle.article.libelle,
                    quantite: dialogueArticle.article.quantite,
                    unite: dialogueArticle.article.unite,
                    categorie: dialogueArticle.article.categorie,
                    fondDePlacard: dialogueArticle.article.fondDePlacard,
                  }
                : undefined
            }
            onEnregistrer={enregistrerArticleManuel}
            onFermer={() => setDialogueArticle(null)}
          />
        )}
      </main>
    );
  }

  // --- État chargé : liste agrégée par catégorie (écran 3) ---
  // Progression "n/N" : articles à acheter uniquement (RG-14).
  const progression = compterProgression(liste, coches);
  // Repère persistant du glissement de catégorie (RG-39) : le fond de placard
  // est exclu, il ne se réordonne jamais (RG-14).
  const nbCategoriesTerminees = compterCategoriesTerminees(liste, coches);

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
          {/* Repère du glissement de catégorie (RG-39). Sur mobile une
              catégorie terminée descend souvent HORS ÉCRAN : aucune animation
              ne peut la montrer à l'arrivée, d'où ce repère PERSISTANT (pas un
              toast fugace) qui explique le mécanisme et compte — « rien n'a
              disparu, tout est en bas ». TOUJOURS monté, même vide : une région
              aria-live insérée en même temps que son contenu n'est pas annoncée
              par la plupart des lecteurs d'écran, et réserver la ligne évite un
              saut de hauteur de l'en-tête AU MOMENT MÊME de la transition. */}
          <p
            aria-live="polite"
            className={`mt-1 text-xs text-brand-700/85 transition-opacity ${
              nbCategoriesTerminees > 0 ? "opacity-100" : "opacity-0"
            }`}
          >
            {libelleCategoriesTerminees(nbCategoriesTerminees)}
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
          {/* Régénérer le cycle affiché (#259) — invalide les coches (RG-13). */}
          <button
            type="button"
            onClick={() => void genererMonCycle()}
            disabled={enGeneration}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {enGeneration ? "Génération…" : "Générer mon cycle"}
          </button>
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
          {/* Article manuel (#216) : ajouter un article hors planning. */}
          <button
            type="button"
            onClick={() => setDialogueArticle({ mode: "ajout" })}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Plus aria-hidden="true" className="size-4" />
            Ajouter un article
          </button>
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
          const pulsation =
            atterrissage &&
            atterrissage.cle === nomTransitionCategorie(ligne.categorie)
              ? atterrissage.nonce
              : null;
          return (
            <section
              key={ligne.categorie}
              className="vt-bloc-categorie"
              style={{ viewTransitionName: nomTransitionCategorie(ligne.categorie) }}
            >
              <h2 className="relative mb-2">
                {/* HORS du <button> : e2e/courses.spec.ts lit
                    `main section h2 button` en toHaveText. */}
                {pulsation !== null && (
                  <PulsationAtterrissage
                    key={pulsation}
                    onFin={() => finAtterrissage(pulsation)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => basculerSection(ligne.categorie)}
                  aria-expanded={!repliee}
                  className={`relative flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                    terminee
                      ? "text-brand-700/85 line-through opacity-40 hover:text-brand-900"
                      : "text-brand-700/85 hover:text-brand-900"
                  }`}
                >
                  {/* ✓ = marqueur « terminé » (RG-39). Icône lucide sans nœud
                      texte : le nom accessible du bouton et le toHaveText des
                      e2e restent inchangés. Grâce à
                      `::view-transition-new(.bloc-categorie)` (globals.css), il
                      est lisible dès la PREMIÈRE frame du glissement. */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    {terminee && (
                      <Check aria-hidden="true" className="size-3.5 shrink-0" />
                    )}
                    {LIBELLES_CATEGORIES[ligne.categorie]}
                  </span>
                  <Chevron repliee={repliee} />
                </button>
              </h2>
              {!repliee && (
                <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
                  {trierAvecCoches(ligne.ingredients, coches).map((ingredient) => (
                    <ArticleCochable
                      key={ingredient.id ?? `${ingredient.nom}-${ingredient.unite}`}
                      ingredient={ingredient}
                      coche={estCoche(coches, ingredient)}
                      onBasculer={() => basculer(ingredient)}
                      nonceAtterrissage={
                        atterrissage && atterrissage.cle === nomTransition(ingredient)
                          ? atterrissage.nonce
                          : null
                      }
                      onFinAtterrissage={finAtterrissage}
                      onModifier={
                        ingredient.source === "manuel"
                          ? () => {
                              const article = articlesManuels.find((a) => a.id === ingredient.id);
                              if (article) setDialogueArticle({ mode: "edition", article });
                            }
                          : undefined
                      }
                      onSupprimer={
                        ingredient.source === "manuel" ? () => supprimer(ingredient) : undefined
                      }
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
          // Nommée bien qu'elle ne se réordonne JAMAIS : ses <li> sont nommés,
          // donc EXTRAITS du snapshot racine. Sans groupe propre, son chrome
          // (fond, titre) sauterait d'un coup avec la racine pendant que ses
          // lignes glissent — cf. « règle du groupe uniforme », globals.css.
          <section
            className="vt-bloc-categorie rounded-lg bg-accent-50 p-4"
            style={{ viewTransitionName: NOM_TRANSITION_FOND_DE_PLACARD }}
          >
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
                      key={ingredient.id ?? `${ingredient.nom}-${ingredient.unite}`}
                      ingredient={ingredient}
                      coche={estCoche(coches, ingredient)}
                      onBasculer={() => basculer(ingredient)}
                      nonceAtterrissage={
                        atterrissage && atterrissage.cle === nomTransition(ingredient)
                          ? atterrissage.nonce
                          : null
                      }
                      onFinAtterrissage={finAtterrissage}
                      onModifier={
                        ingredient.source === "manuel"
                          ? () => {
                              const article = articlesManuels.find((a) => a.id === ingredient.id);
                              if (article) setDialogueArticle({ mode: "edition", article });
                            }
                          : undefined
                      }
                      onSupprimer={
                        ingredient.source === "manuel" ? () => supprimer(ingredient) : undefined
                      }
                      placard
                    />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      {dialogueArticle && (
        <FormulaireArticleManuel
          titre={dialogueArticle.mode === "edition" ? "Modifier l'article" : "Ajouter un article"}
          initial={
            dialogueArticle.mode === "edition"
              ? {
                  libelle: dialogueArticle.article.libelle,
                  quantite: dialogueArticle.article.quantite,
                  unite: dialogueArticle.article.unite,
                  categorie: dialogueArticle.article.categorie,
                  fondDePlacard: dialogueArticle.article.fondDePlacard,
                }
              : undefined
          }
          onEnregistrer={enregistrerArticleManuel}
          onFermer={() => setDialogueArticle(null)}
        />
      )}
    </main>
  );
}

export default function PageCourses() {
  // Frontière Suspense exigée par useSearchParams (Next 16, cf. app/recettes/page.tsx).
  return (
    <Suspense
      fallback={
        <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
          <p role="status" className="animate-pulse text-lg text-brand-700/85">
            Chargement…
          </p>
        </main>
      }
    >
      <ContenuCourses />
    </Suspense>
  );
}

// Ligne d'article cochable (RG-10) : le <label> couvre toute la ligne
// (min-h-11 ≈ 44px) — checkbox native = clavier et lecteurs d'écran gratuits.
// Coché : rayé + grisé (RG-11) — l'état ne repose pas que sur la couleur.
function ArticleCochable({
  ingredient,
  coche,
  onBasculer,
  nonceAtterrissage = null,
  onFinAtterrissage,
  onModifier,
  onSupprimer,
  placard = false,
}: {
  ingredient: Ingredient;
  coche: boolean;
  onBasculer: () => void;
  /** Non-null = cette ligne vient d'atterrir (RG-11) : joue la pulsation. */
  nonceAtterrissage?: number | null;
  onFinAtterrissage?: (nonce: number) => void;
  /** Article manuel uniquement (#216, RG-43 bis) : ouvre l'édition en place. */
  onModifier?: () => void;
  /** Article manuel uniquement (#216, RG-42) : suppression par icône corbeille. */
  onSupprimer?: () => void;
  placard?: boolean;
}) {
  const couleurNom = placard ? "text-accent-800" : "text-brand-900";
  const couleurQuantite = placard
    ? "text-accent-700"
    : "text-brand-700/85";
  return (
    <li
      style={{ viewTransitionName: nomTransition(ingredient) }}
      className="vt-ligne-courses relative flex items-center"
    >
      {/* <div> et non <span> : e2e/courses.spec.ts cible
          `li.last().locator("span").first()` pour vérifier le rayé. */}
      {nonceAtterrissage !== null && (
        <PulsationAtterrissage
          key={nonceAtterrissage}
          onFin={() => onFinAtterrissage?.(nonceAtterrissage)}
        />
      )}
      <label
        className={`relative flex min-h-11 flex-1 cursor-pointer items-center gap-3 py-2.5 transition-colors ${
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
        {aQuantiteRenseignee(ingredient) && (
          <span
            className={`shrink-0 text-sm font-medium ${
              coche ? `line-through ${couleurQuantite} opacity-40` : couleurQuantite
            }`}
          >
            {formaterQuantite(ingredient)}
          </span>
        )}
      </label>
      {/* Article manuel (#216) : édition en place + suppression, HORS du
          <label> (pas d'imbrication d'interactifs). */}
      {onModifier && (
        <button
          type="button"
          onClick={onModifier}
          aria-label={`Modifier « ${ingredient.nom} »`}
          className={`relative flex size-8 shrink-0 items-center justify-center rounded-full text-brand-700/70 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            placard ? "mr-1" : "mr-2"
          }`}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      )}
      {onSupprimer && (
        <button
          type="button"
          onClick={onSupprimer}
          aria-label={`Supprimer « ${ingredient.nom} »`}
          className={`relative flex size-8 shrink-0 items-center justify-center rounded-full text-brand-700/70 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            placard ? "mr-2" : "mr-3"
          }`}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      )}
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
