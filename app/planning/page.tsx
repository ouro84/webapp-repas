"use client";

// Page Planning — génération et affichage du planning hebdomadaire (US-01, US-04)
//
// États d'interface (RG-09) : vide (avant toute génération), chargement,
// erreur, chargé. Le planning est persisté en localStorage sous la clé
// "planning_courant" (section 5.6) et relu au montage.
//
// localStorage est un système externe à React : il est branché via
// useSyncExternalStore (pattern recommandé par React — la règle ESLint
// react-hooks/set-state-in-effect interdit le setState synchrone dans un
// useEffect au montage). Le mini-store vit dans lib/stockage.ts (partagé
// avec la page Courses). Côté serveur, le snapshot vaut null : la page est
// prérendue en état vide, puis hydratée avec le planning sauvegardé.
//
// Responsive (RG-06 à RG-08) : liste verticale par jour en mobile,
// grille 7 colonnes à partir de md (≥ 768px).

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
  ORDRE_JOURS,
  recettesUtilisees,
  retirerCreneauxDesactives,
  type PreferencesRecettes,
} from "@/lib/generateur";
import { editerSlot, MESSAGES_EDITION } from "@/lib/edition-slot";
import { estRaccourciAnnuler } from "@/lib/raccourci-annuler";
import {
  storePlanning,
  storeVuePlanning,
  sauvegarderPlanningComplet,
  sauvegarderRemplacementSlot,
  capturerSnapshotAnnulation,
  restaurerSnapshotAnnulation,
} from "@/lib/stockage";
import { personnesDuSlot } from "@/lib/personnes";
import { estRestes } from "@/lib/restes";
import { lireLienCycle, PARAM_LIEN_CYCLE } from "@/lib/lien-cycle";
import { lireLienSemaine, PARAM_LIEN_SEMAINE } from "@/lib/lien-semaine";
import { naviguerVers, useSemaineAffichee, useSync } from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { chargerPreferences } from "@/lib/preferences";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";
import {
  decalageEntre,
  formaterSemaine,
  libelleRelatif,
  semaineDecalee,
  semaineISO,
} from "@/lib/semaines";
import { ancreDeSemaine, versISO } from "@/lib/cycles";
import { datesDeSemaine, libellePlageDates } from "@/lib/planning-affichage";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { parseApiError } from "@/lib/errors";
import {
  FILET_ATTERRISSAGE_MS,
  SEUIL_ATTENTE_MS,
  delaiAtterrissage,
  delaiNom,
  jourAtterrissage,
} from "@/lib/choregraphie-generation";

// Plage de navigation de l'historique (#5) : 12 semaines passées → +6 futures.
const SEMAINES_PASSEES = 12;
const SEMAINES_FUTURES = 6;
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { FicheRecette } from "@/components/planning/fiche-recette";
import { EntetePlanning, type VuePlanning } from "@/components/planning/entete-planning";
import { EtatVidePlanning } from "@/components/planning/etat-vide-planning";
import { NavigateurPeriode } from "@/components/planning/navigateur-periode";
import { VuePlanningCycle } from "@/components/planning/vue-cycle";
import { SlotRepas } from "@/components/planning/slot-repas";
import { GrilleJours, type JourGrille } from "@/components/planning/grille-jours";
import { ConfirmationModale } from "@/components/ui/confirmation";
import { PulsationAtterrissage } from "@/components/ui/pulsation-atterrissage";
import type { Jour, JourPlanning, Planning, Recette } from "@/types";

type TypeRepas = "dejeuner" | "diner";

// ============================================================================
// Libellés & styles
// ============================================================================

// Libellés des jours, pour les noms accessibles des actions de slot et le titre
// du sélecteur (« Dîner de lundi »). Les en-têtes de la grille, datés, viennent
// de lib/planning-affichage.ts (GrilleJours, #352).
const LIBELLES_JOURS: Record<Jour, { complet: string }> = {
  lundi: { complet: "Lundi" },
  mardi: { complet: "Mardi" },
  mercredi: { complet: "Mercredi" },
  jeudi: { complet: "Jeudi" },
  vendredi: { complet: "Vendredi" },
  samedi: { complet: "Samedi" },
  dimanche: { complet: "Dimanche" },
};

function cleSlot(jour: Jour, typeRepas: TypeRepas): string {
  return `${jour}-${typeRepas}`;
}

// formaterSemaine ("2026-W23" → "Semaine du 1 juin 2026") vit dans lib/semaines.ts.

// Vrai uniquement après hydratation côté navigateur — sans setState (motif
// partagé avec la page courses). Le sélecteur de semaine (US-11) dépend de la
// date du client (défaut week-end → semaine prochaine) : on ne le rend
// qu'après hydratation pour éviter tout mismatch SSR.
function useHydratation(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner (week-end) puis dîner.
// `recette` est absente soit pour un planning antérieur à 14 repas (#3), soit
// pour un créneau désactivé (« Aucun », #217, RG-44) — les deux cas affichent
// un emplacement conservé à l'état vide (SlotRepas), jamais une case masquée.
function slotsDuJour(
  jp: JourPlanning
): { typeRepas: TypeRepas; libelle: string; recette: Recette | undefined }[] {
  return [
    { typeRepas: "dejeuner" as const, libelle: "Déjeuner", recette: jp.dejeuner },
    { typeRepas: "diner" as const, libelle: "Dîner", recette: jp.diner },
  ];
}

// ============================================================================
// Annulation (US-09, RG-19)
// ============================================================================

// Identifiant unique du toast d'annulation : réutiliser le même id fait qu'une
// nouvelle action remplace le toast précédent (et réarme les ~5 s) — un seul
// cran d'undo est proposé à la fois (RG-19), ce qui neutralise aussi le
// double-clic sur « Régénérer ».
const ID_TOAST_ANNULATION = "annulation-planning";

// Restaure le dernier snapshot (planning + coches, RG-19) et notifie.
// Renvoie true si une annulation a eu lieu (snapshot présent et non expiré).
// Partagée par le bouton « Annuler » du toast et par le raccourci Ctrl/Cmd+Z.
function annulerDerniereAction(): boolean {
  const restaure = restaurerSnapshotAnnulation();
  if (restaure) {
    toast.dismiss(ID_TOAST_ANNULATION);
    toast.success("Annulé");
  }
  return restaure;
}

// Arrivée du premier planning (#337) : View Transition état vide → grille,
// fondu de la racine ≈ 220 ms (bloc (3) de globals.css, activé par
// `data-vt="generation"` pour ne pas toucher aux règles de /courses). Garde JS
// reduced-motion (même motif que avecTransition de /courses) : sans API ou
// sous reduced motion, mise à jour directe. `flushSync` : le callback ne
// capture que le rendu synchrone. `ready` rejette (AbortError) si la
// transition est sautée : toujours catché.
function avecTransitionGeneration(majEtat: () => void): ViewTransition | null {
  const reduireAnimations = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduireAnimations) {
    majEtat();
    return null;
  }
  const racine = document.documentElement;
  racine.dataset.vt = "generation";
  const transition = document.startViewTransition(() => {
    flushSync(majEtat);
  });
  const nettoyer = () => {
    delete racine.dataset.vt;
  };
  transition.finished.then(nettoyer, nettoyer);
  transition.ready.catch(() => {});
  return transition;
}

// ============================================================================
// Composant page
// ============================================================================

function ContenuPlanning() {
  // Planning persisté (système externe) : null = état vide (RG-09).
  const brut = useSyncExternalStore(
    storePlanning.sAbonner,
    storePlanning.lire,
    storePlanning.lireServeur
  );
  // Message d'échec de la dernière génération (RG-09 état erreur), ou null.
  const [erreurGeneration, setErreurGeneration] = useState<string | null>(null);
  // Génération serveur en cours (#2 : la génération est désormais asynchrone).
  const [enGeneration, setEnGeneration] = useState(false);
  // Nonce de stagger (#69, P17) : bumpé à chaque génération pour rejouer
  // l'apparition séquentielle des cartes. La génération ne vide pas l'écran
  // (#63) → les <li key={jour}> ne se remontent pas seuls ; on keye donc la
  // grille sur ce nonce pour forcer le remontage et rejouer l'animation. Pas
  // bumpé sur un remplacement de slot / changement de personnes (sinon la
  // grille entière re-animerait à chaque petite édition — sautillant).
  const [genNonce, setGenNonce] = useState(0);
  // Chorégraphie de génération (#337, lib/choregraphie-generation.ts).
  // `attenteVisible` : posé seulement si la réponse dépasse SEUIL_ATTENTE_MS
  // (libellé « Je compose ta semaine… », respiration de l'aperçu, grille
  // existante en semi-transparence). `choregraphie` : de l'arrivée jusqu'au
  // toast ; porte le jour d'atterrissage (aujourd'hui, ou null). Comme
  // genNonce, n'est posée QUE par genererNouveauPlanning.
  const [attenteVisible, setAttenteVisible] = useState(false);
  const [choregraphie, setChoregraphie] = useState<{ jour: Jour | null } | null>(null);
  // Toasts de la génération, différés jusqu'à la fin de l'atterrissage.
  const toastsEnAttente = useRef<(() => void) | null>(null);
  const minuteurChoregraphie = useRef<number | null>(null);
  function terminerChoregraphie(): void {
    if (minuteurChoregraphie.current !== null) {
      window.clearTimeout(minuteurChoregraphie.current);
      minuteurChoregraphie.current = null;
    }
    const afficher = toastsEnAttente.current;
    toastsEnAttente.current = null;
    setChoregraphie(null);
    afficher?.();
  }
  // Démontage en pleine chorégraphie : les toasts (dont l'undo) partent quand même.
  useEffect(
    () => () => {
      if (minuteurChoregraphie.current !== null) window.clearTimeout(minuteurChoregraphie.current);
      const afficher = toastsEnAttente.current;
      toastsEnAttente.current = null;
      afficher?.();
    },
    []
  );
  // Slot dont le dernier remplacement a échoué (RG-04) : "jour-typeRepas".
  const [slotIndisponible, setSlotIndisponible] = useState<string | null>(null);
  // Slot en cours de sélection manuelle (US-06) : le sélecteur est monté
  // tant que cette valeur est non nulle.
  const [slotEnSelection, setSlotEnSelection] = useState<{
    jour: Jour;
    typeRepas: TypeRepas;
  } | null>(null);
  // Recette consultée (US-10) : la fiche est montée tant que cette valeur est
  // non nulle. `personnes` fige l'échelle d'affichage (RG-20) du slot ouvert.
  const [ficheOuverte, setFicheOuverte] = useState<{
    recette: Recette;
    personnes: number;
  } | null>(null);
  // Recettes de l'utilisateur (globales + perso) chargées depuis Supabase (#2),
  // annotées `editable` pour le raccourci « Modifier » de la fiche (US-10).
  // Servent aussi le sélecteur manuel (#14) et le remplacement aléatoire.
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  // Réglages de génération (#45) : pilotent l'éligibilité du remplacement
  // unitaire « ↺ changer » (la génération complète les lit côté serveur).
  // Défaut tant que non chargés = comportement antérieur.
  const [reglages, setReglages] = useState(REGLAGES_DEFAUT);
  // Favoris/évités du foyer (#219) : pilotent le biais du remplacement unitaire
  // « ↺ changer » (RG-62 ; la génération complète les lit côté serveur, RG-61).
  // Défaut Map vide tant que non chargées = comportement antérieur (uniforme).
  const [preferences, setPreferences] = useState<PreferencesRecettes>(new Map());
  // Jour de courses du foyer (#279) : nécessaire pour dériver l'ancre du cycle
  // qui contient la semaine affichée (lien « Liste de courses → »). Fail-open
  // lundi (1), même repli que VuePlanningCycle/hydraterCycle.
  const [jourCourses, setJourCourses] = useState(1);
  // Confirmation avant de régénérer/modifier une semaine PASSÉE (US-14, RG-24).
  // Contient l'action à rejouer (avec `force`) une fois l'utilisateur d'accord.
  const [confirmation, setConfirmation] = useState<{
    executer: () => void;
  } | null>(null);
  // Vue affichée (#260, PR3) : « semaine » (calendaire, driver quotidien, défaut)
  // ou « cycle » (fenêtre de courses, lecture seule). Persistée (#279, D5) via
  // storeVuePlanning — un choix explicite pour la vue Cycle survit au reload.
  const vueBrute = useSyncExternalStore(
    storeVuePlanning.sAbonner,
    storeVuePlanning.lire,
    storeVuePlanning.lireServeur
  );
  // Lien profond `/planning?cycle=AAAA-MM-JJ` (#320, RG-87) : lu UNE fois, à
  // l'initialisation (les états lazy ignorent le retrait du paramètre
  // ci-dessous). Une date mal formée donne `lienCycle = null`
  // (ignorée sans message), mais le paramètre est retiré quand même. Le lien
  // n'est donc pas relu par une navigation client depuis /planning : un lien
  // interne devrait faire une navigation pleine page (cf. courses-cycle.md).
  const paramsUrl = useSearchParams();
  const [lienCycle] = useState(() => lireLienCycle(paramsUrl.get(PARAM_LIEN_CYCLE)));
  const [paramLienPresent] = useState(() => paramsUrl.has(PARAM_LIEN_CYCLE));
  // Vrai tant que le lien force la vue Cycle ; un clic sur la bascule le coupe.
  const [lienActif, setLienActif] = useState(lienCycle !== null);
  // Lien `/planning?semaine=AAAA-Wnn` (#336, depuis /ce-soir) : même principe,
  // lu une fois ; ouvre la vue Semaine sur la semaine du repas (sinon le
  // week-end afficherait la suivante). Ignoré si un lien de cycle est présent.
  const [lienSemaine] = useState(() =>
    lienCycle !== null
      ? null
      : lireLienSemaine(paramsUrl.get(PARAM_LIEN_SEMAINE), new Date(), SEMAINES_PASSEES, SEMAINES_FUTURES)
  );
  const [paramSemainePresent] = useState(() => paramsUrl.has(PARAM_LIEN_SEMAINE));
  const [lienSemaineActif, setLienSemaineActif] = useState(lienSemaine !== null);
  // Retrait par `history.replaceState`, comme le relais `?ancre=` de /courses :
  // `router.replace("/planning")` est sans effet en build de prod, où la page
  // statique initialise le routeur sur `/planning` (déjà l'URL « courante »).
  // Next synchronise `useSearchParams` avec l'History API native.
  useEffect(() => {
    if (!paramLienPresent && !paramSemainePresent) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAM_LIEN_CYCLE);
    url.searchParams.delete(PARAM_LIEN_SEMAINE);
    window.history.replaceState(window.history.state, "", url);
  }, [paramLienPresent, paramSemainePresent]);
  // Le lien force la vue Cycle pour la visite SANS écrire storeVuePlanning : la
  // vue préférée enregistrée reste celle de tous les jours.
  const vue: VuePlanning = lienSemaineActif
    ? "semaine"
    : lienActif || vueBrute === "cycle"
      ? "cycle"
      : "semaine";
  function setVue(v: VuePlanning): void {
    // Choix explicite : écrit la préférence (comportement existant) et
    // désactive le lien pour le reste de la visite.
    setLienActif(false);
    setLienSemaineActif(false);
    storeVuePlanning.ecrire(v);
  }

  // Liste plate des recettes (sélecteur, remplacement aléatoire) + ensemble des
  // ids MODIFIABLES depuis la fiche (#137) — dérivés des recettes gérées.
  const recettes = useMemo<Recette[]>(
    () => recettesGerees.map((r) => r.recette),
    [recettesGerees]
  );
  // Toutes les recettes du catalogue chargé (perso + par défaut non masquées,
  // chargerRecettesGerees excluant déjà les masquées, #105) : pour ces ids, le
  // deep-link `/recettes?edition=<id>` trouvera la recette → raccourci « Modifier »
  // proposé. Une recette du slot absente d'ici (fixture hors-base, masquée) ne
  // l'a pas, ce qui évite un lien mort.
  const idsModifiables = useMemo<ReadonlySet<string>>(
    () => new Set(recettesGerees.map((r) => r.recette.id)),
    [recettesGerees]
  );
  const hydrate = useHydratation();
  // Synchro + historique : useSync hydrate la semaine affichée au montage et
  // pousse les changements (indicateur) ; useSemaineAffichee donne la semaine
  // courante affichée (navigation #5).
  const etatSync = useSync(lienSemaine);
  const semaineAffichee = useSemaineAffichee();

  // Chargement des recettes au montage (système externe asynchrone : setState
  // dans une promesse, pas en synchrone au montage → conforme à la règle ESLint).
  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (actif) setRecettesGerees(liste);
      })
      .catch((erreur) => {
        // Sans feedback, « changer »/« sélectionner » opéreraient sur un vivier
        // vide → « Pas de recette disponible » trompeur (#166). On le signale.
        console.error("Chargement des recettes échoué.", erreur);
        if (actif) {
          toast.error("Catalogue de recettes indisponible. Réessaie plus tard.", {
            id: "chargement-recettes",
          });
        }
      });
    // Réglages de génération (#45) : indépendants des recettes, défauts si échec.
    chargerReglages()
      .then((r) => {
        if (actif) setReglages(r);
      })
      .catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
      });
    // Favoris/évités (#219) : indépendants des recettes/réglages, Map vide
    // (comportement uniforme) si échec — jamais de blocage du remplacement.
    chargerPreferences()
      .then((p) => {
        if (actif) setPreferences(p);
      })
      .catch((erreur) => {
        console.error("Chargement des préférences échoué (biais ignoré).", erreur);
      });
    chargerJourCoursesFoyer()
      .then((j) => {
        if (actif) setJourCourses(j);
      })
      .catch((erreur) => {
        console.error("Chargement du jour de courses échoué (défaut lundi).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  // Raccourci Ctrl/Cmd+Z (US-09, RG-19) : annule la dernière action, hors champ
  // de saisie (`estRaccourciAnnuler`, partagé avec la vue Cycle). Actif en vue
  // Semaine seulement : la vue Cycle a son propre undo (#373), et un Ctrl+Z en
  // vue Cycle ne doit pas annuler une édition de semaine faite juste avant la
  // bascule. addEventListener, pas un setState au montage → conforme à la règle
  // ESLint set-state-in-effect.
  useEffect(() => {
    if (vue !== "semaine") return;
    function surTouche(e: KeyboardEvent): void {
      // preventDefault uniquement si une annulation a réellement eu lieu,
      // pour ne pas confisquer Ctrl+Z quand il n'y a rien à annuler.
      if (estRaccourciAnnuler(e) && annulerDerniereAction()) e.preventDefault();
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [vue]);

  const planning = useMemo<Planning | null>(() => {
    if (brut === null) return null;
    try {
      return JSON.parse(brut) as Planning;
    } catch (erreur) {
      // Donnée corrompue : on la signale et on retombe en état vide.
      // La prochaine génération écrasera la valeur illisible.
      console.error(`localStorage["planning_courant"] illisible.`, erreur);
      return null;
    }
  }, [brut]);

  // Navigation entre semaines (US-14, #5). La date courante dépend du client →
  // calculée une fois hydraté (motif useHydratation, pas de mismatch SSR).
  // `offsetAffiche` = position de la semaine affichée vs la semaine courante.
  const navPret = hydrate && semaineAffichee !== null;
  const offsetAffiche = navPret
    ? decalageEntre(semaineISO(new Date()), semaineAffichee)
    : 0;
  const peutReculer = navPret && offsetAffiche > -SEMAINES_PASSEES;
  const peutAvancer = navPret && offsetAffiche < SEMAINES_FUTURES;
  // Props du navigateur de période (#352) : libellé relatif + plage de dates
  // (mêmes helpers que la vue Cycle, lib/planning-affichage.ts).
  const periodeSemaine = {
    libelle: libelleRelatif(offsetAffiche),
    dates: navPret
      ? (() => {
          const jours = datesDeSemaine(semaineAffichee);
          return libellePlageDates(jours[0], jours[6]);
        })()
      : "",
    courante: offsetAffiche === 0,
    peutReculer,
    peutAvancer,
  };
  function allerSemaine(delta: number): void {
    if (semaineAffichee) void naviguerVers(semaineDecalee(semaineAffichee, delta));
  }
  // Navigateur de semaines (#5, #352), partagé par l'état vide et l'en-tête de
  // l'état chargé — après hydratation seulement (date client).
  const navigateurSemaine = navPret ? (
    <NavigateurPeriode
      unite="semaine"
      {...periodeSemaine}
      onPrecedente={() => allerSemaine(-1)}
      onSuivante={() => allerSemaine(1)}
      disabled={enGeneration}
    />
  ) : null;

  // Garde-fou « semaine passée » (US-14, RG-24) : régénérer ou modifier un
  // planning déjà passé demande confirmation. `reprise` est l'action à rejouer
  // (avec `force = true`) si l'utilisateur confirme. Renvoie `true` si une
  // confirmation a été demandée → l'appelant s'arrête là.
  function confirmerSiPassee(reprise: () => void): boolean {
    if (offsetAffiche < 0 && planning !== null) {
      setConfirmation({ executer: reprise });
      return true;
    }
    return false;
  }

  // Génération (US-01) : déléguée au serveur (#2, route /api/planning/generer)
  // qui lit les recettes de l'utilisateur (globales + perso) sous RLS et
  // applique lib/generateur. Le planning renvoyé est persisté en localStorage
  // (la persistance en base est un chantier distinct). Asynchrone → état
  // `enGeneration` pour le retour visuel, sans vider l'écran (#63).
  async function genererNouveauPlanning(force = false): Promise<void> {
    if (enGeneration) return;
    // Régénération d'une semaine passée (planning existant) : confirmation
    // avant écrasement (RG-24). Première génération (planning null) : direct.
    if (!force && confirmerSiPassee(() => void genererNouveauPlanning(true))) {
      return;
    }
    // Une chorégraphie précédente encore en cours : on la solde (toasts).
    if (toastsEnAttente.current !== null || minuteurChoregraphie.current !== null) {
      terminerChoregraphie();
    }
    setEnGeneration(true);
    setErreurGeneration(null);
    // Phase d'attente sautée si la réponse arrive avant le seuil (#337) ;
    // aucune latence artificielle.
    const minuteurAttente = window.setTimeout(() => setAttenteVisible(true), SEUIL_ATTENTE_MS);
    try {
      // Génère pour la semaine affichée (US-14) ; le serveur valide la plage.
      const reponse = await fetch("/api/planning/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(semaineAffichee ? { semaine: semaineAffichee } : {}),
      });
      if (!reponse.ok) {
        setErreurGeneration(await parseApiError(reponse));
        return;
      }
      const {
        planning: nouveau,
        vegeNonHonore = 0,
        mixNonHonore = 0,
        saisonNonHonore = 0,
      } = (await reponse.json()) as {
        planning: Planning;
        vegeNonHonore?: number;
        mixNonHonore?: number;
        saisonNonHonore?: number;
      };
      // Régénération (US-09) : un planning existait → on fige l'état (planning
      // + coches) avant écrasement pour permettre l'undo (RG-19). Première
      // génération : rien à annuler (capturerSnapshot est alors un no-op).
      const estRegeneration = storePlanning.lire() !== null;
      capturerSnapshotAnnulation();
      // Toast contextualisé par la semaine générée (US-11, bonus) + préférences
      // souples non honorées (vivier insuffisant) — RG-26 (végé), RG-27 (≥1
      // légume/jour), RG-28 (saison) : on informe sans bloquer. La construction
      // des messages (accord singulier/pluriel) est extraite et testée à part
      // (#168, lib/avertissements-generation.ts). Affichés APRÈS l'atterrissage.
      const libelleSemaine = formaterSemaine(nouveau.semaine);
      const afficherToasts = () => {
        if (estRegeneration) {
          toast(`Planning régénéré — ${libelleSemaine}`, {
            id: ID_TOAST_ANNULATION,
            action: { label: "Annuler", onClick: annulerDerniereAction },
            duration: 5000,
          });
        } else {
          toast.success(`Planning généré — ${libelleSemaine}`);
        }
        for (const message of messagesAvertissementGeneration({
          vegeNonHonore,
          mixNonHonore,
          saisonNonHonore,
        })) {
          toast.warning(message);
        }
      };
      // Chorégraphie (#337) : rien sous reduced motion (changement d'état
      // instantané, toasts immédiats) ; sinon atterrissage sur aujourd'hui si
      // la semaine générée est la courante.
      const reduireAnimations = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const nbJours = nouveau.jours.length;
      const jour = reduireAnimations
        ? null
        : jourAtterrissage(nouveau.semaine, nouveau.jours.map((j) => j.jour), new Date());
      window.clearTimeout(minuteurAttente);
      const appliquer = () => {
        // Génération complète : réinitialise aussi les coches de la liste
        // de courses (RG-13) — règle centralisée dans lib/stockage.ts.
        sauvegarderPlanningComplet(nouveau);
        setSlotIndisponible(null);
        // Rejoue le stagger d'apparition des cartes (#69) : nouvelle key de grille.
        setGenNonce((n) => n + 1);
        setAttenteVisible(false);
        setChoregraphie(reduireAnimations ? null : { jour });
      };
      if (estRegeneration) {
        appliquer();
      } else {
        // Première génération : état vide → grille en View Transition. On
        // attend la fin du callback pour que l'instantané « avant » garde le
        // bouton en attente (le finally ci-dessous le réactive).
        await avecTransitionGeneration(appliquer)?.updateCallbackDone.catch((erreur: unknown) => {
          console.error("Transition de génération interrompue.", erreur);
        });
      }
      if (jour !== null) {
        // Toasts à la fin de l'atterrissage (onFin), filet si animationend
        // ne vient pas (onglet masqué).
        toastsEnAttente.current = afficherToasts;
        minuteurChoregraphie.current = window.setTimeout(
          terminerChoregraphie,
          delaiAtterrissage(nbJours) + FILET_ATTERRISSAGE_MS
        );
      } else {
        afficherToasts();
        if (!reduireAnimations) {
          minuteurChoregraphie.current = window.setTimeout(
            terminerChoregraphie,
            delaiAtterrissage(nbJours)
          );
        }
      }
    } catch (erreur) {
      console.error("Génération du planning échouée.", erreur);
      setErreurGeneration(
        "Impossible de générer le planning. Vérifie ta connexion et réessaie."
      );
    } finally {
      window.clearTimeout(minuteurAttente);
      setAttenteVisible(false);
      setEnGeneration(false);
    }
  }

  // Remplacement d'un slot (US-04, RG-04) : si aucune recette éligible
  // n'est disponible, le slot concerné affiche "Pas de recette disponible".
  function changerSlot(jour: Jour, typeRepas: TypeRepas, force = false): void {
    if (planning === null) return;
    if (!force && confirmerSiPassee(() => changerSlot(jour, typeRepas, true))) {
      return;
    }
    // Calcul partagé avec la vue Cycle (lib/edition-slot.ts).
    const edition = editerSlot(planning, jour, typeRepas, {
      type: "changer",
      recettes,
      reglages,
      preferences,
    });
    if (!edition.ok) {
      if (edition.motif === "indisponible") {
        // Toast en complément du message inline du slot (RG-04)
        setSlotIndisponible(cleSlot(jour, typeRepas));
        toast.error(MESSAGES_EDITION.indisponible);
      }
      return; // slot inexistant : impossible depuis l'UI
    }
    // Snapshot avant écrasement pour l'undo (US-09, RG-19).
    capturerSnapshotAnnulation();
    // Remplacement individuel : les coches sont conservées, l'invalidation
    // par quantité (RG-12) protège les articles dont l'agrégat change.
    sauvegarderRemplacementSlot(edition.planning);
    setSlotIndisponible(null);
    toast(MESSAGES_EDITION.remplacee, {
      id: ID_TOAST_ANNULATION,
      action: { label: "Annuler", onClick: annulerDerniereAction },
      duration: 5000,
    });
    // Préférences souples non honorées, sans bloquer le remplacement, dans
    // l'ordre végé (RG-26, #86 PR2), légume (RG-27, #49 PR2), saison (RG-28,
    // #23 PR2).
    for (const avertissement of edition.avertissements) {
      toast.warning(MESSAGES_EDITION.avertissements[avertissement]);
    }
  }

  // Sélection manuelle (US-06, RG-15) : remplace le slot par la recette
  // choisie — by-pass RG-01/RG-02, ne peut pas échouer depuis l'UI.
  function selectionnerRecette(recette: Recette): void {
    if (planning === null || slotEnSelection === null) return;
    // Capture du slot : le sélecteur se ferme après le choix (slotEnSelection
    // repasse à null), or une confirmation différée (semaine passée, RG-24)
    // s'exécute plus tard → on fige la cible plutôt que de relire l'état.
    const cible = slotEnSelection;
    if (confirmerSiPassee(() => appliquerSelection(recette, cible))) return;
    appliquerSelection(recette, cible);
  }

  function appliquerSelection(
    recette: Recette,
    cible: { jour: Jour; typeRepas: TypeRepas }
  ): void {
    if (planning === null) return;
    const edition = editerSlot(planning, cible.jour, cible.typeRepas, {
      type: "selectionner",
      recette,
    });
    if (!edition.ok) return; // slot inexistant : impossible depuis l'UI
    // Snapshot avant écrasement pour l'undo (US-09, RG-19).
    capturerSnapshotAnnulation();
    sauvegarderRemplacementSlot(edition.planning);
    // Un éventuel « Pas de recette disponible » sur ce slot est obsolète (RG-15).
    setSlotIndisponible(null);
    toast(MESSAGES_EDITION.remplacee, {
      id: ID_TOAST_ANNULATION,
      action: { label: "Annuler", onClick: annulerDerniereAction },
      duration: 5000,
    });
  }

  // Nombre de personnes d'un slot (US-07, RG-16/17) : la liste de courses
  // se met à l'échelle, les coches des articles touchés sont invalidées par
  // la variation de quantité (RG-12). Écriture sans reset des coches.
  function changerPersonnes(
    jour: Jour,
    typeRepas: TypeRepas,
    personnes: number
  ): void {
    if (planning === null) return;
    const edition = editerSlot(planning, jour, typeRepas, {
      type: "personnes",
      personnes,
    });
    if (!edition.ok) return; // slot inexistant : impossible depuis l'UI
    sauvegarderRemplacementSlot(edition.planning);
  }

  // Marque / démarque un slot « restes » (US-12, RG-22). Écriture sans reset
  // des coches (l'invalidation par quantité RG-12 ajuste la liste de courses).
  // Snapshot pour l'undo (#62), comme les autres modifications de slot.
  function changerRestes(
    jour: Jour,
    typeRepas: TypeRepas,
    valeur: boolean,
    force = false
  ): void {
    if (planning === null) return;
    if (
      !force &&
      confirmerSiPassee(() => changerRestes(jour, typeRepas, valeur, true))
    ) {
      return;
    }
    const edition = editerSlot(planning, jour, typeRepas, {
      type: "restes",
      valeur,
    });
    if (!edition.ok) return; // slot inexistant : impossible depuis l'UI
    capturerSnapshotAnnulation();
    sauvegarderRemplacementSlot(edition.planning);
    setSlotIndisponible(null);
    toast(MESSAGES_EDITION.restes(valeur), {
      id: ID_TOAST_ANNULATION,
      action: { label: "Annuler", onClick: annulerDerniereAction },
      duration: 5000,
    });
  }

  // --- État erreur (RG-09) ---
  if (erreurGeneration !== null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="font-medium text-red-800">La génération a échoué</p>
          <p className="mt-1 text-sm text-red-700">{erreurGeneration}</p>
        </div>
        <button
          type="button"
          onClick={() => void genererNouveauPlanning()}
          disabled={enGeneration}
          aria-busy={enGeneration}
          className="rounded-full bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
        >
          {attenteVisible ? "Je compose ta semaine…" : "Réessayer"}
        </button>
      </main>
    );
  }

  // Ancre du cycle qui contient la semaine affichée (#279, D4) — utilisée par
  // les liens « Liste de courses → » de la vue Semaine (vide et chargée).
  const ancreCourses = semaineAffichee ? ancreDeSemaine(semaineAffichee, jourCourses) : null;

  // --- Vue CYCLE (#260, PR3) : calée sur la fenêtre de courses. Court-circuite
  // les états semaine (vide/chargé) : le cycle peut avoir des repas même si la
  // semaine affichée est vide, et inversement. L'en-tête, l'état vide et le
  // navigateur sont rendus par la vue elle-même (gabarit partagé, #352). ---
  if (vue === "cycle") {
    return (
      <main id="contenu" className="flex flex-1 flex-col">
        <VuePlanningCycle
          idsModifiables={idsModifiables}
          lienCycle={lienActif ? lienCycle ?? undefined : undefined}
          vue={vue}
          onChangerVue={setVue}
        />
      </main>
    );
  }

  // --- État vide (RG-09) : semaine affichée sans planning (#5) ---
  // Hero de la vitrine (#337), partagé avec la vue Cycle (#352).
  if (planning === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col">
        <EtatVidePlanning
          titre="Mon planning de la semaine"
          vue={vue}
          onChangerVue={setVue}
          navigateur={navigateurSemaine}
          enAttente={attenteVisible}
          message="Aucun planning pour cette semaine."
          libelleBouton="Générer mon planning"
          libelleAttente="Je compose ta semaine…"
          onGenerer={() => void genererNouveauPlanning()}
          generationEnCours={enGeneration}
        />
      </main>
    );
  }

  // --- État chargé : planning affiché ---
  // Filtre d'affichage (#217, RG-46) : un créneau désactivé masque son slot
  // immédiatement (grille + courses), même sans régénérer — le planning
  // PERSISTÉ (variable `planning`, ci-dessus) n'est lui jamais modifié, d'où
  // la réversibilité gratuite en réactivant le créneau. `recettesUtilisees`
  // (badge « déjà au planning » du sélecteur, RG-02) continue de lire le
  // planning brut : une recette d'un slot masqué reste bloquée ailleurs.
  const planningAffiche = retirerCreneauxDesactives(planning, reglages);
  // Grille commune (#352) : chaque jour porte sa date (semaine du planning
  // affiché, index du jour ISO) et ses deux SlotRepas. Le jour courant n'est
  // connu qu'après hydratation (date client, pas de mismatch SSR) ; le
  // week-end, la semaine par défaut est la suivante, donc aucun jour marqué.
  const datesSemaine = datesDeSemaine(planningAffiche.semaine);
  const aujourdhuiISO = navPret ? versISO(new Date()) : null;
  const joursGrille: JourGrille[] = planningAffiche.jours.map((jp, i) => {
    // Rang du jour dans sa semaine ISO (lundi = 0, ORDRE_JOURS) → sa date (#352).
    const dateISO = datesSemaine[ORDRE_JOURS.indexOf(jp.jour)];
    return {
      cle: jp.jour,
      dateISO,
      slots: slotsDuJour(jp).map((slot) => (
        <SlotRepas
          key={slot.typeRepas}
          libelle={slot.libelle}
          jourLabel={LIBELLES_JOURS[jp.jour].complet}
          recette={slot.recette}
          indisponible={slotIndisponible === cleSlot(jp.jour, slot.typeRepas)}
          personnes={personnesDuSlot(jp, slot.typeRepas)}
          onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
          onSelectionner={() =>
            setSlotEnSelection({ jour: jp.jour, typeRepas: slot.typeRepas })
          }
          onChangerPersonnes={(n) => changerPersonnes(jp.jour, slot.typeRepas, n)}
          onVoir={() =>
            slot.recette &&
            setFicheOuverte({
              recette: slot.recette,
              personnes: personnesDuSlot(jp, slot.typeRepas),
            })
          }
          restes={estRestes(jp, slot.typeRepas)}
          onChangerRestes={(valeur) => changerRestes(jp.jour, slot.typeRepas, valeur)}
          delaiNomMs={choregraphie ? delaiNom(i) : undefined}
          accentue={aujourdhuiISO !== null && dateISO === aujourdhuiISO}
        />
      )),
    };
  });
  return (
    <main id="contenu" className="flex-1 p-4 md:p-8">
      <EntetePlanning
        titre="Mon planning de la semaine"
        vue={vue}
        onChangerVue={setVue}
        libelleRegenerer={attenteVisible ? "Je compose ta semaine…" : "Régénérer"}
        onRegenerer={() => void genererNouveauPlanning()}
        regenerationEnCours={enGeneration}
        hrefCourses={ancreCourses ? `/courses?ancre=${ancreCourses}` : "/courses"}
        statut={
          // Indicateur de synchro (US-13, bonus) — discret, seulement hors état
          // nominal. La semaine s'affiche dans le navigateur ci-dessous (#5).
          etatSync !== "synchronise" ? (
            <p role="status" className="mt-0.5 text-xs text-brand-700/85">
              {etatSync === "sauvegarde"
                ? "Sauvegarde…"
                : "Hors-ligne — synchro au retour du réseau"}
            </p>
          ) : null
        }
        // Navigateur de semaines (#5) : change la semaine affichée ; la
        // génération/régénération vise la semaine affichée.
        navigateur={navigateurSemaine}
      />
      {/* Grille des jours commune avec la vue Cycle (#352) : liste en mobile,
          rangées alignées en desktop, jour courant marqué. Chorégraphie de
          génération (#337) : `genNonce` remonte la grille (entrée en cascade
          rejouée), `attenteVisible` l'estompe (toujours interactive), la
          pulsation d'atterrissage se pose sur la carte d'aujourd'hui (desktop :
          halo derrière la colonne) et les toasts partent à sa fin. */}
      <GrilleJours
        jours={joursGrille}
        aujourdhuiISO={aujourdhuiISO}
        cleAnimation={genNonce}
        enAttente={attenteVisible}
        animerEntree
        decor={(jour, _i, palier) =>
          choregraphie?.jour === jour.cle ? (
            <PulsationAtterrissage
              key={`atterrissage-${genNonce}`}
              delaiMs={delaiAtterrissage(planningAffiche.jours.length)}
              onFin={terminerChoregraphie}
              className={palier === "desktop" ? "-inset-2 rounded-xl" : undefined}
            />
          ) : null
        }
      />

      {/* Sélecteur de recette (US-06) — monté seulement pendant la sélection */}
      {slotEnSelection && (
        <SelecteurRecette
          titre={`${slotEnSelection.typeRepas === "diner" ? "Dîner" : "Déjeuner"} de ${LIBELLES_JOURS[slotEnSelection.jour].complet.toLowerCase()}`}
          recettes={recettes}
          idsAuPlanning={recettesUtilisees(planning)}
          onSelectionner={selectionnerRecette}
          onRestes={() =>
            changerRestes(slotEnSelection.jour, slotEnSelection.typeRepas, true)
          }
          onFermer={() => setSlotEnSelection(null)}
        />
      )}

      {/* Fiche de recette (US-10) — montée seulement pendant la consultation.
          `modifiable` = recette présente dans le catalogue chargé (#137). */}
      {ficheOuverte && (
        <FicheRecette
          recette={ficheOuverte.recette}
          personnes={ficheOuverte.personnes}
          modifiable={idsModifiables.has(ficheOuverte.recette.id)}
          onFermer={() => setFicheOuverte(null)}
        />
      )}

      {/* Confirmation avant de toucher une semaine passée (US-14, RG-24) —
          montée seulement quand une action a été différée. */}
      {confirmation && (
        <ConfirmationModale
          titre="Modifier une semaine passée ?"
          message="Cette semaine est déjà passée. Veux-tu vraiment modifier ce planning enregistré ?"
          libelleConfirmer="Modifier"
          onConfirmer={() => {
            const action = confirmation.executer;
            setConfirmation(null);
            action();
          }}
          onAnnuler={() => setConfirmation(null)}
        />
      )}
    </main>
  );
}

export default function PagePlanning() {
  // Frontière Suspense exigée par useSearchParams (Next 16, cf. app/courses/page.tsx).
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
      <ContenuPlanning />
    </Suspense>
  );
}
