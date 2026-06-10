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
  prefereVegeSlot,
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
import { naviguerVers, useSemaineAffichee, useSync } from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import {
  decalageEntre,
  formaterSemaine,
  libelleRelatif,
  semaineDecalee,
  semaineISO,
} from "@/lib/semaines";
import { parseApiError } from "@/lib/errors";

// Plage de navigation de l'historique (#5) : 12 semaines passées → +6 futures.
const SEMAINES_PASSEES = 12;
const SEMAINES_FUTURES = 6;
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { FicheRecette } from "@/components/planning/fiche-recette";
import { ConfirmationModale } from "@/components/ui/confirmation";
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

// Navigateur de semaines (US-14, #5) : stepper borné ‹ [libellé relatif + date] ›
// qui change la semaine AFFICHÉE (passé stocké → futur). La semaine courante
// (offset 0) est visuellement marquée (RG). Remplace le sélecteur de génération
// #55 (génération = semaine affichée).
function NavigateurSemaine({
  semaine,
  offset,
  peutReculer,
  peutAvancer,
  onPrecedente,
  onSuivante,
  disabled,
}: {
  semaine: string;
  offset: number; // par rapport à la semaine courante (0 = cette semaine)
  peutReculer: boolean;
  peutAvancer: boolean;
  onPrecedente: () => void;
  onSuivante: () => void;
  disabled?: boolean;
}) {
  const estCourante = offset === 0;
  const styleFleche =
    "relative flex size-8 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      role="group"
      aria-label="Naviguer entre les semaines"
      className="inline-flex items-center gap-2"
    >
      <button
        type="button"
        onClick={onPrecedente}
        disabled={disabled || !peutReculer}
        aria-label="Semaine précédente"
        className={styleFleche}
      >
        <ChevronSemaine direction="gauche" />
      </button>
      {/* Semaine courante marquée (RG) : fond brand + texte accentué. */}
      <span
        aria-live="polite"
        className={`min-w-[11rem] rounded-lg px-3 py-1 text-center ${estCourante ? "bg-brand-50" : ""}`}
      >
        <span
          className={`block text-sm font-medium ${estCourante ? "text-brand-700" : "text-brand-900"}`}
        >
          {libelleRelatif(offset)}
        </span>
        <span className="block text-xs text-brand-700/85">
          {formaterSemaine(semaine)}
        </span>
      </span>
      <button
        type="button"
        onClick={onSuivante}
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
  // Réglages de génération (#45) : pilotent l'éligibilité du remplacement
  // unitaire « ↺ changer » (la génération complète les lit côté serveur).
  // Défaut tant que non chargés = comportement antérieur.
  const [reglages, setReglages] = useState(REGLAGES_DEFAUT);
  // Confirmation avant de régénérer/modifier une semaine PASSÉE (US-14, RG-24).
  // Contient l'action à rejouer (avec `force`) une fois l'utilisateur d'accord.
  const [confirmation, setConfirmation] = useState<{
    executer: () => void;
  } | null>(null);

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
  const hydrate = useHydratation();
  // Synchro + historique : useSync hydrate la semaine affichée au montage et
  // pousse les changements (indicateur) ; useSemaineAffichee donne la semaine
  // courante affichée (navigation #5).
  const etatSync = useSync();
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
        console.error("Chargement des recettes échoué.", erreur);
      });
    // Réglages de génération (#45) : indépendants des recettes, défauts si échec.
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

  // Navigation entre semaines (US-14, #5). La date courante dépend du client →
  // calculée une fois hydraté (motif useHydratation, pas de mismatch SSR).
  // `offsetAffiche` = position de la semaine affichée vs la semaine courante.
  const navPret = hydrate && semaineAffichee !== null;
  const offsetAffiche = navPret
    ? decalageEntre(semaineISO(new Date()), semaineAffichee)
    : 0;
  const peutReculer = navPret && offsetAffiche > -SEMAINES_PASSEES;
  const peutAvancer = navPret && offsetAffiche < SEMAINES_FUTURES;
  function allerSemaine(delta: number): void {
    if (semaineAffichee) void naviguerVers(semaineDecalee(semaineAffichee, delta));
  }

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
    // Regénération d'une semaine passée (planning existant) : confirmation
    // avant écrasement (RG-24). Première génération (planning null) : direct.
    if (!force && confirmerSiPassee(() => void genererNouveauPlanning(true))) {
      return;
    }
    setEnGeneration(true);
    setErreurGeneration(null);
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
      const { planning: nouveau, vegeNonHonore = 0 } = (await reponse.json()) as {
        planning: Planning;
        vegeNonHonore?: number;
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
      // RG-26 — préférence végé souple non honorée sur certains repas (vivier
      // végé insuffisant) : on informe sans bloquer (#86 PR2).
      if (vegeNonHonore > 0) {
        toast.warning(
          vegeNonHonore === 1
            ? "1 repas n’a pas pu être végétarien (pas assez de recettes végé)."
            : `${vegeNonHonore} repas n’ont pas pu être végétariens (pas assez de recettes végé).`
        );
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
  function changerSlot(jour: Jour, typeRepas: TypeRepas, force = false): void {
    if (planning === null) return;
    if (!force && confirmerSiPassee(() => changerSlot(jour, typeRepas, true))) {
      return;
    }
    const nouveau = remplacerSlot(planning, jour, typeRepas, recettes, reglages);
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
    // RG-26 — préférence végé souple non honorée sur ce créneau (aucune recette
    // végé disponible) : on informe sans bloquer le remplacement (#86 PR2).
    const remplacante =
      typeRepas === "diner"
        ? nouveau.jours.find((jp) => jp.jour === jour)?.diner
        : nouveau.jours.find((jp) => jp.jour === jour)?.dejeuner;
    if (
      prefereVegeSlot(jour, typeRepas, reglages) &&
      remplacante?.vegetarien !== true
    ) {
      toast.warning("Pas de recette végétarienne disponible pour ce repas.");
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
    const nouveau = remplacerSlotManuel(
      planning,
      cible.jour,
      cible.typeRepas,
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
          onClick={() => void genererNouveauPlanning()}
          disabled={enGeneration}
          aria-busy={enGeneration}
          className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {enGeneration ? "Génération…" : "Réessayer"}
        </button>
      </main>
    );
  }

  // --- État vide (RG-09) : semaine affichée sans planning (#5) ---
  if (planning === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-brand-900">
            Mon planning de la semaine
          </h1>
          <p className="mt-2 text-brand-700/85">
            Aucun planning pour cette semaine — lance la génération !
          </p>
        </div>
        {/* Navigation entre semaines (#5) — après hydratation (date client). */}
        {navPret && (
          <NavigateurSemaine
            semaine={semaineAffichee!}
            offset={offsetAffiche}
            peutReculer={peutReculer}
            peutAvancer={peutAvancer}
            onPrecedente={() => allerSemaine(-1)}
            onSuivante={() => allerSemaine(1)}
            disabled={enGeneration}
          />
        )}
        <button
          type="button"
          onClick={() => void genererNouveauPlanning()}
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
          {/* La semaine s'affiche dans le navigateur ci-dessous (#5). */}
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
            onClick={() => void genererNouveauPlanning()}
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

      {/* Navigateur de semaines (#5) : change la semaine affichée ; la
          génération/regénération vise la semaine affichée. */}
      {navPret && (
        <div className="mb-6">
          <NavigateurSemaine
            semaine={semaineAffichee!}
            offset={offsetAffiche}
            peutReculer={peutReculer}
            peutAvancer={peutAvancer}
            onPrecedente={() => allerSemaine(-1)}
            onSuivante={() => allerSemaine(1)}
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
        {recette.vegetarien && <BadgeVegetarien compact />}
        {recette.accompagnement && (
          <BadgeAccompagnement accompagnement={recette.accompagnement} compact />
        )}
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
