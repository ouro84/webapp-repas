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
import { storeCoches, storePlanning } from "@/lib/stockage";
import {
  chargerCochesDistantes,
  chargerFoyerId,
  chargerLongueurCycle,
  chargerPlanningDistant,
  cocherArticleDistant,
  decocherArticleDistant,
  definirLongueurCycle,
  purgerCyclesAvant,
  purgerSemainesAvant,
  sauvegarderPlanningDistant,
  viderCochesDistantes,
} from "@/lib/persistance";
import { parserCoches, type Coches } from "@/lib/coches";
import {
  appliquerEvent,
  deriverOps,
  type EventCoche,
} from "@/lib/coches-sync";
import { signaturePlanning } from "@/lib/planning-diff";
import { createClient } from "@/lib/supabase/client";
import { semaineDecalee, semaineISO, semaineParDefaut } from "@/lib/semaines";
import {
  ancreCourante,
  cycleDecale,
  planningDuCycle,
  semainesDuCycle,
} from "@/lib/cycles";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import type { Planning } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Horodatage de la dernière écriture locale (last-write-wins) et drapeau
// « écriture en attente de push » (file hors-ligne minimale). Un jeu de clés
// par donnée synchronisée : planning et coches (US-13).
const CLE_MAJ = "planning_courant_maj";
const CLE_DIRTY = "planning_dirty";
// Coches : depuis #56 PR4 (par-article), seul `courses_dirty` (file d'opérations
// à pousser) sert. `courses_cochees_maj` est legacy — plus écrit, mais purgé au
// changement de foyer et en e2e pour ne pas laisser de valeur orpheline.
const CLE_MAJ_COCHES = "courses_cochees_maj";
const CLE_DIRTY_COCHES = "courses_dirty";
// Semaine actuellement affichée (navigation historique #5) — partagée
// planning ↔ courses.
const CLE_SEMAINE = "semaine_affichee";
// Cycle de courses actuellement affiché sur /courses (#257) : ancre (date ISO
// du jour de courses foyer) + longueur. JSON { ancre, longueur }. C'est CETTE
// ancre — pas la semaine — qui clé la chaîne coches (cf. ancreActive).
const CLE_CYCLE = "cycle_affiche";

const DELAI_DEBOUNCE_MS = 800;

/**
 * Réinitialise le cache local (planning + coches + drapeaux dirty/horodatage +
 * snapshot d'annulation) — à appeler après un changement de FOYER (#56 PR3 :
 * jonction / sortie). Sans ça, le dirty-first laisserait le cache de l'ANCIEN
 * foyer faire foi à la prochaine hydratation (et un push différé écrirait des
 * données périmées sous le NOUVEAU foyer). L'appelant recharge ensuite la page
 * pour réhydrater depuis la base du nouveau foyer. La semaine affichée
 * (CLE_SEMAINE) est conservée : elle reste pertinente d'un foyer à l'autre.
 */
export function reinitialiserCacheFoyer(): void {
  storePlanning.effacer();
  storeCoches.effacer();
  localStorage.removeItem(CLE_MAJ);
  localStorage.removeItem(CLE_DIRTY);
  localStorage.removeItem(CLE_MAJ_COCHES);
  localStorage.removeItem(CLE_DIRTY_COCHES);
  localStorage.removeItem("planning_snapshot"); // CLE_SNAPSHOT de lib/stockage
}

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
// Semaine affichée (#5) — store externe adossé à localStorage, partagé entre
// les pages planning et courses.
// ---------------------------------------------------------------------------
const abonnesSemaine = new Set<() => void>();

function definirSemaineAffichee(semaine: string): void {
  localStorage.setItem(CLE_SEMAINE, semaine);
  for (const rappel of abonnesSemaine) rappel();
}

const storeSemaine = {
  sAbonner(rappel: () => void): () => void {
    abonnesSemaine.add(rappel);
    window.addEventListener("storage", rappel);
    return () => {
      abonnesSemaine.delete(rappel);
      window.removeEventListener("storage", rappel);
    };
  },
  lire: (): string | null => localStorage.getItem(CLE_SEMAINE),
  lireServeur: (): string | null => null,
};

/** Semaine actuellement affichée (ISO), ou null avant hydratation. */
export function useSemaineAffichee(): string | null {
  return useSyncExternalStore(
    storeSemaine.sAbonner,
    storeSemaine.lire,
    storeSemaine.lireServeur
  );
}

// ---------------------------------------------------------------------------
// Cycle affiché (#257) — store externe adossé à localStorage. Porte l'ancre
// (date ISO) et la longueur du cycle courant sur /courses. C'est la source de
// `ancreActive()`, qui clé toute la chaîne coches (flush / hydrate / temps réel).
// ---------------------------------------------------------------------------
export type CycleAffiche = { ancre: string; longueur: number };

const abonnesCycle = new Set<() => void>();

function definirCycleAffiche(ancre: string, longueur: number): void {
  localStorage.setItem(CLE_CYCLE, JSON.stringify({ ancre, longueur }));
  for (const rappel of abonnesCycle) rappel();
}

function lireCycleAffiche(): CycleAffiche | null {
  try {
    const brut = localStorage.getItem(CLE_CYCLE);
    return brut ? (JSON.parse(brut) as CycleAffiche) : null;
  } catch {
    return null;
  }
}

const storeCycle = {
  sAbonner(rappel: () => void): () => void {
    abonnesCycle.add(rappel);
    window.addEventListener("storage", rappel);
    return () => {
      abonnesCycle.delete(rappel);
      window.removeEventListener("storage", rappel);
    };
  },
  lire: lireCycleAffiche,
  lireServeur: (): null => null,
};

/** Cycle actuellement affiché ({ ancre, longueur }), ou null avant hydratation. */
export function useCycleAffiche(): CycleAffiche | null {
  return useSyncExternalStore(
    storeCycle.sAbonner,
    storeCycle.lire,
    storeCycle.lireServeur
  );
}

// ---------------------------------------------------------------------------
// Planning PROJETÉ du cycle (#257) — store EN MÉMOIRE (pas de localStorage, pas
// de push). Contrairement à storePlanning (poussé en base par sauvegarder_planning),
// le planning du cycle est synthétique (semaine = une ancre-DATE, `jour` possiblement
// dupliqués sur un cycle > 7 j) : l'écrire dans storePlanning corromprait les données
// de planning. /courses lit donc son planning ICI (via useCyclePlanning).
// ---------------------------------------------------------------------------
let cyclePlanning: Planning | null = null;
const abonnesCyclePlanning = new Set<() => void>();

function definirCyclePlanning(planning: Planning | null): void {
  cyclePlanning = planning;
  for (const rappel of abonnesCyclePlanning) rappel();
}

const storeCyclePlanning = {
  sAbonner(rappel: () => void): () => void {
    abonnesCyclePlanning.add(rappel);
    return () => abonnesCyclePlanning.delete(rappel);
  },
  lire: (): Planning | null => cyclePlanning,
  lireServeur: (): Planning | null => null,
};

/** Planning projeté du cycle affiché (ou null avant hydratation). Pour /courses. */
export function useCyclePlanning(): Planning | null {
  return useSyncExternalStore(
    storeCyclePlanning.sAbonner,
    storeCyclePlanning.lire,
    storeCyclePlanning.lireServeur
  );
}

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
  rePushDemande = false; // toute écriture pendant ce push le repassera à true
  definirEtat("sauvegarde");
  try {
    const majServeur = await sauvegarderPlanningDistant(planning);
    localStorage.setItem(CLE_MAJ, majServeur);
    // Ne lever `dirty` que si AUCUNE écriture locale n'est survenue pendant le
    // push (sinon le local a re-divergé → on garde dirty et on rejoue).
    if (!rePushDemande) localStorage.removeItem(CLE_DIRTY);
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
  // Écriture pendant un push en cours : il rejouera (pas de clear de dirty).
  if (pushEnCours) {
    rePushDemande = true;
    return;
  }
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => void pousser(), DELAI_DEBOUNCE_MS);
}

// La logique « le local non poussé/non horodaté fait foi, sinon la base »
// vit désormais dans hydrater() (cas e2e/offline) et naviguerVers() (chargement
// d'une semaine précise) — cf. plus bas.

// ---------------------------------------------------------------------------
// Mécanique des coches PAR-ARTICLE + temps réel (#56 PR4, US-20, RG-32).
//
// La liste reste un BLOB localStorage (storeCoches) — page et lib/coches.ts
// inchangées. Mais la base stocke désormais UNE LIGNE PAR ARTICLE : pour ne pas
// s'écraser entre membres (RG-32), on ne pousse plus le blob entier. À chaque
// écriture locale on calcule le DIFF entre l'état déjà synchronisé
// (`cochesConnues`) et le blob courant → opérations par-article (cf. deriverOps)
// poussées en accès direct sous RLS. En sens inverse, un abonnement Supabase
// Realtime fusionne dans le blob les coches des autres membres.
//
// Pas d'horloge last-write-wins par blob : la granularité par-article rend le
// clobber improbable (clés distinctes = indépendantes), et sur une MÊME clé le
// dernier écrit en base gagne (acceptable pour une coche). `courses_dirty`
// signale simplement « des opérations restent à pousser » (file hors-ligne).
// ---------------------------------------------------------------------------
let hydratationCochesEnCours = false;
let flushCochesEnCours = false;
let reFlushCochesDemande = false;
let minuteurCoches: ReturnType<typeof setTimeout> | null = null;
// Vrai pendant l'application d'un event temps réel : l'écriture de storeCoches
// qui en découle ne doit PAS redéclencher de dérivation d'opérations.
let applicationDistanteEnCours = false;
// Dernier état réconcilié avec la base — référence du diff.
let cochesConnues: Coches = {};

function estDirtyCoches(): boolean {
  return localStorage.getItem(CLE_DIRTY_COCHES) === "1";
}

// Semaine du planning actif (#5) — clé de la chaîne PLANNING (push + temps réel
// planning sur /planning). NE clé PLUS les coches (cf. ancreActive).
function semaineActive(): string | null {
  return planningLocal()?.semaine ?? null;
}

// Ancre du CYCLE affiché (#257) — clé de toute la chaîne COCHES (flush / hydrate
// / temps réel des coches). Null tant qu'aucun cycle n'est affiché (ex. sur
// /planning avant toute visite de /courses) → les opérations coches y sont un
// no-op sûr (les gardes `ancre === null` retournent tôt).
function ancreActive(): string | null {
  return lireCycleAffiche()?.ancre ?? null;
}

function cochesLocales(): Coches {
  return parserCoches(storeCoches.lire());
}

// Écrit le blob dans storeCoches (efface si vide → cohérent avec RG-13).
function ecrireBlob(blob: Coches): void {
  if (Object.keys(blob).length === 0) storeCoches.effacer();
  else storeCoches.ecrire(JSON.stringify(blob));
}

// Pousse en base le DIFF entre `cochesConnues` et le blob courant. Sérialisé
// (garde `flushCochesEnCours`) ; recalcule le diff à chaque passage → converge
// même si l'état a rebougé pendant un flush. Au succès, `cochesConnues` rattrape
// le local et `courses_dirty` est levé ; à l'échec (hors-ligne) il est rejoué.
async function flusherCoches(): Promise<void> {
  if (flushCochesEnCours) {
    reFlushCochesDemande = true;
    return;
  }
  const ancre = ancreActive();
  if (ancre === null) {
    localStorage.removeItem(CLE_DIRTY_COCHES);
    return;
  }
  const local = cochesLocales();
  const ops = deriverOps(cochesConnues, local);
  if (ops.length === 0) {
    localStorage.removeItem(CLE_DIRTY_COCHES);
    return;
  }

  flushCochesEnCours = true;
  reFlushCochesDemande = false;
  definirEtat("sauvegarde");
  try {
    if (Object.keys(local).length === 0) {
      // Vidage complet (Tout décocher / régénération RG-13) → un seul DELETE.
      await viderCochesDistantes(ancre);
    } else {
      for (const op of ops) {
        if (op.type === "cocher") {
          await cocherArticleDistant(ancre, op.cle, op.quantite);
        } else {
          await decocherArticleDistant(ancre, op.cle);
        }
      }
    }
    cochesConnues = local;
    if (!reFlushCochesDemande) localStorage.removeItem(CLE_DIRTY_COCHES);
    definirEtat("synchronise");
  } catch (erreur) {
    definirEtat("hors-ligne");
    console.error("Synchronisation des coches échouée (sera rejouée).", erreur);
  } finally {
    flushCochesEnCours = false;
    if (reFlushCochesDemande) {
      reFlushCochesDemande = false;
      void flusherCoches();
    }
  }
}

// À chaque écriture locale des coches (hors hydratation et hors application d'un
// event distant) : marque `dirty` et planifie un flush débounce.
function surChangementCoches(): void {
  if (hydratationCochesEnCours || applicationDistanteEnCours) return;
  localStorage.setItem(CLE_DIRTY_COCHES, "1");
  if (flushCochesEnCours) {
    reFlushCochesDemande = true;
    return;
  }
  if (minuteurCoches) clearTimeout(minuteurCoches);
  minuteurCoches = setTimeout(() => void flusherCoches(), DELAI_DEBOUNCE_MS);
}

// Charge l'état distant d'une semaine dans le blob SANS dériver d'opérations
// (pose aussi la référence `cochesConnues`). Appelé à l'hydratation/navigation.
function appliquerBlobDistant(blob: Coches): void {
  applicationDistanteEnCours = true;
  ecrireBlob(blob);
  cochesConnues = blob;
  localStorage.removeItem(CLE_DIRTY_COCHES);
  applicationDistanteEnCours = false;
}

async function hydraterCoches(): Promise<void> {
  // Des opérations locales restent à pousser → le local fait foi (on flushe).
  if (estDirtyCoches()) {
    void flusherCoches();
    return;
  }
  const ancre = ancreActive();
  if (ancre === null) return;
  const local = cochesLocales();
  let distant: Coches;
  try {
    distant = await chargerCochesDistantes(ancre);
  } catch (erreur) {
    console.error("Chargement des coches distantes échoué.", erreur);
    return;
  }
  // L'utilisateur a pu cocher PENDANT le chargement réseau → ne pas écraser ses
  // modifs locales non synchronisées (le flush les poussera).
  if (estDirtyCoches()) {
    void flusherCoches();
    return;
  }
  // Dirty-first (comme le blob #6 quand `maj === 0`) : un blob local NON VIDE
  // fait foi au rechargement (reload/offline/e2e injecté) — on ne l'écrase pas
  // par le serveur ; on pousse plutôt le diff local ↔ serveur. Un cache vide,
  // lui, se laisse hydrater par le serveur (resync US-13).
  if (Object.keys(local).length > 0) {
    cochesConnues = distant; // référence = état serveur connu
    if (deriverOps(distant, local).length > 0) {
      localStorage.setItem(CLE_DIRTY_COCHES, "1");
      void flusherCoches();
    }
    return;
  }
  appliquerBlobDistant(distant);
}

// ---------------------------------------------------------------------------
// Temps réel (#56 PR4) — abonnement aux coches du foyer (postgres_changes) +
// présence anonyme « en magasin » (RG-31). Un seul client Supabase pour gérer
// les canaux (createBrowserClient n'est pas garanti singleton par appel).
// ---------------------------------------------------------------------------
let clientRealtime: ReturnType<typeof createClient> | null = null;
function client(): ReturnType<typeof createClient> {
  return (clientRealtime ??= createClient());
}

// Garantit que le client Realtime porte le JWT de session : sans ça, la RLS
// des events postgres_changes (foyer_id = mon_foyer()) ne laisse RIEN passer
// (échec SILENCIEUX). createBrowserClient câble normalement l'auth realtime,
// mais on le force explicitement par sûreté avant chaque abonnement.
async function assurerAuthRealtime(): Promise<void> {
  const { data } = await client().auth.getSession();
  const token = data.session?.access_token;
  if (token) client().realtime.setAuth(token);
}

let foyerIdCourant: string | null = null;
async function assurerFoyerId(): Promise<string | null> {
  if (foyerIdCourant) return foyerIdCourant;
  try {
    foyerIdCourant = await chargerFoyerId();
  } catch (erreur) {
    console.error("Chargement du foyer (temps réel) échoué.", erreur);
  }
  return foyerIdCourant;
}

// Applique un event Realtime au blob local (sans redériver d'opérations) et
// réconcilie la référence `cochesConnues` (l'état distant fait foi pour la clé).
function appliquerEventLocal(event: EventCoche): void {
  const avant = cochesLocales();
  const apres = appliquerEvent(avant, event);
  cochesConnues = appliquerEvent(cochesConnues, event);
  if (apres === avant) return; // idempotent (écho de notre propre écriture)
  applicationDistanteEnCours = true;
  ecrireBlob(apres);
  applicationDistanteEnCours = false;
}

type LigneArticle = Partial<{
  foyer_id: string;
  ancre: string;
  cle: string;
  quantite: number;
}>;

function surEventCoche(
  foyer: string,
  ancre: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: LigneArticle;
    old: LigneArticle;
  }
): void {
  // DELETE : la ligne est dans `old` (`new` vaut `{}`, pas null → un `??` la
  // raterait). INSERT/UPDATE : dans `new`. (REPLICA IDENTITY FULL garantit que
  // `old` porte foyer_id/ancre/cle au DELETE.)
  const ligne = (
    payload.eventType === "DELETE" ? payload.old : payload.new
  ) as LigneArticle;
  // Filtrage défensif (la RLS sécurise déjà, le filtre serveur cible l'ancre).
  if (ligne.foyer_id && ligne.foyer_id !== foyer) return;
  if (ligne.ancre && ligne.ancre !== ancre) return;
  if (!ligne.cle) return;
  appliquerEventLocal(
    payload.eventType === "DELETE"
      ? { type: "supprime", cle: ligne.cle }
      : { type: "upsert", cle: ligne.cle, quantite: Number(ligne.quantite) }
  );
}

// Retire de CE client tout canal portant ce topic. `channel(topic)` RÉUTILISE un
// canal existant : appeler `.on()` dessus après son `subscribe()` lève « cannot
// add callbacks after subscribe() ». On purge donc avant de recréer.
async function retirerCanalTopic(topic: string): Promise<void> {
  for (const canal of client().getChannels()) {
    if (canal.topic === `realtime:${topic}`) await client().removeChannel(canal);
  }
}

let canalCoches: RealtimeChannel | null = null;
let ancreAbonnee: string | null = null;
// Sérialise (dés)abonnements coches : le cleanup async d'un effet croise le
// montage suivant (nav SPA, double-invoke strict-mode en dev) → sans file, deux
// abonnements au même topic se chevauchent et lèvent l'erreur ci-dessus.
let chaineCoches: Promise<void> = Promise.resolve();

// (Ré)abonne le canal temps réel des coches à l'ancre (cycle) donnée (idempotent,
// sérialisé). Les erreurs sont avalées (journalisées) pour ne jamais devenir des
// unhandledRejection.
function synchroniserAbonnementCoches(ancre: string | null): Promise<void> {
  chaineCoches = chaineCoches
    .then(() => majAbonnementCoches(ancre))
    .catch((e) => console.error("Abonnement temps réel des coches échoué.", e));
  return chaineCoches;
}

async function majAbonnementCoches(ancre: string | null): Promise<void> {
  if (ancre === ancreAbonnee && (ancre === null || canalCoches)) return;
  ancreAbonnee = ancre;
  if (canalCoches) {
    await client().removeChannel(canalCoches);
    canalCoches = null;
  }
  if (ancre === null) return;
  const foyer = await assurerFoyerId();
  if (foyer === null || ancreAbonnee !== ancre) return; // ancre rechangée
  await assurerAuthRealtime();
  if (ancreAbonnee !== ancre) return;
  const topic = `coches:${foyer}:${ancre}`;
  await retirerCanalTopic(topic); // sécurité contre un canal résiduel de même topic
  canalCoches = client()
    .channel(topic)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "etat_courses_article",
        filter: `ancre=eq.${ancre}`,
      },
      (payload) => surEventCoche(foyer, ancre, payload)
    )
    .subscribe();
}

// Coupe les abonnements temps réel coches + planning (cleanup d'useSync). Chacun
// passe par sa file → la coupure ne croise jamais une création en cours.
function couperTempsReel(): Promise<void> {
  chaineCoches = chaineCoches
    .then(async () => {
      if (canalCoches) {
        await client().removeChannel(canalCoches);
        canalCoches = null;
      }
      ancreAbonnee = null;
    })
    .catch((e) => console.error("Arrêt temps réel des coches échoué.", e));
  chainePlanning = chainePlanning
    .then(async () => {
      if (canalPlanning) {
        await client().removeChannel(canalPlanning);
        canalPlanning = null;
      }
      semainePlanningAbonnee = null;
    })
    .catch((e) => console.error("Arrêt temps réel du planning échoué.", e));
  return Promise.all([chaineCoches, chainePlanning]).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Temps réel du PLANNING (#56 PR5, US-21) — alerte intrusive de modif.
//
// Un membre « en magasin » (sur /courses ou /planning) doit être prévenu, de
// façon BLOQUANTE, si un autre membre modifie le planning de la semaine affichée
// à la maison. On s'abonne aux changements de la ligne `planning` du foyer pour
// cette semaine ; à réception, on RE-PULL de force (on lève le « local fait
// foi » du #6) puis, si le contenu a vraiment changé (≠ écho de notre propre
// écriture), on déclenche l'alerte. Discriminant : l'`updated_at` serveur (#104)
// vs notre `planning_courant_maj` — notre propre push l'a déjà rattrapé, donc
// son écho est filtré ; un changement distant est strictement plus récent.
// ---------------------------------------------------------------------------
let alertePlanning = false;
const abonnesAlerte = new Set<() => void>();

function notifierAlerte(): void {
  for (const rappel of abonnesAlerte) rappel();
}

function declencherAlertePlanning(): void {
  if (alertePlanning) return;
  alertePlanning = true;
  notifierAlerte();
}

/** Acquitte l'alerte de modif planning (bouton « OK » de la modale). Les données
 *  ont déjà été re-pull au moment de l'event ; ne reste qu'à fermer. */
export function acquitterAlertePlanning(): void {
  if (!alertePlanning) return;
  alertePlanning = false;
  notifierAlerte();
}

const storeAlerte = {
  sAbonner(rappel: () => void): () => void {
    abonnesAlerte.add(rappel);
    return () => abonnesAlerte.delete(rappel);
  },
  lire: (): boolean => alertePlanning,
  lireServeur: (): boolean => false,
};

/** Vrai quand le planning de la semaine affichée vient d'être modifié par un
 *  autre membre (US-21). Faux hors abonnement / en SSR. */
export function useAlertePlanning(): boolean {
  return useSyncExternalStore(
    storeAlerte.sAbonner,
    storeAlerte.lire,
    storeAlerte.lireServeur
  );
}

let traitementPlanningEnCours = false;

// Re-pull forcé du planning de la semaine puis, si le contenu a changé, alerte.
async function traiterChangementPlanningDistant(semaine: string): Promise<void> {
  if (traitementPlanningEnCours) return;
  if (semaine !== semaineActive()) return; // l'utilisateur a navigué entre-temps
  traitementPlanningEnCours = true;
  try {
    const sigAvant = signaturePlanning(planningLocal());
    await chargerSemaineDansCache(semaine); // force le re-pull du planning
    if (semaineActive() === semaine && signaturePlanning(planningLocal()) !== sigAvant) {
      declencherAlertePlanning();
    }
  } finally {
    traitementPlanningEnCours = false;
  }
}

function surEventPlanning(
  foyer: string,
  semaine: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: { foyer_id?: string; semaine?: string; updated_at?: string };
    old: { foyer_id?: string; semaine?: string; updated_at?: string };
  }
): void {
  const ligne = payload.eventType === "DELETE" ? payload.old : payload.new;
  if (ligne.foyer_id && ligne.foyer_id !== foyer) return;
  if (ligne.semaine && ligne.semaine !== semaine) return;
  const majEvent = ligne.updated_at ? Date.parse(ligne.updated_at) : 0;
  // Écho de notre propre écriture ou pas plus récent que notre cache → ignorer.
  if (!Number.isFinite(majEvent) || majEvent <= lireMajLocale()) return;
  void traiterChangementPlanningDistant(semaine);
}

let canalPlanning: RealtimeChannel | null = null;
let semainePlanningAbonnee: string | null = null;
let chainePlanning: Promise<void> = Promise.resolve();

function synchroniserAbonnementPlanning(semaine: string | null): Promise<void> {
  chainePlanning = chainePlanning
    .then(() => majAbonnementPlanning(semaine))
    .catch((e) => console.error("Abonnement temps réel du planning échoué.", e));
  return chainePlanning;
}

async function majAbonnementPlanning(semaine: string | null): Promise<void> {
  if (semaine === semainePlanningAbonnee && (semaine === null || canalPlanning)) return;
  semainePlanningAbonnee = semaine;
  if (canalPlanning) {
    await client().removeChannel(canalPlanning);
    canalPlanning = null;
  }
  if (semaine === null) return;
  const foyer = await assurerFoyerId();
  if (foyer === null || semainePlanningAbonnee !== semaine) return;
  await assurerAuthRealtime();
  if (semainePlanningAbonnee !== semaine) return;
  const topic = `planning:${foyer}:${semaine}`;
  await retirerCanalTopic(topic);
  canalPlanning = client()
    .channel(topic)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "planning",
        filter: `semaine=eq.${semaine}`,
      },
      (payload) => surEventPlanning(foyer, semaine, payload)
    )
    .subscribe();
}

// ---- Présence anonyme « en magasin » (bonus validé, RG-31) ----
let canalPresence: RealtimeChannel | null = null;
let autresPresents = false;
const abonnesPresence = new Set<() => void>();
// Même sérialisation que les coches (cf. chaineCoches).
let chainePresence: Promise<void> = Promise.resolve();

function definirPresence(valeur: boolean): void {
  if (autresPresents === valeur) return;
  autresPresents = valeur;
  for (const rappel of abonnesPresence) rappel();
}

function assurerPresence(): Promise<void> {
  chainePresence = chainePresence
    .then(majPresence)
    .catch((e) => console.error("Présence temps réel échouée.", e));
  return chainePresence;
}

async function majPresence(): Promise<void> {
  if (canalPresence) return;
  const foyer = await assurerFoyerId();
  if (foyer === null) return;
  await assurerAuthRealtime();
  const topic = `presence-courses:${foyer}`;
  await retirerCanalTopic(topic);
  // Clé anonyme par onglet (RG-31 : aucun nom). Plusieurs membres ⇒ ≥ 2 clés.
  const cle = crypto.randomUUID();
  canalPresence = client()
    .channel(topic, { config: { presence: { key: cle } } })
    .on("presence", { event: "sync" }, () => {
      const etat = canalPresence?.presenceState() ?? {};
      definirPresence(Object.keys(etat).length > 1);
    })
    .subscribe((statut) => {
      if (statut === "SUBSCRIBED") void canalPresence?.track({ enMagasin: true });
    });
}

function couperPresence(): Promise<void> {
  chainePresence = chainePresence
    .then(async () => {
      if (canalPresence) {
        await client().removeChannel(canalPresence);
        canalPresence = null;
      }
      definirPresence(false);
    })
    .catch((e) => console.error("Arrêt de la présence échoué.", e));
  return chainePresence;
}

const storePresence = {
  sAbonner(rappel: () => void): () => void {
    abonnesPresence.add(rappel);
    return () => abonnesPresence.delete(rappel);
  },
  lire: (): boolean => autresPresents,
  lireServeur: (): boolean => false,
};

/**
 * Indique qu'un autre membre du foyer est aussi sur la liste de courses
 * (présence anonyme « en magasin », RG-31). À utiliser SUR la page courses
 * uniquement : le hook gère lui-même l'entrée/sortie du canal de présence, donc
 * le compteur ne reflète que les membres présents sur cette page. Faux hors
 * abonnement / en SSR.
 */
export function usePresenceCourses(): boolean {
  const present = useSyncExternalStore(
    storePresence.sAbonner,
    storePresence.lire,
    storePresence.lireServeur
  );
  useEffect(() => {
    void assurerPresence();
    return () => void couperPresence();
  }, []);
  return present;
}

// Vide la file d'écritures (planning + coches) avant un changement de semaine,
// pour ne rien perdre. Déclenche un push si nécessaire puis attend que la file
// soit vidée (borné). Renvoie true si tout est synchronisé (rien en attente).
async function attendreSync(): Promise<boolean> {
  if (estDirty() && !pushEnCours) {
    if (minuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
    void pousser();
  }
  if (estDirtyCoches() && !flushCochesEnCours) {
    if (minuteurCoches) {
      clearTimeout(minuteurCoches);
      minuteurCoches = null;
    }
    void flusherCoches();
  }
  for (
    let i = 0;
    i < 100 && (pushEnCours || flushCochesEnCours || estDirty() || estDirtyCoches());
    i++
  ) {
    await new Promise((r) => setTimeout(r, 30));
  }
  return !(estDirty() || estDirtyCoches());
}

// Charge une semaine dans le cache PLANNING SANS flush ni garde, et sans
// déclencher de push (gardes d'hydratation). Une semaine sans planning vide le
// cache → état vide. Pose la semaine affichée. Depuis #257, cette fonction ne
// touche PLUS aux coches : elles sont propres au CYCLE (clé = ancre, ≠ semaine)
// et gérées par chargerCycleDansCache (/courses). La page /planning n'affiche
// pas la liste de courses, donc aucun besoin d'y hydrater les coches.
async function chargerSemaineDansCache(semaine: string): Promise<void> {
  hydratationEnCours = true;
  try {
    const distant = await chargerPlanningDistant(semaine);
    if (distant) {
      storePlanning.ecrire(JSON.stringify(distant.planning));
      localStorage.setItem(CLE_MAJ, distant.updatedAt);
    } else {
      storePlanning.effacer();
      localStorage.removeItem(CLE_MAJ);
    }
    localStorage.removeItem(CLE_DIRTY);
    definirEtat("synchronise");
  } catch (erreur) {
    console.error("Chargement de la semaine échoué.", erreur);
  } finally {
    hydratationEnCours = false;
  }
  definirSemaineAffichee(semaine);
  // (Ré)abonne le temps réel du planning à la semaine désormais affichée.
  void synchroniserAbonnementPlanning(semaine);
}

/**
 * Affiche une autre semaine (navigation historique #5). Flushe d'abord les
 * écritures en attente de la semaine quittée (sinon perte) ; si le flush échoue
 * (hors-ligne), la navigation est annulée.
 */
export async function naviguerVers(semaine: string): Promise<void> {
  if (semaine === localStorage.getItem(CLE_SEMAINE)) return; // déjà affichée
  if (!(await attendreSync())) return; // hors-ligne : ne pas perdre les écritures
  await chargerSemaineDansCache(semaine);
}

// ---------------------------------------------------------------------------
// Cycle de courses (#257) — chargement / navigation / étirement.
//
// Un cycle = une ancre (date ISO du jour de courses foyer) + une longueur. Il se
// projette par-dessus le stockage par semaine ISO : on charge les 1-2 plannings
// des semaines touchées et on recolle le planning projeté (planningDuCycle) dans
// storeCyclePlanning (en mémoire, JAMAIS poussé). Les coches, elles, sont clées
// PAR ANCRE (etat_courses_article.ancre) — chargées ici et suivies en temps réel.
// ---------------------------------------------------------------------------

/**
 * Charge un cycle dans le cache : planning projeté (en mémoire) + coches (par
 * ancre) + abonnement temps réel des coches. Pose le cycle affiché. Utilisé par
 * /courses (hydratation, navigation, étirement). N'écrit JAMAIS dans storePlanning.
 */
async function chargerCycleDansCache(
  ancre: string,
  longueur: number
): Promise<void> {
  hydratationCochesEnCours = true;
  try {
    const semaines = semainesDuCycle(ancre, longueur);
    const resultats = await Promise.all(
      semaines.map((s) => chargerPlanningDistant(s))
    );
    const plannings = resultats
      .filter((r): r is { planning: Planning; updatedAt: string } => r !== null)
      .map((r) => r.planning);
    definirCyclePlanning(planningDuCycle(plannings, ancre, longueur));
    // Coches par-article (#56 PR4), clées par ancre (#257) : blob + référence.
    appliquerBlobDistant(await chargerCochesDistantes(ancre));
    definirEtat("synchronise");
  } catch (erreur) {
    console.error("Chargement du cycle échoué.", erreur);
  } finally {
    hydratationCochesEnCours = false;
  }
  definirCycleAffiche(ancre, longueur);
  // (Ré)abonne le temps réel des coches à l'ancre désormais affichée.
  void synchroniserAbonnementCoches(ancre);
}

/**
 * Hydrate le cycle courant (appelé au montage de /courses). L'ancre dérive du
 * jour de courses du foyer (fail-open lundi) ; la longueur est lue en base
 * (défaut 7). Purge de rétention best-effort (cycles > 12 semaines) — une fois.
 */
export async function hydraterCycle(): Promise<void> {
  const jour = await chargerJourCoursesFoyer().catch(() => 1); // fail-open : lundi
  const ancre = ancreCourante(new Date(), jour);
  const longueur = await chargerLongueurCycle(ancre);
  await chargerCycleDansCache(ancre, longueur);
  // Rétention (#257, miroir de purgerHistorique) : fire-and-forget, jamais bloquant.
  void purgerCyclesAvant(cycleDecale(ancre, -12)).catch(() => {});
}

/**
 * Navigue vers un autre cycle (offset en nombre de cycles, ± vs affiché). Flushe
 * d'abord les écritures en attente (sinon perte) ; si le flush échoue (hors-ligne),
 * la navigation est annulée. La longueur du cycle cible est lue en base.
 */
export async function naviguerCycle(offset: number): Promise<void> {
  const courant = lireCycleAffiche();
  if (!courant) return;
  if (!(await attendreSync())) return; // hors-ligne : ne pas perdre les écritures
  const ancre = cycleDecale(courant.ancre, offset);
  const longueur = await chargerLongueurCycle(ancre);
  await chargerCycleDansCache(ancre, longueur);
}

/**
 * Étire (ou raccourcit) le cycle affiché : persiste la nouvelle longueur puis
 * recharge le cycle (le planning projeté et les jours touchés changent).
 */
export async function etirerCycle(longueur: number): Promise<void> {
  const courant = lireCycleAffiche();
  if (!courant) return;
  await definirLongueurCycle(courant.ancre, longueur);
  await chargerCycleDansCache(courant.ancre, longueur);
}

// Hydratation UNE FOIS par session (par chargement complet de page). Les
// navigations SPA ne re-tirent pas : en session, le local fait foi. Un autre
// device se synchronise à son propre chargement. Réinitialisé à chaque
// rechargement complet (nouveau contexte JS).
let dejaHydrate = false;

// Rétention de l'historique (#5, RG-24) : on ne conserve en base que les
// ~12 dernières semaines, alignées sur la borne passée du navigateur. Purge
// best-effort au chargement de session (fire-and-forget : n'a aucun impact
// bloquant sur l'hydratation, un échec est simplement journalisé).
const RETENTION_SEMAINES = 12;
let dejaPurge = false;

function purgerHistorique(): void {
  if (dejaPurge) return;
  dejaPurge = true;
  const cutoff = semaineDecalee(semaineISO(new Date()), -RETENTION_SEMAINES);
  void purgerSemainesAvant(cutoff).catch((erreur) => {
    console.error("Purge de l'historique échouée (sans effet bloquant).", erreur);
  });
}

/**
 * Au premier montage : si un planning local non poussé (`dirty`) ou non
 * horodaté (legacy/injecté en test) existe, il fait foi (semaine affichée =
 * sa semaine) ; sinon on affiche la **semaine par défaut** (courante, ou
 * prochaine le week-end) depuis la base. Aux montages suivants (SPA), on pousse
 * seulement d'éventuels changements en attente — pas de re-tirage.
 */
export async function hydrater(): Promise<void> {
  if (dejaHydrate) {
    if (estDirty()) void pousser();
    if (estDirtyCoches()) void flusherCoches();
    return;
  }
  dejaHydrate = true;
  purgerHistorique(); // rétention 12 semaines (#5) — fire-and-forget

  const local = planningLocal();
  if (local && (estDirty() || lireMajLocale() === 0)) {
    // Cas e2e/offline : le local fait foi, on ne le remplace pas.
    definirSemaineAffichee(local.semaine);
    if (estDirty()) void pousser();
    await hydraterCoches();
    // Coches clées par CYCLE (#257) : réabonnement sur l'ancre active (null hors
    // /courses → no-op sûr), pas sur la semaine du planning.
    void synchroniserAbonnementCoches(ancreActive());
    void synchroniserAbonnementPlanning(local.semaine);
    return;
  }

  // Cas nominal : on affiche la semaine par défaut depuis la base (chargement
  // forcé — pas de garde « déjà affichée », car le cache peut être vide).
  await chargerSemaineDansCache(semaineParDefaut());
}

// Démarre la synchro : abonnement aux écritures (planning + coches), temps réel
// (coches du foyer + présence) + rejeu au retour en ligne. Retourne une fonction
// d'arrêt (cleanup d'effet).
function demarrerSync(): () => void {
  const desabonnerPlanning = storePlanning.sAbonner(planifierPush);
  const desabonnerCoches = storeCoches.sAbonner(surChangementCoches);
  const surRetourEnLigne = () => {
    if (estDirty()) void pousser();
    if (estDirtyCoches()) void flusherCoches();
  };
  window.addEventListener("online", surRetourEnLigne);
  // Temps réel (#56 PR4/PR5) : abonnement aux coches (par ANCRE de cycle, #257 —
  // null hors /courses → no-op) + au planning du foyer si une semaine/ancre est
  // déjà connue (nav SPA « à chaud » ; au chargement froid, l'abonnement est posé
  // par hydrater/chargerSemaineDansCache/chargerCycleDansCache une fois résolu).
  // La PRÉSENCE est gérée à part (usePresenceCourses).
  void synchroniserAbonnementCoches(ancreActive());
  void synchroniserAbonnementPlanning(semaineActive());
  return () => {
    desabonnerPlanning();
    desabonnerCoches();
    window.removeEventListener("online", surRetourEnLigne);
    void couperTempsReel();
  };
}

/**
 * Hook de page : démarre la synchro (planning + coches) et hydrate au montage,
 * renvoie l'état de synchro courant (pour l'indicateur). addEventListener +
 * promesse, pas de setState au montage → conforme à set-state-in-effect.
 */
export function useSync(): EtatSync {
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

// Démarre la synchro CÔTÉ COCHES uniquement (#257, pour /courses) : abonnement
// aux écritures de coches + temps réel des coches (par ancre) + rejeu au retour
// en ligne. Volontairement PAS d'abonnement storePlanning→push, PAS d'hydratation
// de la semaine, PAS de temps réel planning : /courses affiche un CYCLE (planning
// projeté en mémoire), pas la semaine du planning courant. Retourne l'arrêt.
function demarrerSyncCoches(): () => void {
  const desabonnerCoches = storeCoches.sAbonner(surChangementCoches);
  const surRetourEnLigne = () => {
    if (estDirtyCoches()) void flusherCoches();
  };
  window.addEventListener("online", surRetourEnLigne);
  // Réabonnement « à chaud » (nav SPA) ; au chargement froid, hydraterCycle pose
  // l'abonnement une fois l'ancre résolue.
  void synchroniserAbonnementCoches(ancreActive());
  return () => {
    desabonnerCoches();
    window.removeEventListener("online", surRetourEnLigne);
    void couperTempsReel();
  };
}

/**
 * Hook de page /courses (#257) : démarre la synchro des coches et hydrate le
 * CYCLE courant au montage (au lieu de la semaine). Renvoie l'état de synchro.
 * Ne wire ni le push planning ni le temps réel planning (cf. demarrerSyncCoches).
 */
export function useSyncCourses(): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSyncCoches();
    void hydraterCycle();
    return arreter;
  }, []);
  return etatCourant;
}
