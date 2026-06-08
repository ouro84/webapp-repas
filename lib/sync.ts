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
// ---------------------------------------------------------------------------
let hydratationEnCours = false;
let minuteur: ReturnType<typeof setTimeout> | null = null;

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

// Pousse le planning courant en base. En cas d'échec (réseau), conserve le
// drapeau `dirty` et bascule l'indicateur en « hors-ligne » : le push sera
// rejoué au prochain chargement ou au retour en ligne.
async function pousser(): Promise<void> {
  const planning = planningLocal();
  if (planning === null) return; // rien à pousser
  definirEtat("sauvegarde");
  try {
    await sauvegarderPlanningDistant(planning);
    localStorage.removeItem(CLE_DIRTY);
    definirEtat("synchronise");
  } catch (erreur) {
    localStorage.setItem(CLE_DIRTY, "1");
    definirEtat("hors-ligne");
    console.error("Synchronisation du planning échouée (sera rejouée).", erreur);
  }
}

// À chaque écriture locale du planning : horodate, marque dirty, planifie un
// push débounce. Ignoré pendant l'hydratation (sinon on repousserait en base
// ce qu'on vient d'en lire).
function planifierPush(): void {
  if (hydratationEnCours) return;
  localStorage.setItem(CLE_MAJ, new Date().toISOString());
  localStorage.setItem(CLE_DIRTY, "1");
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => void pousser(), DELAI_DEBOUNCE_MS);
}

/**
 * Hydrate le planning local depuis la base selon un last-write-wins horodaté.
 * Règle : un planning local SANS horodatage (injecté en test, ou antérieur à
 * cette feature) est considéré comme le plus frais — on ne le remplace pas.
 * Un device neuf (localStorage vide) récupère donc le planning distant.
 */
export async function hydrater(): Promise<void> {
  let distant: Awaited<ReturnType<typeof chargerPlanningDistant>>;
  try {
    distant = await chargerPlanningDistant();
  } catch (erreur) {
    console.error("Chargement du planning distant échoué.", erreur);
    return;
  }

  if (distant === null) {
    // Base vide : si on a une écriture locale en attente, la pousser.
    if (localStorage.getItem(CLE_DIRTY)) void pousser();
    return;
  }

  const majLocale = lireMajLocale();
  // Local présent mais non horodaté → considéré le plus frais (cf. règle).
  if (planningLocal() !== null && majLocale === 0) return;

  const majDistante = Date.parse(distant.updatedAt);
  if (majDistante > majLocale) {
    // La base gagne : on hydrate sans déclencher de push.
    hydratationEnCours = true;
    storePlanning.ecrire(JSON.stringify(distant.planning));
    localStorage.setItem(CLE_MAJ, distant.updatedAt);
    localStorage.removeItem(CLE_DIRTY);
    hydratationEnCours = false;
    definirEtat("synchronise");
  } else if (majLocale > majDistante) {
    // Le local est plus récent : on pousse pour converger.
    void pousser();
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
