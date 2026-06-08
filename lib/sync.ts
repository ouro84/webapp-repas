"use client";

// Synchronisation du planning entre devices (#6 PR2, US-13).
//
// Principe : la base est la source de vérité, localStorage est un cache. Un
// gestionnaire centralisé s'abonne au store planning et pousse automatiquement
// chaque écriture en base (débounce), sans toucher aux nombreux handlers. Au
// chargement, on hydrate depuis la base selon un last-write-wins horodaté.
//
// Pas de setState React ici : l'hydratation écrit via storePlanning.ecrire,
// dont useSyncExternalStore propage le changement aux pages.

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { storePlanning } from "@/lib/stockage";
import {
  chargerPlanningDistant,
  sauvegarderPlanningDistant,
} from "@/lib/persistance";
import type { Planning } from "@/types";

// Horodatage de la dernière écriture locale (last-write-wins) et drapeau
// « écriture en attente de push » (file hors-ligne minimale).
const CLE_MAJ = "planning_courant_maj";
const CLE_DIRTY = "planning_dirty";

const DELAI_DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// État de synchro (indicateur UI, bonus) — petit store externe en mémoire.
// ---------------------------------------------------------------------------
export type EtatSync = "synchronise" | "sauvegarde" | "hors-ligne";

let etat: EtatSync = "synchronise";
const abonnesEtat = new Set<() => void>();

function definirEtat(nouvel: EtatSync): void {
  if (etat === nouvel) return;
  etat = nouvel;
  for (const rappel of abonnesEtat) rappel();
}

const storeEtatSync = {
  sAbonner(rappel: () => void): () => void {
    abonnesEtat.add(rappel);
    return () => abonnesEtat.delete(rappel);
  },
  lire: (): EtatSync => etat,
  lireServeur: (): EtatSync => "synchronise",
};

// ---------------------------------------------------------------------------
// Mécanique de synchro
//
// Horloge de référence : `planning_courant_maj` = l'`updated_at` RENVOYÉ par la
// base (jamais l'horloge client) — posé uniquement au pull ou au push réussi.
// Une édition locale pose seulement `planning_dirty` : tant que dirty, le local
// fait foi et n'est JAMAIS écrasé par l'hydratation (évite le clobber dû au
// décalage d'horloges). Un cache non horodaté (legacy/injecté) est aussi
// considéré le plus frais ; un cache vide récupère la base.
// ---------------------------------------------------------------------------
let hydratationEnCours = false;
let pushEnCours = false;
let rePushDemande = false;
let minuteur: ReturnType<typeof setTimeout> | null = null;

function estDirty(): boolean {
  return localStorage.getItem(CLE_DIRTY) === "1";
}

function lireMajLocale(): number {
  const valeur = localStorage.getItem(CLE_MAJ);
  return valeur ? Date.parse(valeur) : 0;
}

function planningLocal(): Planning | null {
  const brut = storePlanning.lire();
  if (brut === null) return null;
  try {
    return JSON.parse(brut) as Planning;
  } catch {
    return null;
  }
}

// Pousse le planning courant en base. Sérialisé (garde `pushEnCours`) pour
// éviter les delete→insert concurrents (duplicate key / RLS). Au succès,
// l'horodatage local prend la valeur serveur renvoyée et `dirty` est levé ;
// à l'échec (réseau/hors-ligne), `dirty` reste et le push sera rejoué.
async function pousser(): Promise<void> {
  if (pushEnCours) {
    rePushDemande = true;
    return;
  }
  const planning = planningLocal();
  if (planning === null) return; // rien à pousser

  pushEnCours = true;
  definirEtat("sauvegarde");
  try {
    const majServeur = await sauvegarderPlanningDistant(planning);
    localStorage.setItem(CLE_MAJ, majServeur);
    localStorage.removeItem(CLE_DIRTY);
    definirEtat("synchronise");
  } catch (erreur) {
    definirEtat("hors-ligne");
    console.error("Synchronisation du planning échouée (sera rejouée).", erreur);
  } finally {
    pushEnCours = false;
    if (rePushDemande) {
      rePushDemande = false;
      void pousser();
    }
  }
}

// À chaque écriture locale du planning : marque `dirty` (le local diverge) et
// planifie un push débounce. On NE touche PAS l'horodatage (réservé au serveur).
// Ignoré pendant l'hydratation (sinon on repousserait ce qu'on vient de lire).
function planifierPush(): void {
  if (hydratationEnCours) return;
  localStorage.setItem(CLE_DIRTY, "1");
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => void pousser(), DELAI_DEBOUNCE_MS);
}

/**
 * Hydrate le planning local depuis la base. Le local fait foi s'il a des
 * changements non poussés (`dirty`) ou s'il n'est pas horodaté (legacy/injecté)
 * — on ne l'écrase jamais dans ces cas. Sinon, la base gagne quand son
 * `updated_at` est strictement plus récent (comparaison 100 % horloge serveur),
 * ou quand le cache local est vide (device neuf).
 */
export async function hydrater(): Promise<void> {
  // Changements locaux non poussés : le local gagne, on tente de converger.
  if (estDirty()) {
    void pousser();
    return;
  }

  let distant: Awaited<ReturnType<typeof chargerPlanningDistant>>;
  try {
    distant = await chargerPlanningDistant();
  } catch (erreur) {
    console.error("Chargement du planning distant échoué.", erreur);
    return;
  }
  if (distant === null) return; // rien à tirer

  const local = planningLocal();
  const majLocale = lireMajLocale();
  // Local présent mais non horodaté (legacy/injecté) → considéré le plus frais.
  if (local !== null && majLocale === 0) return;

  // Cache vide → on adopte la base ; sinon, la base gagne si strictement plus récente.
  if (local === null || Date.parse(distant.updatedAt) > majLocale) {
    hydratationEnCours = true;
    storePlanning.ecrire(JSON.stringify(distant.planning));
    localStorage.setItem(CLE_MAJ, distant.updatedAt);
    localStorage.removeItem(CLE_DIRTY);
    hydratationEnCours = false;
    definirEtat("synchronise");
  }
}

// Démarre la synchro : abonnement aux écritures du planning + rejeu au retour
// en ligne. Retourne une fonction d'arrêt (cleanup d'effet).
function demarrerSync(): () => void {
  const desabonner = storePlanning.sAbonner(planifierPush);
  const surRetourEnLigne = () => {
    if (localStorage.getItem(CLE_DIRTY)) void pousser();
  };
  window.addEventListener("online", surRetourEnLigne);
  return () => {
    desabonner();
    window.removeEventListener("online", surRetourEnLigne);
  };
}

/**
 * Hook de page : démarre la synchro et hydrate au montage, renvoie l'état de
 * synchro courant (pour l'indicateur). addEventListener + promesse, pas de
 * setState au montage → conforme à react-hooks/set-state-in-effect.
 */
export function useSyncPlanning(): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSync();
    void hydrater();
    return arreter;
  }, []);
  return etatCourant;
}
