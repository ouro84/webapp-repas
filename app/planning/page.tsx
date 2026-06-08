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

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
  recettesUtilisees,
  remplacerSlot,
  remplacerSlotManuel,
} from "@/lib/generateur";
import {
  storePlanning,
  sauvegarderPlanningComplet,
  sauvegarderRemplacementSlot,
  capturerSnapshotAnnulation,
  restaurerSnapshotAnnulation,
} from "@/lib/stockage";
import {
  modifierPersonnes,
  personnesDuSlot,
  PERSONNES_MAX,
  PERSONNES_MIN,
} from "@/lib/personnes";
import { estRestes, marquerRestes } from "@/lib/restes";
import { useSync } from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import {
  formaterSemaine,
  libelleRelatif,
  semaineParDefaut,
  semainesSelectionnables,
  type SemaineOption,
} from "@/lib/semaines";
import { parseApiError } from "@/lib/errors";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { Jour, JourPlanning, Planning, Recette } from "@/types";

type TypeRepas = "dejeuner" | "diner";

// ============================================================================
// Libellés & styles
// ============================================================================

// Libellés des jours : complet pour la liste mobile (RG-08), abrégé pour les
// en-têtes de la grille desktop (RG-07).
const LIBELLES_JOURS: Record<Jour, { complet: string; abrege: string }> = {
  lundi: { complet: "Lundi", abrege: "Lun" },
  mardi: { complet: "Mardi", abrege: "Mar" },
  mercredi: { complet: "Mercredi", abrege: "Mer" },
  jeudi: { complet: "Jeudi", abrege: "Jeu" },
  vendredi: { complet: "Vendredi", abrege: "Ven" },
  samedi: { complet: "Samedi", abrege: "Sam" },
  dimanche: { complet: "Dimanche", abrege: "Dim" },
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

// Sélecteur de la semaine cible de génération (US-11, RG-21) : stepper borné
// ‹ [libellé relatif + date] ›, motif cohérent avec le stepper de personnes.
function SelecteurSemaine({
  options,
  offsetCible,
  onChanger,
  disabled,
}: {
  options: SemaineOption[];
  offsetCible: number;
  onChanger: (semaine: string) => void;
  disabled?: boolean;
}) {
  const courant = options[offsetCible];
  if (!courant) return null;
  const peutReculer = offsetCible > 0;
  const peutAvancer = offsetCible < options.length - 1;
  const styleFleche =
    "relative flex size-8 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      role="group"
      aria-label="Choisir la semaine à générer"
      className="inline-flex items-center gap-2"
    >
      <button
        type="button"
        onClick={() => onChanger(options[offsetCible - 1]!.semaine)}
        disabled={disabled || !peutReculer}
        aria-label="Semaine précédente"
        className={styleFleche}
      >
        <ChevronSemaine direction="gauche" />
      </button>
      <span aria-live="polite" className="min-w-[10rem] text-center">
        <span className="block text-sm font-medium text-brand-900">
          {libelleRelatif(courant.offset)}
        </span>
        <span className="block text-xs text-brand-700/85">
          {formaterSemaine(courant.semaine)}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onChanger(options[offsetCible + 1]!.semaine)}
        disabled={disabled || !peutAvancer}
        aria-label="Semaine suivante"
        className={styleFleche}
      >
        <ChevronSemaine direction="droite" />
      </button>
    </div>
  );
}

// Chevron gauche/droite — SVG inline (pas de glyphe texte, cf. audit #51).
function ChevronSemaine({ direction }: { direction: "gauche" | "droite" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "gauche" ? "M10 4l-4 4 4 4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner (week-end) puis dîner.
function slotsDuJour(
  jp: JourPlanning
): { typeRepas: TypeRepas; libelle: string; recette: Recette }[] {
  const slots: { typeRepas: TypeRepas; libelle: string; recette: Recette }[] =
    [];
  if (jp.dejeuner) {
    slots.push({ typeRepas: "dejeuner", libelle: "Déjeuner", recette: jp.dejeuner });
  }
  slots.push({ typeRepas: "diner", libelle: "Dîner", recette: jp.diner });
  return slots;
}

// ============================================================================
// Annulation (US-09, RG-19)
// ============================================================================

// Identifiant unique du toast d'annulation : réutiliser le même id fait qu'une
// nouvelle action remplace le toast précédent (et réarme les ~5 s) — un seul
// cran d'undo est proposé à la fois (RG-19), ce qui neutralise aussi le
// double-clic sur « Regénérer ».
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

// ============================================================================
// Composant page
// ============================================================================

export default function PagePlanning() {
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

  // Liste plate des recettes (sélecteur, remplacement aléatoire) + ensemble des
  // ids éditables (recettes perso) pour la fiche — dérivés des recettes gérées.
  const recettes = useMemo<Recette[]>(
    () => recettesGerees.map((r) => r.recette),
    [recettesGerees]
  );
  const idsEditables = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        recettesGerees.filter((r) => r.editable).map((r) => r.recette.id)
      ),
    [recettesGerees]
  );
  const [semaineChoisie, setSemaineChoisie] = useState<string | null>(null);
  const hydrate = useHydratation();
  // Synchro multi-device (US-13) : hydrate le planning depuis la base au
  // montage et pousse les changements ; renvoie l'état pour l'indicateur.
  const etatSync = useSync();

  // Chargement des recettes au montage (système externe asynchrone : setState
  // dans une promesse, pas en synchrone au montage → conforme à la règle ESLint).
  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (actif) setRecettesGerees(liste);
      })
      .catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  // Raccourci Ctrl/Cmd+Z (US-09, RG-19) : annule la dernière action. On ignore
  // la frappe dans un champ de saisie (recherche du sélecteur de recette), où
  // Ctrl+Z doit rester l'annulation native du texte. addEventListener, pas un
  // setState au montage → conforme à la règle ESLint set-state-in-effect.
  useEffect(() => {
    function surTouche(e: KeyboardEvent): void {
      if (
        (e.key === "z" || e.key === "Z") &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey
      ) {
        const cible = e.target as HTMLElement | null;
        if (
          cible &&
          (cible.tagName === "INPUT" ||
            cible.tagName === "TEXTAREA" ||
            cible.isContentEditable)
        ) {
          return;
        }
        // preventDefault uniquement si une annulation a réellement eu lieu,
        // pour ne pas confisquer Ctrl+Z quand il n'y a rien à annuler.
        if (annulerDerniereAction()) e.preventDefault();
      }
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

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

  // Sélecteur de semaine cible (US-11, RG-21). Plage et défaut dépendent de la
  // date du client → calculés une fois hydraté (motif useHydratation) pour
  // éviter tout mismatch SSR. Défaut : la semaine du planning actif si elle est
  // dans la plage (« Regénérer » = même semaine), sinon le défaut RG-21
  // (semaine courante, ou prochaine le week-end). `semaineChoisie` n'est posé
  // que par l'utilisateur (clic) — jamais en effet → conforme set-state-in-effect.
  const semainesDispo = useMemo(
    () => (hydrate ? semainesSelectionnables() : []),
    [hydrate]
  );
  const defautSemaine = useMemo(() => {
    if (!hydrate) return null;
    if (planning && semainesDispo.some((o) => o.semaine === planning.semaine)) {
      return planning.semaine;
    }
    return semaineParDefaut();
  }, [hydrate, planning, semainesDispo]);
  const semaineCible = semaineChoisie ?? defautSemaine;
  const offsetCible = semainesDispo.findIndex((o) => o.semaine === semaineCible);

  // Génération (US-01) : déléguée au serveur (#2, route /api/planning/generer)
  // qui lit les recettes de l'utilisateur (globales + perso) sous RLS et
  // applique lib/generateur. Le planning renvoyé est persisté en localStorage
  // (la persistance en base est un chantier distinct). Asynchrone → état
  // `enGeneration` pour le retour visuel, sans vider l'écran (#63).
  async function genererNouveauPlanning(): Promise<void> {
    if (enGeneration) return;
    setEnGeneration(true);
    setErreurGeneration(null);
    try {
      // Semaine cible (US-11) : envoyée au serveur, qui valide la plage (RG-21).
      const reponse = await fetch("/api/planning/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(semaineCible ? { semaine: semaineCible } : {}),
      });
      if (!reponse.ok) {
        setErreurGeneration(await parseApiError(reponse));
        return;
      }
      const { planning: nouveau } = (await reponse.json()) as {
        planning: Planning;
      };
      // Regénération (US-09) : un planning existait → on fige l'état (planning
      // + coches) avant écrasement pour permettre l'undo (RG-19). Première
      // génération : rien à annuler (capturerSnapshot est alors un no-op).
      const estRegeneration = storePlanning.lire() !== null;
      capturerSnapshotAnnulation();
      // Génération complète : réinitialise aussi les coches de la liste
      // de courses (RG-13) — règle centralisée dans lib/stockage.ts.
      sauvegarderPlanningComplet(nouveau);
      setSlotIndisponible(null);
      // Toast contextualisé par la semaine générée (US-11, bonus).
      const libelleSemaine = formaterSemaine(nouveau.semaine);
      if (estRegeneration) {
        toast(`Planning regénéré — ${libelleSemaine}`, {
          id: ID_TOAST_ANNULATION,
          action: { label: "Annuler", onClick: annulerDerniereAction },
          duration: 5000,
        });
      } else {
        toast.success(`Planning généré — ${libelleSemaine}`);
      }
    } catch (erreur) {
      console.error("Génération du planning échouée.", erreur);
      setErreurGeneration(
        "Impossible de générer le planning. Vérifie ta connexion et réessaie."
      );
    } finally {
      setEnGeneration(false);
    }
  }

  // Remplacement d'un slot (US-04, RG-04) : si aucune recette éligible
  // n'est disponible, le slot concerné affiche "Pas de recette disponible".
  function changerSlot(jour: Jour, typeRepas: TypeRepas): void {
    if (planning === null) return;
    const nouveau = remplacerSlot(planning, jour, typeRepas, recettes);
    if (nouveau === null) {
      // Toast en complément du message inline du slot (RG-04)
      setSlotIndisponible(cleSlot(jour, typeRepas));
      toast.error("Pas de recette disponible");
      return;
    }
    // Snapshot avant écrasement pour l'undo (US-09, RG-19).
    capturerSnapshotAnnulation();
    // Remplacement individuel : les coches sont conservées, l'invalidation
    // par quantité (RG-12) protège les articles dont l'agrégat change.
    sauvegarderRemplacementSlot(nouveau);
    setSlotIndisponible(null);
    toast("Recette remplacée", {
      id: ID_TOAST_ANNULATION,
      action: { label: "Annuler", onClick: annulerDerniereAction },
      duration: 5000,
    });
  }

  // Sélection manuelle (US-06, RG-15) : remplace le slot par la recette
  // choisie — by-pass RG-01/RG-02, ne peut pas échouer depuis l'UI.
  function selectionnerRecette(recette: Recette): void {
    if (planning === null || slotEnSelection === null) return;
    const nouveau = remplacerSlotManuel(
      planning,
      slotEnSelection.jour,
      slotEnSelection.typeRepas,
      recette
    );
    if (nouveau === null) return; // slot inexistant : impossible depuis l'UI
    // Snapshot avant écrasement pour l'undo (US-09, RG-19).
    capturerSnapshotAnnulation();
    sauvegarderRemplacementSlot(nouveau);
    // Un éventuel « Pas de recette disponible » sur ce slot est obsolète (RG-15).
    setSlotIndisponible(null);
    toast("Recette remplacée", {
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
    const nouveau = modifierPersonnes(planning, jour, typeRepas, personnes);
    if (nouveau === null) return; // slot inexistant : impossible depuis l'UI
    sauvegarderRemplacementSlot(nouveau);
  }

  // Marque / démarque un slot « restes » (US-12, RG-22). Écriture sans reset
  // des coches (l'invalidation par quantité RG-12 ajuste la liste de courses).
  // Snapshot pour l'undo (#62), comme les autres modifications de slot.
  function changerRestes(
    jour: Jour,
    typeRepas: TypeRepas,
    valeur: boolean
  ): void {
    if (planning === null) return;
    const nouveau = marquerRestes(planning, jour, typeRepas, valeur);
    if (nouveau === null) return; // slot inexistant : impossible depuis l'UI
    capturerSnapshotAnnulation();
    sauvegarderRemplacementSlot(nouveau);
    setSlotIndisponible(null);
    toast(valeur ? "Repas marqué « Restes »" : "Repas à cuisiner", {
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
          onClick={genererNouveauPlanning}
          disabled={enGeneration}
          aria-busy={enGeneration}
          className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {enGeneration ? "Génération…" : "Réessayer"}
        </button>
      </main>
    );
  }

  // --- État vide (RG-09) : bouton de génération centré (écran 1) ---
  if (planning === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-brand-900">
            Mon planning de la semaine
          </h1>
          <p className="mt-2 text-brand-700/85">
            Aucun planning pour l&apos;instant — lance la génération !
          </p>
        </div>
        {/* Choix de la semaine cible (US-11) — après hydratation (date client). */}
        {hydrate && offsetCible >= 0 && (
          <SelecteurSemaine
            options={semainesDispo}
            offsetCible={offsetCible}
            onChanger={setSemaineChoisie}
            disabled={enGeneration}
          />
        )}
        <button
          type="button"
          onClick={genererNouveauPlanning}
          disabled={enGeneration}
          aria-busy={enGeneration}
          className="rounded-full bg-brand-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {enGeneration ? "Génération…" : "Générer mon planning"}
        </button>
      </main>
    );
  }

  // --- État chargé : planning affiché ---
  return (
    <main id="contenu" className="flex-1 p-4 md:p-8">
      {/*
        #65 — Sur mobile le header s'empile : le titre prend toute la largeur
        (≤ 2 lignes au lieu de 4, le premier repas remonte au-dessus de la
        ligne de flottaison), les actions sur une rangée en dessous. À partir
        de sm, retour à la disposition titre + actions sur une ligne.
      */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-brand-900">
            Mon planning de la semaine
          </h1>
          <p className="text-sm text-brand-700/85">
            {formaterSemaine(planning.semaine)}
          </p>
          {/* Indicateur de synchro (US-13, bonus) — discret, seulement hors état nominal */}
          {etatSync !== "synchronise" && (
            <p
              role="status"
              className="mt-0.5 text-xs text-brand-700/70"
            >
              {etatSync === "sauvegarde"
                ? "Sauvegarde…"
                : "Hors-ligne — synchro au retour du réseau"}
            </p>
          )}
        </div>
        {/* Actions : pleine largeur partagée sur mobile, compactes dès sm.
            after:-inset-1 étend la zone tactile à ≥ 44px sans changer le visuel. */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={genererNouveauPlanning}
            disabled={enGeneration}
            aria-busy={enGeneration}
            className="relative flex-1 rounded-full border border-brand-200 px-4 py-2 text-center text-sm font-medium text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 sm:flex-none"
          >
            {enGeneration ? "Génération…" : "Regénérer"}
          </button>
          <Link
            href="/courses"
            className="relative flex-1 rounded-full bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:flex-none"
          >
            Liste de courses →
          </Link>
        </div>
      </header>

      {/* Semaine cible de la (re)génération (US-11) : par défaut la semaine du
          planning affiché — « Regénérer » vise alors la même semaine. */}
      {hydrate && offsetCible >= 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-brand-700/85">Générer pour :</span>
          <SelecteurSemaine
            options={semainesDispo}
            offsetCible={offsetCible}
            onChanger={setSemaineChoisie}
            disabled={enGeneration}
          />
        </div>
      )}

      {/* Vue mobile + tablette (RG-08, #64) : liste verticale jusqu'à lg.
          La grille 7 colonnes ne s'active qu'à ≥ 1024px, où chaque cellule
          reste lisible (à md=768 elle tombait à ~120px, badges compressés). */}
      <ul className="space-y-4 lg:hidden">
        {planning.jours.map((jp) => (
          <li
            key={jp.jour}
            className="rounded-lg border border-brand-100 bg-white p-4"
          >
            <h2 className="mb-3 font-semibold text-brand-900">
              {LIBELLES_JOURS[jp.jour].complet}
            </h2>
            {/* Déjeuner + dîner côte à côte dès sm (#3 : 14 repas/semaine —
                chaque jour tient sur une rangée), empilés sous sm (petits
                écrans). Au-delà de lg, c'est la grille 7 colonnes qui prend
                le relais (ul masquée). */}
            <div className="grid gap-3 sm:grid-cols-2">
              {slotsDuJour(jp).map((slot) => (
                <SlotRepas
                  key={slot.typeRepas}
                  libelle={slot.libelle}
                  jourLabel={LIBELLES_JOURS[jp.jour].complet}
                  recette={slot.recette}
                  indisponible={
                    slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                  }
                  personnes={personnesDuSlot(jp, slot.typeRepas)}
                  onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
                  onSelectionner={() =>
                    setSlotEnSelection({ jour: jp.jour, typeRepas: slot.typeRepas })
                  }
                  onChangerPersonnes={(n) =>
                    changerPersonnes(jp.jour, slot.typeRepas, n)
                  }
                  onVoir={() =>
                    setFicheOuverte({
                      recette: slot.recette,
                      personnes: personnesDuSlot(jp, slot.typeRepas),
                    })
                  }
                  restes={estRestes(jp, slot.typeRepas)}
                  onChangerRestes={(valeur) =>
                    changerRestes(jp.jour, slot.typeRepas, valeur)
                  }
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Vue desktop (RG-07, #64) : grille 7 colonnes à partir de lg (≥ 1024px) */}
      <div className="hidden lg:grid lg:grid-cols-7 lg:gap-3">
        {planning.jours.map((jp) => (
          <section key={jp.jour} className="flex flex-col gap-3">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-brand-700/85">
              {LIBELLES_JOURS[jp.jour].abrege}
            </h2>
            {slotsDuJour(jp).map((slot) => (
              <SlotRepas
                key={slot.typeRepas}
                libelle={slot.libelle}
                jourLabel={LIBELLES_JOURS[jp.jour].complet}
                recette={slot.recette}
                indisponible={
                  slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                }
                personnes={personnesDuSlot(jp, slot.typeRepas)}
                onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
                onSelectionner={() =>
                  setSlotEnSelection({ jour: jp.jour, typeRepas: slot.typeRepas })
                }
                onChangerPersonnes={(n) =>
                  changerPersonnes(jp.jour, slot.typeRepas, n)
                }
                onVoir={() =>
                  setFicheOuverte({
                    recette: slot.recette,
                    personnes: personnesDuSlot(jp, slot.typeRepas),
                  })
                }
                restes={estRestes(jp, slot.typeRepas)}
                onChangerRestes={(valeur) =>
                  changerRestes(jp.jour, slot.typeRepas, valeur)
                }
              />
            ))}
          </section>
        ))}
      </div>

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
          `editable` distingue les recettes perso (modifiables) des globales. */}
      {ficheOuverte && (
        <FicheRecette
          recette={ficheOuverte.recette}
          personnes={ficheOuverte.personnes}
          editable={idsEditables.has(ficheOuverte.recette.id)}
          onFermer={() => setFicheOuverte(null)}
        />
      )}
    </main>
  );
}

// Carte d'un repas : label du slot, nom de la recette, badge de temps de
// préparation, remplacement aléatoire (US-04) et sélection manuelle (US-06).
// Partagée entre les vues mobile et desktop.
function SlotRepas({
  libelle,
  jourLabel,
  recette,
  indisponible,
  personnes,
  onChanger,
  onSelectionner,
  onChangerPersonnes,
  onVoir,
  restes,
  onChangerRestes,
}: {
  libelle: string;
  jourLabel: string;
  recette: Recette;
  indisponible: boolean;
  personnes: number;
  onChanger: () => void;
  onSelectionner: () => void;
  onChangerPersonnes: (personnes: number) => void;
  onVoir: () => void;
  restes: boolean;
  onChangerRestes: (valeur: boolean) => void;
}) {
  const slotNom = `${libelle.toLowerCase()} de ${jourLabel.toLowerCase()}`;
  // Style partagé des actions textuelles (zone tactile ≥ 44px via after:-inset-1).
  const styleAction =
    "relative px-2 py-2 text-sm text-brand-700/85 underline-offset-2 transition-colors after:absolute after:-inset-1 after:content-[''] hover:text-brand-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

  // Slot marqué « restes » (US-12, RG-22) : pas de cuisine → ni badge de temps,
  // ni stepper, ni fiche. On revient au repas planifié (« Cuisiner ») ou on en
  // choisit un autre (« Sélectionner »). Style atténué + bordure pointillée.
  if (restes) {
    return (
      <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 p-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {libelle}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-brand-700/80">
          <IconeRestes /> Restes
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => onChangerRestes(false)}
            aria-label={`Cuisiner le ${slotNom}`}
            className={styleAction}
          >
            Cuisiner
          </button>
          <button
            type="button"
            onClick={onSelectionner}
            aria-label={`Sélectionner le ${slotNom}`}
            className={styleAction}
          >
            Sélectionner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-brand-100 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
        {libelle}
      </p>
      {/* Nom = déclencheur de la fiche (US-10, RG-20). Bouton plutôt que card
          entière cliquable : la card porte déjà changer/sélectionner/stepper
          (pas d'imbrication d'interactifs). text-left + zone tactile étendue. */}
      <button
        type="button"
        onClick={onVoir}
        aria-label={`Voir la recette : ${recette.nom}`}
        className="mt-1 block w-full text-left text-sm font-medium text-brand-900 underline-offset-2 transition-colors hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {recette.nom}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <BadgeTemps temps={recette.tempsPreparation} />
        {/*
          a11y : aria-labels contextualisés — des paires de boutons identiques
          sont indiscernables au lecteur d'écran ; l'icône Lucide RefreshCw
          (#59, fin du glyphe ↺) est décorative ; after:-inset-* étend la zone
          tactile à ≥ 44px.
        */}
        <button
          type="button"
          onClick={onChanger}
          aria-label={`Changer le ${slotNom}`}
          className={`${styleAction} inline-flex items-center gap-1`}
        >
          <RefreshCw aria-hidden="true" className="size-3.5" /> changer
        </button>
        {/* Sélection manuelle (US-06) : ouvre le sélecteur de recettes */}
        <button
          type="button"
          onClick={onSelectionner}
          aria-label={`Sélectionner le ${slotNom}`}
          className={styleAction}
        >
          Sélectionner
        </button>
        {/* Marquer en « restes » (US-12) : pas de cuisine ce repas-là */}
        <button
          type="button"
          onClick={() => onChangerRestes(true)}
          aria-label={`Marquer le ${slotNom} en restes`}
          className={styleAction}
        >
          Restes
        </button>
      </div>
      {/* Nombre de personnes (US-07) : la liste de courses se met à l'échelle */}
      <StepperPersonnes
        personnes={personnes}
        slotLabel={slotNom}
        onChanger={onChangerPersonnes}
      />
      {/* role="alert" : le message dynamique est annoncé aux lecteurs d'écran */}
      {indisponible && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          Pas de recette disponible
        </p>
      )}
    </div>
  );
}

// Icône « restes » — bol fumant, SVG inline (pas d'emoji, audit #51).
function IconeRestes() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h16M6 12a6 6 0 0 0 12 0M9 3c-.6 1-.6 2 0 3M13 3c-.6 1-.6 2 0 3" />
    </svg>
  );
}

// Stepper du nombre de personnes (US-07, RG-16) : − N pers. +, borné [1;12].
// Les boutons portent un aria-label contextualisé (9 paires identiques) et
// une zone tactile ≥ 44px ; la valeur est annoncée via aria-live.
function StepperPersonnes({
  personnes,
  slotLabel,
  onChanger,
}: {
  personnes: number;
  slotLabel: string;
  onChanger: (personnes: number) => void;
}) {
  const styleBouton =
    "relative flex size-7 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChanger(personnes - 1)}
        disabled={personnes <= PERSONNES_MIN}
        aria-label={`Moins de personnes pour le ${slotLabel}`}
        className={styleBouton}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span
        aria-live="polite"
        className="min-w-[4.5rem] text-center text-xs font-medium text-brand-700/85"
      >
        {personnes} pers.
      </span>
      <button
        type="button"
        onClick={() => onChanger(personnes + 1)}
        disabled={personnes >= PERSONNES_MAX}
        aria-label={`Plus de personnes pour le ${slotLabel}`}
        className={styleBouton}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
