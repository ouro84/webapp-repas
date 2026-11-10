"use client";

// Vue planning calée sur le CYCLE de courses (#260, PR3 de l'épopée #257).
//
// Bonus « lecture d'abord » (design §8) : visualiser « ce que j'ai prévu jusqu'à
// quand », aligné sur la fenêtre de la liste de courses (même ancre + longueur).
//
// ÉDITION À PARITÉ AVEC LA VUE SEMAINE (retour utilisateur post-merge #281) :
// changer/sélection manuelle/personnes/restes sont désormais disponibles ici.
// La contrainte d'origine (#260 §8, réaffirmée en #279) était : un cycle non
// calendaire chevauche 1-2 semaines ISO → éditer un slot d'une semaine qui
// n'est pas la « semaine affichée » sortirait du modèle MONO-SEMAINE de
// storePlanning/useSync (persistance + undo + temps réel). On lève cette
// contrainte en écrivant DIRECTEMENT en base pour la semaine ISO du jour
// édité (modifierSlotDistant, lib/sync.ts — mirroir de la génération #259,
// RPC sauvegarder_slots), sans jamais passer par storePlanning. Deux garde-
// fous nécessaires, câblés dans modifierSlotDistant : (1) l'anti-écho US-21
// (compteur des écritures en vol + `updated_at` retenu, #352) est tenu à jour
// pour ne jamais déclencher l'alerte intrusive sur sa propre édition ; (2) si
// le jour édité appartient à la semaine actuellement affichée en vue Semaine,
// le cache storePlanning est patché en direct. Undo
// dédié et léger (toast « Annuler » qui rejoue l'ancien JourPlanning), pas de
// réutilisation du snapshot localStorage de la vue Semaine (inutile ici).
//
// ÉDITION OPTIMISTE (#301) : chaque édition patche immédiatement `parSemaine`
// (remplacerJourDansSemaines, lib/cycles) et confie l'écriture distante à une
// file par jour (creerFileEcritureSlots, lib/file-ecriture-slots) : départ
// immédiat pour les actions ponctuelles, débounce pour le stepper personnes,
// une seule écriture en vol par jour, retour à l'état confirmé + toast en cas
// d'échec. Jamais de `chargerCycle` après une édition : son
// `setChargement(true)` estompe la grille et ignore les flèches le temps d'un
// aller-retour réseau (le squelette n'existe qu'au premier chargement),
// et sa relecture écraserait l'état optimiste. La file est vidée avant toute
// relecture (navigation, génération) et au démontage.
//
// L'en-tête (titre, bascule, « Régénérer », « Liste de courses → » avec l'ancre
// affichée en query param #279, légende, navigateur) et l'état vide sont ceux de
// la vue Semaine (EntetePlanning / EtatVidePlanning, #352).
//
// Projection : on lit les plannings des 1-2 semaines ISO que le cycle touche
// (lireCycle, base = source de vérité) et on rend chaque JOUR du
// cycle (date concrète) via lib/cycles (fonctions pures).

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ancreCourante,
  CYCLES_FUTURS,
  CYCLES_PASSES,
  cycleDecale,
  datesCycle,
  dateVersSemaineJour,
  joursDuCycle,
  LONGUEUR_DEFAUT,
  remplacerJourDansSemaines,
  versISO,
} from "@/lib/cycles";
import {
  creerFileEcritureSlots,
  DELAI_STEPPER_MS,
  type FileEcritureSlots,
} from "@/lib/file-ecriture-slots";
import {
  decalageCycles,
  libelleJourComplet,
  libelleRelatifCycle,
} from "@/lib/planning-affichage";
import { PERSONNES_DEFAUT, personnesDuSlot } from "@/lib/personnes";
import { estRestes } from "@/lib/restes";
import { editerSlot, MESSAGES_EDITION } from "@/lib/edition-slot";
import { estRaccourciAnnuler } from "@/lib/raccourci-annuler";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { resoudreCycle } from "@/lib/ancre-cycle";
import { ancreInitialeCycle, longueurOuDefaut } from "@/lib/ancre-initiale-cycle";
import { clientParDefaut } from "@/lib/supabase/par-defaut";
import { aujourdhuiParis } from "@/lib/semaines";
import { chargerLongueurCycle } from "@/lib/persistance";
import { ErreurLectureCycle, lireCycle, type CycleLu } from "@/lib/lecture-cycle";
import {
  creneauActif,
  recettesUtilisees,
  type PreferencesRecettes,
} from "@/lib/generateur";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import {
  definirCycleAffiche,
  ErreurEnvoisEnAttente,
  modifierSlotDistant,
  useGenerationCycle,
} from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { chargerPreferences } from "@/lib/preferences";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";
import { SlotRepas } from "@/components/planning/slot-repas";
import { GrilleJours, type JourGrille } from "@/components/planning/grille-jours";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { ConfirmationModale } from "@/components/ui/confirmation";
import { FicheRecette } from "@/components/planning/fiche-recette";
import { NavigateurPeriode } from "@/components/planning/navigateur-periode";
import { EntetePlanning, type VuePlanning } from "@/components/planning/entete-planning";
import { EtatVidePlanning } from "@/components/planning/etat-vide-planning";
import { SquelettePlanning } from "@/components/planning/squelette-planning";
import type { JourPlanning, Planning, Recette, ReglagesGeneration } from "@/types";

type TypeRepas = "dejeuner" | "diner";

const ID_TOAST_ANNULATION_CYCLE = "annulation-slot-cycle";
// Durée du toast d'annulation, et donc de la fenêtre de l'undo (toast ou Ctrl+Z).
const DUREE_ANNULATION_MS = 5000;

// Horloge de la fenêtre d'annulation, hors du composant (fonctions impures).
function echeanceAnnulation(): number {
  return Date.now() + DUREE_ANNULATION_MS;
}
function estEchue(echeance: number): boolean {
  return Date.now() > echeance;
}

// Créneau d'un message « Pas de recette disponible » (#373) : date + repas.
function cleCreneau(dateISO: string, typeRepas: TypeRepas): string {
  return `${dateISO}|${typeRepas}`;
}
// Toast d'échec de lecture du cycle : id fixe pour dédoublonner les échecs
// successifs et le lever dès qu'une lecture réussit (#357).
const ID_TOAST_ECHEC_CYCLE = "echec-chargement-cycle";

// Slots d'un jour dans l'ordre d'affichage : déjeuner puis dîner. `recette`
// est absente si le jour n'est pas planifié (`jp` nul), si le slot n'a jamais
// été généré (planning antérieur/créneau jamais rempli) OU si son créneau est
// désactivé (« Aucun », #217, RG-44/46) — même filtre live que la vue Semaine,
// appliqué ici par slot (cette vue projette des dates de plusieurs semaines,
// pas un `Planning` unique, donc pas de `retirerCreneauxDesactives` direct).
// Les trois cas rendent « Pas de repas prévu » (SlotRepas), comme la semaine.
function slotsDuJour(
  jour: JourPlanning["jour"],
  jp: JourPlanning | null,
  reglages: ReglagesGeneration
): { typeRepas: TypeRepas; libelle: string; recette: Recette | undefined }[] {
  return [
    {
      typeRepas: "dejeuner" as const,
      libelle: "Déjeuner",
      recette: jp && creneauActif(jour, "dejeuner", reglages) ? jp.dejeuner : undefined,
    },
    {
      typeRepas: "diner" as const,
      libelle: "Dîner",
      recette: jp && creneauActif(jour, "diner", reglages) ? jp.diner : undefined,
    },
  ];
}

export function VuePlanningCycle({
  idsModifiables,
  lienCycle,
  vue,
  onChangerVue,
}: {
  // Ids des recettes du catalogue chargé (#137) : pour ceux-là, la fiche propose
  // « Modifier » (deep-link /recettes?edition). Fourni par la page (déjà chargé).
  idsModifiables: ReadonlySet<string>;
  // Date AAAA-MM-JJ du lien profond `/planning?cycle=` (#320, RG-87) : ouvre la
  // vue sur le cycle qui la contient. Lue UNE fois au montage : une modification
  // ultérieure de la prop (bascule, retrait du lien) ne relance pas le chargement.
  lienCycle?: string;
  // Bascule Semaine | Cycle (#352) : rendue par la vue elle-même, dans son en-tête
  // ou son état vide, comme la vue Semaine.
  vue: VuePlanning;
  onChangerVue: (v: VuePlanning) => void;
}) {
  const [lienInitial] = useState(lienCycle);
  const [ancre, setAncre] = useState<string | null>(null);
  const [longueur, setLongueur] = useState<number>(LONGUEUR_DEFAUT);
  // Jour de courses du foyer (#352) : sert à situer le cycle affiché par rapport
  // au cycle courant (libellé relatif du navigateur). Lu au montage, avant l'ancre.
  const [jourCourses, setJourCourses] = useState<number>(1);
  // Jour courant (#352), date LOCALE du client : `null` au premier rendu (pas de
  // date au rendu serveur), posé par l'effet de montage. S'il reste ≤ 2 jours
  // dans le cycle courant, le cycle par défaut est le suivant (RG-91) : aucun jour marqué.
  const [aujourdhuiISO, setAujourdhuiISO] = useState<string | null>(null);
  // Plannings des semaines ISO touchées, indexés par semaine.
  const [parSemaine, setParSemaine] = useState<Map<string, Planning>>(new Map());
  const [chargement, setChargement] = useState(true);
  // Premier chargement en échec (RG-09, 3 états) : sans cycle affiché, l'écran
  // propose « Réessayer » au lieu de rester sur le squelette.
  const [erreurInitiale, setErreurInitiale] = useState(false);
  const [ficheOuverte, setFicheOuverte] = useState<{
    recette: Recette;
    personnes: number;
  } | null>(null);
  // Dernière édition annulable (US-09, #373) : rejouée par le bouton du toast ou
  // par Ctrl/Cmd+Z jusqu'à `expireLe` (durée du toast), un seul cran.
  const annulationEnAttente = useRef<{ expireLe: number; annuler: () => void } | null>(null);
  // Échecs d'écriture de la file : chacun invalide l'annulation en attente
  // (effet ci-dessous ; l'initialiseur de la file ne touche pas au ref).
  const [echecsEcriture, setEchecsEcriture] = useState(0);
  useEffect(() => {
    annulationEnAttente.current = null;
  }, [echecsEcriture]);
  // Créneau qui affiche « Pas de recette disponible » (`cleCreneau`, RG-04, #373).
  const [slotIndisponible, setSlotIndisponible] = useState<string | null>(null);
  // Slot en cours de sélection manuelle (US-06) — porte tout le contexte
  // nécessaire pour appliquer/persister le choix (date pour la garde "semaine
  // passée", semaine ISO pour la persistance, jour+typeRepas pour le calcul).
  const [slotEnSelection, setSlotEnSelection] = useState<{
    dateISO: string;
    semaine: string;
    jour: JourPlanning["jour"];
    typeRepas: TypeRepas;
  } | null>(null);
  // Confirmation avant d'éditer un jour PASSÉ (US-14, RG-24) — même garde que la
  // vue Semaine, mais jugée par jour édité (comparaison de date directe, pas
  // d'offsetAffiche : la vue Cycle n'a pas de notion de "semaine affichée" unique).
  const [confirmation, setConfirmation] = useState<{ executer: () => void } | null>(null);
  // Confirmation avant de régénérer un cycle déjà rempli (#334).
  const [confirmationGeneration, setConfirmationGeneration] = useState(false);
  // Réglages (#217) : pilotent le filtre live des créneaux désactivés. Défaut
  // tant que non chargés = comportement antérieur (tout actif).
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);
  // File d'écriture par jour (#301) : l'état local est déjà à jour quand elle
  // écrit ; en cas d'échec, on revient à l'état confirmé du jour + toast
  // (« toute erreur capturée est affichée »).
  const [file] = useState<FileEcritureSlots>(() =>
    creerFileEcritureSlots({
      ecrire: modifierSlotDistant,
      surEchec: (semaine, jourConfirme, erreur) => {
        console.error("Édition du slot échouée.", erreur);
        setParSemaine((m) => remplacerJourDansSemaines(m, semaine, jourConfirme));
        // L'état est revenu au confirmé : plus rien à annuler (#373).
        setEchecsEcriture((n) => n + 1);
        toast.dismiss(ID_TOAST_ANNULATION_CYCLE);
        toast.error("Impossible d'enregistrer la modification. Réessaie.");
      },
    })
  );

  // Ne jamais perdre une écriture débouncée : ni en basculant vers la vue
  // Semaine (démontage), ni quand l'app passe en arrière-plan ou se ferme
  // (mobile verrouillé, onglet quitté, rechargement) — contrairement à la vue
  // Semaine, rien n'est gardé en localStorage pour la rejouer plus tard.
  useEffect(() => {
    const surMasquage = () => {
      if (document.visibilityState === "hidden") void file.vider();
    };
    const surPagehide = () => {
      void file.vider();
    };
    document.addEventListener("visibilitychange", surMasquage);
    window.addEventListener("pagehide", surPagehide);
    return () => {
      document.removeEventListener("visibilitychange", surMasquage);
      window.removeEventListener("pagehide", surPagehide);
      void file.vider();
    };
  }, [file]);

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

  // Recettes + préférences (#219) : nécessaires pour « Changer » (aléatoire, biaisé
  // par les préférences) et « Sélectionner » (liste complète), même chargement que
  // la vue Semaine (app/planning/page.tsx).
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  const [preferences, setPreferences] = useState<PreferencesRecettes>(new Map());

  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (actif) setRecettesGerees(liste);
      })
      .catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
      });
    chargerPreferences()
      .then((p) => {
        if (actif) setPreferences(p);
      })
      .catch((erreur) => {
        console.error("Chargement des préférences échoué (biais ignoré).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  const recettes = recettesGerees.map((r) => r.recette);

  function estPasse(dateISO: string): boolean {
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const [a, m, j] = dateISO.split("-").map(Number);
    return new Date(a, m - 1, j) < aujourdhui;
  }

  function confirmerSiPasse(dateISO: string, executer: () => void): boolean {
    if (estPasse(dateISO)) {
      setConfirmation({ executer });
      return true;
    }
    return false;
  }

  // Génération partagée (#279, D2) : accessible directement depuis cette vue,
  // sans passer par /courses. Le mécanisme (#259) persiste par la RPC atomique
  // sauvegarder_cycle (#304), indépendamment de storePlanning/useSync (mono-semaine).
  const { enGeneration, genererCycle } = useGenerationCycle(
    ancre !== null ? { ancre, longueur } : null
  );

  // Verrou d'édition pendant « Générer mon cycle » (revue #301) : posé dès le
  // clic, AVANT le vidage de la file, et levé une fois la projection relue.
  // Sans lui, une édition faite pendant la génération armerait une écriture de
  // l'ANCIEN jour qui écraserait silencieusement le jour généré ; il bloque
  // aussi un double clic pendant le vidage (enGeneration n'est posé qu'après).
  const generationVerrouillee = useRef(false);
  const [verrouAffiche, setVerrouAffiche] = useState(false);

  async function genererMonCycle(): Promise<void> {
    if (enGeneration || generationVerrouillee.current) return;
    generationVerrouillee.current = true;
    setVerrouAffiche(true);
    try {
      // Une écriture débouncée tardive écraserait le cycle généré (#301).
      await file.vider();
      const { vegeNonHonore, mixNonHonore, saisonNonHonore } = await genererCycle();
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
      // Recharge la projection affichée pour refléter le nouveau contenu. Une
      // relecture ratée (`false`, jamais une exception) est retentée une fois
      // (#357) : le cycle est déjà généré en base, l'afficher périmé trompe.
      if (ancre !== null) {
        const ok = await chargerCycle(ancre);
        if (!ok) await chargerCycle(ancre);
      }
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error(
        erreur instanceof Error
          ? erreur.message
          : "Impossible de générer le cycle. Vérifie ta connexion et réessaie."
      );
      // Resynchronise l'affichage (#357) : la base peut déjà contenir le cycle
      // généré (RPC passée, relecture échouée) ; sans cette relecture la vue
      // resterait sur la projection d'avant. `chargerCycle` gère elle-même ses
      // erreurs de lecture (log + toast dédoublonné, état précédent conservé) ;
      // ce toast s'ajoute à celui de l'échec de génération, message distinct.
      // Refus AVANT toute écriture (envois en attente, #355) : rien n'a changé
      // en base, la relecture n'ajouterait qu'un second toast (hors ligne).
      if (ancre !== null && !(erreur instanceof ErreurEnvoisEnAttente)) {
        await chargerCycle(ancre);
      }
    } finally {
      generationVerrouillee.current = false;
      setVerrouAffiche(false);
    }
  }

  // Mise à jour optimiste de l'affichage (#301) — jamais de rechargement.
  function appliquerLocal(semaine: string, jour: JourPlanning): void {
    setParSemaine((m) => remplacerJourDansSemaines(m, semaine, jour));
  }

  // Annule la dernière édition (US-09) en rejouant l'ANCIEN JourPlanning par le
  // même chemin — pas de snapshot persistant (contrairement à la vue Semaine) :
  // l'annulation vit le temps du toast (`DUREE_ANNULATION_MS`), par son bouton
  // ou par Ctrl/Cmd+Z, un seul cran (#373).
  function toastAnnulable(
    message: string,
    semaine: string,
    ancienJour: JourPlanning,
    nouveauJour: JourPlanning
  ): void {
    annulationEnAttente.current = {
      expireLe: echeanceAnnulation(),
      annuler: () => {
        appliquerLocal(semaine, ancienJour);
        file.planifier(semaine, ancienJour, { delaiMs: 0, precedent: nouveauJour });
      },
    };
    toast(message, {
      id: ID_TOAST_ANNULATION_CYCLE,
      action: { label: "Annuler", onClick: () => void annulerDerniereEdition() },
      duration: DUREE_ANNULATION_MS,
    });
  }

  // Exécute l'annulation en attente, si elle n'a pas expiré, puis « Annulé »
  // (comme la vue Semaine). Renvoie `true` si une annulation a eu lieu.
  function annulerDerniereEdition(): boolean {
    const enAttente = annulationEnAttente.current;
    if (enAttente === null || generationVerrouillee.current) return false;
    annulationEnAttente.current = null;
    if (estEchue(enAttente.expireLe)) return false;
    enAttente.annuler();
    toast.dismiss(ID_TOAST_ANNULATION_CYCLE);
    toast.success("Annulé");
    return true;
  }

  // Raccourci Ctrl/Cmd+Z (US-09, #373) : même règle que la vue Semaine
  // (`estRaccourciAnnuler`), sur la dernière édition encore annulable.
  // preventDefault seulement si une annulation a eu lieu (Ctrl+Z rendu au
  // navigateur sinon).
  const surToucheAnnuler = useEffectEvent((e: KeyboardEvent) => {
    if (estRaccourciAnnuler(e) && annulerDerniereEdition()) e.preventDefault();
  });
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => surToucheAnnuler(e);
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  // Action ponctuelle (changer, sélectionner, restes) : affichage immédiat,
  // écriture immédiate en arrière-plan ; l'échec passe par surEchec (revert).
  function appliquerEdition(
    semaine: string,
    ancienJourPlanning: JourPlanning,
    nouveauJourPlanning: JourPlanning,
    messageToast: string | null
  ): void {
    if (generationVerrouillee.current) return;
    // Un éventuel « Pas de recette disponible » est obsolète (comme en Semaine).
    setSlotIndisponible(null);
    appliquerLocal(semaine, nouveauJourPlanning);
    file.planifier(semaine, nouveauJourPlanning, { delaiMs: 0, precedent: ancienJourPlanning });
    if (messageToast) toastAnnulable(messageToast, semaine, ancienJourPlanning, nouveauJourPlanning);
  }

  function planningDeLaSemaine(semaine: string): Planning | null {
    return parSemaine.get(semaine) ?? null;
  }

  // Changer (aléatoire, US-04) : calcul partagé avec la vue Semaine
  // (editerSlot, pur, biaisé par préférences/réglages) — seule la persistance
  // change (écriture directe, cf. modifierSlotDistant). Avertissements
  // RG-26/27/28 et « Pas de recette disponible » inline comme en Semaine (#373).
  function changerSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    force = false
  ): void {
    if (!force && confirmerSiPasse(dateISO, () => changerSlot(dateISO, semaine, jour, typeRepas, true))) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const edition = editerSlot(planningSemaine, jour, typeRepas, {
      type: "changer",
      recettes,
      reglages,
      preferences,
    });
    if (!edition.ok) {
      if (edition.motif === "indisponible") {
        // Toast en complément du message inline du créneau (RG-04).
        setSlotIndisponible(cleCreneau(dateISO, typeRepas));
        toast.error(MESSAGES_EDITION.indisponible);
      }
      return;
    }
    appliquerEdition(semaine, edition.precedent, edition.jour, MESSAGES_EDITION.remplacee);
    // Préférences souples non honorées, dans l'ordre végé (RG-26), légume
    // (RG-27), saison (RG-28), comme la vue Semaine.
    for (const avertissement of edition.avertissements) {
      toast.warning(MESSAGES_EDITION.avertissements[avertissement]);
    }
  }

  // Sélection manuelle (US-06) : remplace le slot par la recette choisie —
  // by-pass RG-01/RG-02, ne peut pas échouer depuis l'UI.
  function selectionnerRecette(recette: Recette): void {
    if (slotEnSelection === null) return;
    const cible = slotEnSelection;
    setSlotEnSelection(null);
    const executer = () => {
      const planningSemaine = planningDeLaSemaine(cible.semaine);
      if (!planningSemaine) return;
      const edition = editerSlot(planningSemaine, cible.jour, cible.typeRepas, {
        type: "selectionner",
        recette,
      });
      if (!edition.ok) return;
      appliquerEdition(cible.semaine, edition.precedent, edition.jour, MESSAGES_EDITION.remplacee);
    };
    if (confirmerSiPasse(cible.dateISO, executer)) return;
    executer();
  }

  // Nombre de personnes (US-07) — action mineure, non undoable (même
  // comportement que la vue Semaine, cf. app/planning/page.tsx#changerPersonnes).
  // Débouncé (#301) : une rafale de clics ne produit qu'une écriture.
  function changerPersonnesSlot(
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    personnes: number
  ): void {
    if (generationVerrouillee.current) return;
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const edition = editerSlot(planningSemaine, jour, typeRepas, {
      type: "personnes",
      personnes,
    });
    if (!edition.ok) return;
    appliquerLocal(semaine, edition.jour);
    file.planifier(semaine, edition.jour, {
      delaiMs: DELAI_STEPPER_MS,
      precedent: edition.precedent,
    });
  }

  // Marquer/démarquer « restes » (US-12, RG-22).
  function changerRestesSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    valeur: boolean,
    force = false
  ): void {
    if (
      !force &&
      confirmerSiPasse(dateISO, () => changerRestesSlot(dateISO, semaine, jour, typeRepas, valeur, true))
    ) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const edition = editerSlot(planningSemaine, jour, typeRepas, {
      type: "restes",
      valeur,
    });
    if (!edition.ok) return;
    appliquerEdition(semaine, edition.precedent, edition.jour, MESSAGES_EDITION.restes(valeur));
  }

  // Charge (ou recharge) le cycle d'ancre donnée : lit les 1-2 semaines touchées.
  //
  // ⚠️ Un cycle non calendaire (jour_courses ≠ lundi, cf. #257) touche
  // GÉNÉRALEMENT 2 semaines ISO (ex. ancre=vendredi → ven/sam/dim dans la
  // semaine N, lun-jeu dans la semaine N+1). Si UNE des lectures parallèles
  // échoue (réseau, réveil Supabase après pause), elle ne doit JAMAIS être
  // traitée comme « pas de planning cette semaine-là » (RG absente) : ça
  // viderait silencieusement le groupe de jours minoritaire (typiquement
  // ven/sam/dim) sans le signaler, à chaque rechargement du cycle — y compris
  // juste après une édition. On distingue donc explicitement l'échec de
  // l'absence légitime, et on n'écrase l'affichage courant QUE si TOUTES les
  // lectures ont réussi (sinon on garde l'état précédent + un toast, plutôt
  // qu'une projection partielle). Renvoie `false` si une lecture a échoué. Au
  // premier chargement (`initial`), pas de toast : l'état erreur le dit déjà.
  const chargerCycle = useCallback(async (ancreCible: string, initial = false): Promise<boolean> => {
    setChargement(true);
    try {
      // Lecture stricte (#365) : repli client explicite et loggé sur 7 jours.
      const long = await longueurOuDefaut(chargerLongueurCycle(ancreCible));
      // Lecteur de cycle unique (chantier 05) : l'échec d'une semaine rejette
      // l'ensemble (ErreurLectureCycle), l'absence de ligne est ignorée. Toute
      // autre erreur suit le même chemin : `chargerCycle` ne lève jamais, ses
      // appelants s'en remettent à son booléen (#357).
      let lu: CycleLu;
      try {
        lu = await lireCycle({ ancre: ancreCible, longueur: long });
      } catch (erreur) {
        if (erreur instanceof ErreurLectureCycle) {
          erreur.semainesEnEchec.forEach((s, i) => {
            console.error(`Chargement du planning de la semaine ${s} échoué.`, erreur.causes[i]);
          });
        } else {
          console.error("Chargement du cycle échoué.", erreur);
        }
        if (!initial) {
          toast.error(
            "Certains jours du cycle n'ont pas pu être chargés. Réessaie.",
            { id: ID_TOAST_ECHEC_CYCLE }
          );
        }
        return false;
      }
      setLongueur(long);
      setParSemaine(lu.parSemaine);
      setAncre(ancreCible);
      // Répercute dans le store partagé (#279) : nécessaire pour que la
      // génération (ci-dessous) et le lien « Liste de courses → » ciblent le
      // MÊME cycle que celui affiché ici. Écriture localStorage pure, sans
      // effet de bord coches/réaltime (cf. definirCycleAffiche).
      definirCycleAffiche(ancreCible, long);
      // Lecture réussie : un toast d'échec précédent est périmé.
      toast.dismiss(ID_TOAST_ECHEC_CYCLE);
      return true;
    } finally {
      setChargement(false);
    }
  }, []);

  // Montage : un SEUL chargement initial (jamais le cycle par défaut affiché
  // puis remplacé). Avec un lien profond (#320, RG-87) : ancre résolue par
  // `resoudreCycle` (même résolution que le MCP et la route panier),
  // EN PARALLÈLE de la lecture du jour de courses ; hors plage / invalide /
  // lecture échouée → ancre par défaut. Sans lien : ancre par défaut dérivée du
  // jour de courses du foyer (même règle que /courses, ancreParDefaut → cycle
  // suivant à ≤ 2 jours restants, RG-91). Logique dans `ancreInitialeCycle`
  // (lib, testée).
  // Échec (lecture d'une semaine, erreur inattendue) → état erreur ; « Réessayer »
  // rejoue ce même chargement initial (`essaiInitial` en dépendance).
  const [essaiInitial, setEssaiInitial] = useState(0);
  useEffect(() => {
    let actif = true;
    void ancreInitialeCycle({
      chargerJour: () => chargerJourCoursesFoyer(),
      resoudreLien: (date) => resoudreCycle(clientParDefaut(), { date }, aujourdhuiParis()),
      lien: lienInitial,
      maintenant: new Date(),
    })
      .then(({ jourCourses: jour, ancre: cible }) => {
        if (!actif) return true;
        setJourCourses(jour);
        setAujourdhuiISO(versISO(new Date()));
        return chargerCycle(cible, true);
      })
      .catch((erreur) => {
        console.error("Chargement initial du cycle échoué.", erreur);
        return false;
      })
      .then((ok) => {
        if (actif && !ok) setErreurInitiale(true);
      });
    return () => {
      actif = false;
    };
  }, [chargerCycle, lienInitial, essaiInitial]);

  function reessayerChargementInitial(): void {
    setErreurInitiale(false);
    setEssaiInitial((n) => n + 1);
  }

  // Squelette (`SquelettePlanning`) uniquement au premier chargement. Aux rechargements
  // (navigation entre cycles, génération), l'en-tête / état vide et le navigateur
  // restent montés (comme la semaine, #352) : pas de saut de mise en page, bascule
  // disponible, focus conservé sur la flèche cliquée ; seul le corps est estompé.
  if (ancre === null && erreurInitiale) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div
          role="alert"
          className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center"
        >
          <p className="font-medium text-red-800">Impossible de charger le cycle.</p>
          <p className="mt-1 text-sm text-red-700">Vérifie ta connexion et réessaie.</p>
        </div>
        <button
          type="button"
          onClick={reessayerChargementInitial}
          className="rounded-full bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (ancre === null) {
    return (
      <div className="flex-1 p-4 md:p-8">
        <SquelettePlanning titre="Mon planning du cycle" />
      </div>
    );
  }

  // Position du cycle affiché vs le cycle courant (#352). Calculé ici, après
  // chargement client : pas de mismatch d'hydratation (SSR = squelette).
  const offsetCycle = decalageCycles(ancre, ancreCourante(new Date(), jourCourses));
  const jours = joursDuCycle(ancre, longueur);
  // Chaque date → le JourPlanning correspondant (ou null si non planifié).
  const cellules = jours.map((dateISO) => {
    const { semaine, jour } = dateVersSemaineJour(dateISO);
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour) ?? null;
    return { dateISO, jp };
  });
  const aDesRepas = cellules.some((c) => c.jp !== null);
  // Grille commune avec la semaine (#352). Un jour non planifié garde ses deux
  // emplacements « Pas de repas prévu » (plus de « Rien de prévu. » à part) ;
  // ceux du jour courant sont accentués. Ni entrée en cascade ni atterrissage
  // ici (#353).
  const joursGrille: JourGrille[] = cellules.map(({ dateISO, jp }) => {
    const { semaine, jour } = dateVersSemaineJour(dateISO);
    const jourLabel = libelleJourComplet(dateISO);
    return {
      cle: dateISO,
      dateISO,
      slots: slotsDuJour(jour, jp, reglages).map((slot) => (
        <SlotRepas
          key={slot.typeRepas}
          libelle={slot.libelle}
          jourLabel={jourLabel}
          recette={slot.recette}
          indisponible={slotIndisponible === cleCreneau(dateISO, slot.typeRepas)}
          personnes={jp ? personnesDuSlot(jp, slot.typeRepas) : PERSONNES_DEFAUT}
          restes={jp ? estRestes(jp, slot.typeRepas) : false}
          onChanger={() => changerSlot(dateISO, semaine, jour, slot.typeRepas)}
          onSelectionner={() =>
            setSlotEnSelection({ dateISO, semaine, jour, typeRepas: slot.typeRepas })
          }
          onChangerPersonnes={(p) => changerPersonnesSlot(semaine, jour, slot.typeRepas, p)}
          onChangerRestes={(v) => changerRestesSlot(dateISO, semaine, jour, slot.typeRepas, v)}
          onVoir={() =>
            jp &&
            slot.recette &&
            setFicheOuverte({
              recette: slot.recette,
              personnes: personnesDuSlot(jp, slot.typeRepas),
            })
          }
          accentue={aujourdhuiISO !== null && dateISO === aujourdhuiISO}
        />
      )),
    };
  });

  // Navigateur de période (#352, partagé avec la semaine et /courses). Non
  // désactivé pendant un chargement (un bouton désactivé perdrait le focus) :
  // les flèches sont ignorées tant qu'un chargement est en cours.
  const naviguer = (delta: number) => {
    if (chargement) return;
    void file.vider().then(() => chargerCycle(cycleDecale(ancre, delta)));
  };
  const navigateur = (
    <NavigateurPeriode
      unite="cycle"
      libelle={libelleRelatifCycle(offsetCycle)}
      dates={datesCycle(ancre, longueur)}
      courante={offsetCycle === 0}
      peutReculer={offsetCycle > -CYCLES_PASSES}
      peutAvancer={offsetCycle < CYCLES_FUTURS}
      onPrecedente={() => naviguer(-1)}
      onSuivante={() => naviguer(1)}
    />
  );
  const generationEnCours = enGeneration || verrouAffiche;

  return (
    <>
      {!aDesRepas ? (
        // Cycle vide → génération directe, sans confirmation (#334). Rechargement :
        // seul le corps de l'état vide est estompé (titre, bascule, navigateur nets).
        <div className="flex flex-1 flex-col">
          <EtatVidePlanning
            titre="Mon planning du cycle"
            vue={vue}
            onChangerVue={onChangerVue}
            navigateur={navigateur}
            enAttente={generationEnCours}
            message="Aucun repas planifié sur ce cycle."
            libelleBouton="Générer mon cycle"
            libelleAttente="Génération…"
            onGenerer={() => void genererMonCycle()}
            generationEnCours={generationEnCours}
            chargement={chargement}
          />
        </div>
      ) : (
        <div className="flex-1 p-4 md:p-8">
          <EntetePlanning
            titre="Mon planning du cycle"
            vue={vue}
            onChangerVue={onChangerVue}
            libelleRegenerer={generationEnCours ? "Génération…" : "Régénérer"}
            // Cycle déjà rempli → confirmation (#334, miroir de RG-74 côté MCP) :
            // la régénération écrase les repas et purge les coches du foyer, sans
            // annulation possible.
            onRegenerer={() => setConfirmationGeneration(true)}
            regenerationEnCours={generationEnCours}
            hrefCourses={`/courses?ancre=${ancre}`}
            navigateur={navigateur}
          />
          {/* Rechargement (navigation, génération) : grille estompée, en-tête
              et navigateur restent montés. */}
          <div aria-busy={chargement}>
            <GrilleJours jours={joursGrille} aujourdhuiISO={aujourdhuiISO} enAttente={chargement} />
          </div>
        </div>
      )}

      {/* Fiche recette (US-10) — consultation depuis la vue cycle aussi. */}
      {ficheOuverte && (
        <FicheRecette
          recette={ficheOuverte.recette}
          personnes={ficheOuverte.personnes}
          modifiable={idsModifiables.has(ficheOuverte.recette.id)}
          onFermer={() => setFicheOuverte(null)}
        />
      )}

      {/* Sélecteur de recette (US-06) — monté seulement pendant la sélection. */}
      {slotEnSelection && (
        <SelecteurRecette
          titre={`${slotEnSelection.typeRepas === "diner" ? "Dîner" : "Déjeuner"} de ${libelleJourComplet(slotEnSelection.dateISO).toLowerCase()}`}
          recettes={recettes}
          idsAuPlanning={recettesUtilisees(
            planningDeLaSemaine(slotEnSelection.semaine) ?? { semaine: slotEnSelection.semaine, jours: [] }
          )}
          onSelectionner={selectionnerRecette}
          onRestes={() =>
            changerRestesSlot(
              slotEnSelection.dateISO,
              slotEnSelection.semaine,
              slotEnSelection.jour,
              slotEnSelection.typeRepas,
              true
            )
          }
          onFermer={() => setSlotEnSelection(null)}
        />
      )}

      {/* Confirmation avant de modifier un jour PASSÉ (US-14, RG-24). */}
      {confirmation && (
        <ConfirmationModale
          titre="Modifier un jour passé ?"
          message="Ce jour est déjà passé. Veux-tu vraiment modifier ce planning enregistré ?"
          libelleConfirmer="Modifier"
          onConfirmer={() => {
            const action = confirmation.executer;
            setConfirmation(null);
            action();
          }}
          onAnnuler={() => setConfirmation(null)}
        />
      )}

      {/* Régénération d'un cycle déjà rempli (#334) : action rare, destructive
          et partagée par tout le foyer, sans undo multi-semaines. */}
      {confirmationGeneration && (
        <ConfirmationModale
          titre="Régénérer ce cycle ?"
          message="Les repas déjà prévus sur ce cycle seront remplacés, et les articles cochés de la liste de courses seront décochés pour tout le foyer."
          libelleConfirmer="Régénérer"
          onConfirmer={() => {
            setConfirmationGeneration(false);
            void genererMonCycle();
          }}
          onAnnuler={() => setConfirmationGeneration(false)}
        />
      )}
    </>
  );
}
