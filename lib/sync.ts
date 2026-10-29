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

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { storeCoches, storePlanning } from "@/lib/stockage";
import {
  basculerCocheArticleManuelDistant,
  chargerArticlesManuelsDistants,
  chargerCochesDistantes,
  chargerFoyerId,
  chargerLongueurCycle,
  chargerPlanningDistant,
  cocherArticleDistant,
  creerArticleManuelDistant,
  decocherArticleDistant,
  definirLongueurCycle,
  modifierArticleManuelDistant,
  purgerCyclesAvant,
  purgerSemainesAvant,
  sauvegarderCycleDistant,
  sauvegarderPlanningDistant,
  sauvegarderSlotsDistant,
  supprimerArticleManuelDistant,
  viderCochesArticlesManuelsDistantes,
  viderCochesDistantes,
  type SaisieArticleManuel,
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
  ancreParDefaut,
  cycleDecale,
  LONGUEUR_DEFAUT,
  planningDuCycle,
  semainesDuCycle,
} from "@/lib/cycles";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { parseApiError } from "@/lib/errors";
import type { ArticleManuel, JourPlanning, Planning, SemaineGeneree } from "@/types";
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
// Planning PROJETÉ du cycle affiché (#257) — clé DÉDIÉE, distincte de
// `planning_courant` : ce planning est synthétique (jours possiblement
// dupliqués sur un cycle > 7 j), jamais poussé en base (cf. store plus bas).
const CLE_CYCLE_PLANNING = "cycle_planning";

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
  // Le foyer a changé → le cycle affiché et son planning projeté (#257) sont
  // périmés (autre foyer = autres plannings/jour de courses).
  localStorage.removeItem(CLE_CYCLE);
  localStorage.removeItem(CLE_CYCLE_PLANNING);
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
// Factory de store localStorage-JSON pour useSyncExternalStore (#257, refactor
// post-rétro). CENTRALISE la mémoïsation du parse : `lire` (getSnapshot) DOIT
// renvoyer une référence STABLE tant que la chaîne brute n'a pas changé — sinon
// useSyncExternalStore boucle → « Maximum update depth exceeded » (React #185) →
// error boundary. Ce bug est arrivé en #257 sur un store objet non mémoïsé ; la
// factory le rend STRUCTURELLEMENT impossible pour tout nouveau store. `ecrire`
// (null → removeItem) notifie les abonnés ; l'event `storage` couvre les autres
// onglets. Snapshot serveur = null (prérendu en état vide, cf. lib/stockage).
// N'utiliser QUE pour des stores JAMAIS poussés en base (cf. commentaires ci-
// dessous) — la persistance planning/coches a sa propre mécanique.
// ---------------------------------------------------------------------------
function creerStoreJSON<T>(cle: string) {
  const abonnes = new Set<() => void>();
  let cacheRaw: string | null = null;
  let cacheParsed: T | null = null;
  function lire(): T | null {
    let brut: string | null = null;
    try {
      brut = localStorage.getItem(cle);
    } catch {
      brut = null;
    }
    if (brut !== cacheRaw) {
      cacheRaw = brut;
      try {
        cacheParsed = brut ? (JSON.parse(brut) as T) : null;
      } catch {
        cacheParsed = null;
      }
    }
    return cacheParsed;
  }
  function ecrire(valeur: T | null): void {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, JSON.stringify(valeur));
    for (const rappel of abonnes) rappel();
  }
  return {
    sAbonner(rappel: () => void): () => void {
      abonnes.add(rappel);
      window.addEventListener("storage", rappel);
      return () => {
        abonnes.delete(rappel);
        window.removeEventListener("storage", rappel);
      };
    },
    lire,
    lireServeur: (): null => null,
    ecrire,
  };
}

// ---------------------------------------------------------------------------
// Cycle affiché (#257) — store adossé à localStorage. Porte l'ancre (date ISO)
// et la longueur du cycle courant sur /courses. Source de `ancreActive()`, qui
// clé toute la chaîne coches (flush / hydrate / temps réel).
// ---------------------------------------------------------------------------
export type CycleAffiche = { ancre: string; longueur: number };

const storeCycle = creerStoreJSON<CycleAffiche>(CLE_CYCLE);

export function definirCycleAffiche(ancre: string, longueur: number): void {
  storeCycle.ecrire({ ancre, longueur });
}

const lireCycleAffiche = storeCycle.lire;

/** Cycle actuellement affiché ({ ancre, longueur }), ou null avant hydratation. */
export function useCycleAffiche(): CycleAffiche | null {
  return useSyncExternalStore(
    storeCycle.sAbonner,
    storeCycle.lire,
    storeCycle.lireServeur
  );
}

// ---------------------------------------------------------------------------
// Planning PROJETÉ du cycle (#257) — store adossé à LOCALSTORAGE (clé dédiée
// CLE_CYCLE_PLANNING, distincte de `planning_courant`), mais JAMAIS poussé en
// base : contrairement à storePlanning (poussé par sauvegarder_planning), le
// planning du cycle est synthétique (semaine = une ancre-DATE, `jour`
// possiblement dupliqués sur un cycle > 7 j) — l'écrire dans storePlanning
// corromprait les données de planning, et `planifierPush` ne s'y abonne pas.
// localStorage évite le flash d'état vide au reload et permet aux e2e de le
// seeder. /courses lit ce planning via useCyclePlanning.
// ---------------------------------------------------------------------------
const storeCyclePlanning = creerStoreJSON<Planning>(CLE_CYCLE_PLANNING);

function definirCyclePlanning(planning: Planning | null): void {
  storeCyclePlanning.ecrire(planning);
}

const lireCyclePlanning = storeCyclePlanning.lire;

/** Planning projeté du cycle affiché (ou null avant hydratation). Pour /courses. */
export function useCyclePlanning(): Planning | null {
  return useSyncExternalStore(
    storeCyclePlanning.sAbonner,
    storeCyclePlanning.lire,
    storeCyclePlanning.lireServeur
  );
}

// ---------------------------------------------------------------------------
// Articles manuels du cycle (#216, US-47) — store en mémoire (PAS localStorage :
// contrairement aux coches, un article manuel vit en base dès sa création, pas
// de file offline à rejouer). Chargé/rechargé avec le cycle affiché (même ancre
// que les coches, cf. ancreActive) ; les mutations (créer/modifier/supprimer/
// cocher) écrivent en base PUIS mettent à jour le store localement (pas besoin
// d'attendre l'écho temps réel, qui reste idempotent pour les autres membres).
// ---------------------------------------------------------------------------
// Référence STABLE (pas un littéral `[]` recréé à chaque appel) : un
// getServerSnapshot qui renvoie une nouvelle référence à chaque appel fait
// boucler useSyncExternalStore (React #185, cf. piège CLAUDE.md #257).
const TABLEAU_ARTICLES_MANUELS_VIDE: ArticleManuel[] = [];
let articlesManuels: ArticleManuel[] = TABLEAU_ARTICLES_MANUELS_VIDE;
const abonnesArticlesManuels = new Set<() => void>();

function definirArticlesManuels(liste: ArticleManuel[]): void {
  articlesManuels = liste;
  for (const rappel of abonnesArticlesManuels) rappel();
}

const storeArticlesManuels = {
  sAbonner(rappel: () => void): () => void {
    abonnesArticlesManuels.add(rappel);
    return () => abonnesArticlesManuels.delete(rappel);
  },
  lire: (): ArticleManuel[] => articlesManuels,
  lireServeur: (): ArticleManuel[] => TABLEAU_ARTICLES_MANUELS_VIDE,
};

/** Articles manuels du cycle affiché (#216), triés par ordre de création. */
export function useArticlesManuels(): ArticleManuel[] {
  return useSyncExternalStore(
    storeArticlesManuels.sAbonner,
    storeArticlesManuels.lire,
    storeArticlesManuels.lireServeur
  );
}

// Ancre pour laquelle le chargement en cours a été lancé — un chargement
// résolu pour une ancre quittée entre-temps (navigation rapide) est ignoré.
let ancreArticlesManuelsChargee: string | null = null;

async function chargerArticlesManuelsDansCache(ancre: string): Promise<void> {
  ancreArticlesManuelsChargee = ancre;
  try {
    const liste = await chargerArticlesManuelsDistants(ancre);
    if (ancreArticlesManuelsChargee === ancre) definirArticlesManuels(liste);
  } catch (erreur) {
    console.error("Chargement des articles manuels échoué.", erreur);
  }
}

/** Ajoute un article manuel sur l'ancre affichée (RG-43). No-op hors cycle. */
export async function ajouterArticleManuel(saisie: SaisieArticleManuel): Promise<void> {
  const ancre = ancreActive();
  if (ancre === null) return;
  const cree = await creerArticleManuelDistant(ancre, saisie);
  definirArticlesManuels([...articlesManuels, cree]);
}

/** Modifie un article manuel EN PLACE (RG-43 bis) : conserve id et coché. */
export async function modifierArticleManuel(
  id: string,
  saisie: SaisieArticleManuel
): Promise<void> {
  await modifierArticleManuelDistant(id, saisie);
  definirArticlesManuels(
    articlesManuels.map((a) =>
      a.id === id
        ? {
            ...a,
            libelle: saisie.libelle,
            quantite: saisie.quantite,
            unite: saisie.unite,
            categorie: saisie.categorie,
            fondDePlacard: saisie.fondDePlacard,
          }
        : a
    )
  );
}

/** Bascule l'état coché d'un article manuel (colonne dédiée, indépendante du
 *  blob de coches RG-12). Optimiste : revert local si l'écriture échoue. */
export async function basculerCocheArticleManuel(id: string): Promise<void> {
  const article = articlesManuels.find((a) => a.id === id);
  if (!article) return;
  const coche = !article.coche;
  definirArticlesManuels(articlesManuels.map((a) => (a.id === id ? { ...a, coche } : a)));
  try {
    await basculerCocheArticleManuelDistant(id, coche);
  } catch (erreur) {
    definirArticlesManuels(articlesManuels.map((a) => (a.id === id ? { ...a, coche: !coche } : a)));
    throw erreur;
  }
}

/** Supprime un article manuel (RG-42). */
export async function supprimerArticleManuel(id: string): Promise<void> {
  await supprimerArticleManuelDistant(id);
  definirArticlesManuels(articlesManuels.filter((a) => a.id !== id));
}

/** Décoche tous les articles manuels du cycle affiché SANS les supprimer
 *  (RG-41, « Tout décocher »). No-op hors cycle.
 *
 *  OPTIMISTE, comme basculerCocheArticleManuel ci-dessus — et pour une raison
 *  qui dépasse la latence perçue : `/courses` appelle cette fonction depuis
 *  `avecTransition()`, dont le `flushSync` n'entoure QUE la portion synchrone
 *  du callback. Une mise à jour du store placée APRÈS le premier `await` est
 *  appliquée une fois l'état d'arrivée déjà capturé → les articles manuels
 *  sautaient hors transition, un aller-retour réseau après les coches
 *  localStorage. Règle générale : toute mutation appelée depuis
 *  `avecTransition` applique sa partie locale AVANT son premier `await`. */
export async function viderCochesArticlesManuels(): Promise<void> {
  const ancre = ancreActive();
  if (ancre === null) return;
  const avant = articlesManuels;
  definirArticlesManuels(articlesManuels.map((a) => ({ ...a, coche: false })));
  try {
    await viderCochesArticlesManuelsDistantes(ancre);
  } catch (erreur) {
    definirArticlesManuels(avant);
    throw erreur;
  }
}

// Applique un event Realtime article_manuel au store (INSERT/UPDATE = upsert
// par id, DELETE = retrait). Idempotent vis-à-vis de nos propres écritures
// (déjà appliquées localement par les fonctions ci-dessus) : ré-appliquer le
// même contenu ne change rien d'observable.
function surEventArticleManuel(
  foyer: string,
  ancre: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: Partial<{ id: string; foyer_id: string; ancre: string }> & Record<string, unknown>;
    old: Partial<{ id: string; foyer_id: string; ancre: string }>;
  }
): void {
  if (payload.eventType === "DELETE") {
    const old = payload.old;
    if (old.foyer_id && old.foyer_id !== foyer) return;
    if (old.ancre && old.ancre !== ancre) return;
    if (!old.id) return;
    definirArticlesManuels(articlesManuels.filter((a) => a.id !== old.id));
    return;
  }
  const ligne = payload.new;
  if (ligne.foyer_id && ligne.foyer_id !== foyer) return;
  if (ligne.ancre && ligne.ancre !== ancre) return;
  if (!ligne.id) return;
  const article: ArticleManuel = {
    id: String(ligne.id),
    libelle: String(ligne.libelle ?? ""),
    quantite: (ligne.quantite as number | null) ?? null,
    unite: (ligne.unite as ArticleManuel["unite"]) ?? null,
    categorie: (ligne.categorie as ArticleManuel["categorie"]) ?? "autre",
    fondDePlacard: Boolean(ligne.fond_de_placard),
    coche: Boolean(ligne.coche),
  };
  const existe = articlesManuels.some((a) => a.id === article.id);
  definirArticlesManuels(
    existe
      ? articlesManuels.map((a) => (a.id === article.id ? article : a))
      : [...articlesManuels, article]
  );
}

let canalArticlesManuels: RealtimeChannel | null = null;
let ancreArticlesManuelsAbonnee: string | null = null;
let chaineArticlesManuels: Promise<void> = Promise.resolve();

function synchroniserAbonnementArticlesManuels(ancre: string | null): Promise<void> {
  chaineArticlesManuels = chaineArticlesManuels
    .then(() => majAbonnementArticlesManuels(ancre))
    .catch((e) => console.error("Abonnement temps réel des articles manuels échoué.", e));
  return chaineArticlesManuels;
}

async function majAbonnementArticlesManuels(ancre: string | null): Promise<void> {
  if (ancre === ancreArticlesManuelsAbonnee && (ancre === null || canalArticlesManuels)) return;
  ancreArticlesManuelsAbonnee = ancre;
  if (canalArticlesManuels) {
    await client().removeChannel(canalArticlesManuels);
    canalArticlesManuels = null;
  }
  if (ancre === null) return;
  const foyer = await assurerFoyerId();
  if (foyer === null || ancreArticlesManuelsAbonnee !== ancre) return;
  await assurerAuthRealtime();
  if (ancreArticlesManuelsAbonnee !== ancre) return;
  const topic = `articles-manuels:${foyer}:${ancre}`;
  await retirerCanalTopic(topic);
  canalArticlesManuels = client()
    .channel(topic)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "article_manuel", filter: `ancre=eq.${ancre}` },
      (payload) => surEventArticleManuel(foyer, ancre, payload)
    )
    .subscribe();
}

function couperArticlesManuels(): Promise<void> {
  chaineArticlesManuels = chaineArticlesManuels
    .then(async () => {
      if (canalArticlesManuels) {
        await client().removeChannel(canalArticlesManuels);
        canalArticlesManuels = null;
      }
      ancreArticlesManuelsAbonnee = null;
    })
    .catch((e) => console.error("Arrêt temps réel des articles manuels échoué.", e));
  return chaineArticlesManuels;
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
  return Promise.all([
    chaineCoches,
    chainePlanning,
    couperPlanningCycle(),
    couperArticlesManuels(),
  ]).then(() => undefined);
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

// ---------------------------------------------------------------------------
// Temps réel du PLANNING côté CYCLE (#259, PR2) — restaure l'alerte US-21 sur
// /courses (limitation de PR1). Un cycle touche 1-2 semaines ISO : on s'abonne à
// la table `planning` pour CHACUNE. À réception d'un changement, on re-projette
// le cycle depuis la base et on compare la signature AVANT/APRÈS ; si le contenu
// visible du cycle a changé, on déclenche l'alerte intrusive (réutilise le même
// store/modale que #56 PR5). L'écho de notre PROPRE génération est filtré par la
// signature (rafraichirCycleGenere a déjà posé le nouveau contenu localement) et,
// pendant la fenêtre de génération, par le drapeau `suppressionAlerteCycle`.
// ---------------------------------------------------------------------------
let suppressionAlerteCycle = false;
let traitementCycleEnCours = false;
// Dernier updated_at serveur connu PAR SEMAINE ISO du cycle (discriminant écho /
// changement distant, comme `planning_courant_maj` pour la semaine #56 PR5) : un
// event dont l'updated_at est <= au connu est un écho de notre propre écriture
// (ou un event obsolète) → ignoré. Rempli à chaque pull et à chaque push cycle.
const majPlanningCycle = new Map<string, number>();

// Re-projette le cycle affiché depuis la base (planning des 1-2 semaines
// touchées). Écrase la projection locale (contrairement à chargerCycleDansCache,
// PAS de dirty-first : un re-pull US-21/génération DOIT refléter la base).
// Mémorise au passage l'updated_at de chaque semaine (discriminant d'écho).
async function rechargerProjectionCycle(ancre: string, longueur: number): Promise<void> {
  const semaines = semainesDuCycle(ancre, longueur);
  const resultats = await Promise.all(semaines.map((s) => chargerPlanningDistant(s)));
  const plannings: Planning[] = [];
  semaines.forEach((s, i) => {
    const r = resultats[i];
    majPlanningCycle.set(s, r ? Date.parse(r.updatedAt) : 0);
    if (r) plannings.push(r.planning);
  });
  definirCyclePlanning(planningDuCycle(plannings, ancre, longueur));
}

async function traiterChangementCycleDistant(): Promise<void> {
  if (suppressionAlerteCycle || traitementCycleEnCours) return;
  const courant = lireCycleAffiche();
  if (!courant) return;
  traitementCycleEnCours = true;
  try {
    const sigAvant = signaturePlanning(lireCyclePlanning());
    await rechargerProjectionCycle(courant.ancre, courant.longueur);
    if (
      lireCycleAffiche()?.ancre === courant.ancre &&
      signaturePlanning(lireCyclePlanning()) !== sigAvant
    ) {
      declencherAlertePlanning();
    }
  } finally {
    traitementCycleEnCours = false;
  }
}

// Canaux planning du cycle, un par semaine ISO touchée (clés = semaine).
const canauxPlanningCycle = new Map<string, RealtimeChannel>();
let chainePlanningCycle: Promise<void> = Promise.resolve();

// Filtre l'écho de nos propres écritures (updated_at <= connu pour la semaine)
// avant de traiter un changement distant du planning du cycle (US-21).
function surEventPlanningCycle(
  semaine: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: { updated_at?: string };
    old: { updated_at?: string };
  }
): void {
  const ligne = payload.eventType === "DELETE" ? payload.old : payload.new;
  const majEvent = ligne.updated_at ? Date.parse(ligne.updated_at) : 0;
  if (!Number.isFinite(majEvent) || majEvent <= (majPlanningCycle.get(semaine) ?? 0)) {
    return; // écho de notre propre écriture ou event obsolète
  }
  void traiterChangementCycleDistant();
}

function synchroniserAbonnementPlanningCycle(
  ancre: string | null,
  longueur: number
): Promise<void> {
  chainePlanningCycle = chainePlanningCycle
    .then(() => majAbonnementPlanningCycle(ancre, longueur))
    .catch((e) => console.error("Abonnement temps réel du planning (cycle) échoué.", e));
  return chainePlanningCycle;
}

async function majAbonnementPlanningCycle(
  ancre: string | null,
  longueur: number
): Promise<void> {
  const voulues = ancre ? new Set(semainesDuCycle(ancre, longueur)) : new Set<string>();
  // Retire les canaux des semaines qui ne font plus partie du cycle.
  for (const [s, canal] of canauxPlanningCycle) {
    if (!voulues.has(s)) {
      await client().removeChannel(canal);
      canauxPlanningCycle.delete(s);
    }
  }
  if (voulues.size === 0) return;
  const foyer = await assurerFoyerId();
  if (foyer === null) return;
  await assurerAuthRealtime();
  for (const s of voulues) {
    if (canauxPlanningCycle.has(s)) continue;
    const topic = `planning-cycle:${foyer}:${s}`;
    await retirerCanalTopic(topic);
    const canal = client()
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "planning", filter: `semaine=eq.${s}` },
        (payload) => surEventPlanningCycle(s, payload)
      )
      .subscribe();
    canauxPlanningCycle.set(s, canal);
  }
}

function couperPlanningCycle(): Promise<void> {
  chainePlanningCycle = chainePlanningCycle
    .then(async () => {
      for (const canal of canauxPlanningCycle.values()) {
        await client().removeChannel(canal);
      }
      canauxPlanningCycle.clear();
    })
    .catch((e) => console.error("Arrêt temps réel du planning (cycle) échoué.", e));
  return chainePlanningCycle;
}

/**
 * Applique une génération fenêtrée (#259) : persiste le cycle en UNE écriture
 * atomique via la RPC `sauvegarder_cycle` (#304) — jours du cycle sur toutes les
 * semaines ISO touchées (sans écraser les jours voisins) ET purge des coches du
 * cycle (RG-13) dans la même transaction —, puis remet à zéro les coches locales
 * et re-projette depuis la base. Même RPC que le serveur MCP (règle du jumeau).
 * Le drapeau `suppressionAlerteCycle` évite que l'écho realtime de nos propres
 * écritures ne déclenche l'alerte US-21 pendant la fenêtre de génération.
 */
export async function appliquerGenerationCycle(
  ancre: string,
  semaines: SemaineGeneree[]
): Promise<void> {
  suppressionAlerteCycle = true;
  try {
    const majs = await sauvegarderCycleDistant(ancre, semaines);
    // Mémorise l'updated_at de notre propre écriture → son écho realtime sera
    // filtré (en plus du drapeau de suppression, cf. surEventPlanningCycle).
    for (const [semaine, maj] of Object.entries(majs)) {
      majPlanningCycle.set(semaine, Date.parse(maj));
    }
    await rafraichirCycleGenere();
  } finally {
    suppressionAlerteCycle = false;
  }
}

export type ResultatGenerationCycle = {
  vegeNonHonore: number;
  mixNonHonore: number;
  saisonNonHonore: number;
};

/**
 * Génération fenêtrée partagée entre `/courses` (bouton historique, #259) et
 * la vue Cycle de `/planning` (#279) — extrait de l'ancien `genererMonCycle`
 * local à `app/courses/page.tsx`, comportement identique. `genererCycle` lève
 * en cas d'échec (réseau ou réponse non-ok, message déjà formaté via
 * `parseApiError`) — pas de toast ici : cette fonction vit dans `lib/`, le
 * feedback UI reste la responsabilité de la page (cf. CLAUDE.md règle 2,
 * « app/ pour l'UI, lib/ pour la logique »).
 */
export function useGenerationCycle(cycle: CycleAffiche | null): {
  enGeneration: boolean;
  genererCycle: () => Promise<ResultatGenerationCycle>;
} {
  const [enGeneration, setEnGeneration] = useState(false);

  async function genererCycle(): Promise<ResultatGenerationCycle> {
    if (!cycle) throw new Error("Aucun cycle affiché.");
    setEnGeneration(true);
    try {
      const reponse = await fetch("/api/planning/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ancre: cycle.ancre, longueur: cycle.longueur }),
      });
      if (!reponse.ok) {
        throw new Error(await parseApiError(reponse));
      }
      const {
        semaines,
        vegeNonHonore = 0,
        mixNonHonore = 0,
        saisonNonHonore = 0,
      } = (await reponse.json()) as {
        semaines: SemaineGeneree[];
        vegeNonHonore?: number;
        mixNonHonore?: number;
        saisonNonHonore?: number;
      };
      await appliquerGenerationCycle(cycle.ancre, semaines);
      return { vegeNonHonore, mixNonHonore, saisonNonHonore };
    } finally {
      setEnGeneration(false);
    }
  }

  return { enGeneration, genererCycle };
}

/** Remet à zéro les coches LOCALES du cycle affiché (RG-13 — la purge distante
 *  est faite par la RPC `sauvegarder_cycle`, #304) et re-projette le planning
 *  depuis la base (après une génération fenêtrée). */
async function rafraichirCycleGenere(): Promise<void> {
  const courant = lireCycleAffiche();
  if (!courant) return;
  localStorage.removeItem(CLE_DIRTY_COCHES);
  cochesConnues = {};
  applicationDistanteEnCours = true;
  storeCoches.effacer();
  applicationDistanteEnCours = false;
  await rechargerProjectionCycle(courant.ancre, courant.longueur);
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
// storeCyclePlanning (localStorage, clé dédiée CLE_CYCLE_PLANNING, JAMAIS poussé).
// Les coches, elles, sont clées PAR ANCRE (etat_courses_article.ancre) — chargées
// ici et suivies en temps réel.
// ---------------------------------------------------------------------------

/**
 * Charge un cycle dans le cache : planning projeté (localStorage) + coches (par
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
    const plannings: Planning[] = [];
    semaines.forEach((s, i) => {
      const r = resultats[i];
      // Mémorise l'updated_at par semaine (discriminant d'écho realtime, US-21).
      majPlanningCycle.set(s, r ? Date.parse(r.updatedAt) : 0);
      if (r) plannings.push(r.planning);
    });
    const projete = planningDuCycle(plannings, ancre, longueur);
    // Local fait foi si le backend n'a RIEN pour cette ancre (#257) — miroir du
    // « planning local non horodaté fait foi » du #6/#104, adapté au cycle (qui
    // n'a pas d'horodatage propre : c'est un planning SYNTHÉTIQUE, jamais poussé
    // en base, cf. commentaire de CLE_CYCLE_PLANNING plus haut). Utile en e2e
    // (planning injecté directement dans `cycle_planning`, le backend étant vidé
    // par `nettoyerEtatDistant`) et en offline (rien à récupérer du serveur). On
    // ne garde le local QUE s'il porte la MÊME ancre que celle visée : une
    // navigation vers une autre ancre ne doit jamais hériter du cache d'une
    // ancre différente (l'état vide reste correct dans ce cas).
    const local = lireCyclePlanning();
    const localFaitFoi =
      projete.jours.length === 0 &&
      local !== null &&
      local.semaine === ancre &&
      local.jours.length > 0;
    if (!localFaitFoi) {
      definirCyclePlanning(projete);
    }
    // Pose l'ancre affichée AVANT toute opération sur les coches : `flusherCoches`
    // lit `ancreActive()` (dérivé du cycle affiché) et doit donc viser le NOUVEAU
    // cycle, pas l'ancien — sinon un flush dirty-first pousserait sous la mauvaise
    // ancre. Déplacé depuis après le bloc coches/try (#257, revue).
    definirCycleAffiche(ancre, longueur);
    // Coches par-article (#56 PR4), clées par ancre (#257) : dirty-first — des
    // coches locales NON poussées font foi, on ne les écrase pas par le serveur
    // (miroir de la garde de `hydraterCoches`, désormais inaccessible pour /courses).
    if (estDirtyCoches()) {
      void flusherCoches(); // des coches locales non poussées font foi
    } else {
      appliquerBlobDistant(await chargerCochesDistantes(ancre));
    }
    // Articles manuels (#216) : scopés par la même ancre, pas de dirty-first
    // (aucune file offline — chaque mutation écrit en base immédiatement).
    await chargerArticlesManuelsDansCache(ancre);
    definirEtat("synchronise");
  } catch (erreur) {
    console.error("Chargement du cycle échoué.", erreur);
  } finally {
    hydratationCochesEnCours = false;
  }
  // (Ré)abonne le temps réel des coches à l'ancre désormais affichée + le
  // temps réel du PLANNING sur les 1-2 semaines du cycle (alerte US-21, #259)
  // + le temps réel des articles manuels (#216).
  void synchroniserAbonnementCoches(ancre);
  void synchroniserAbonnementPlanningCycle(ancre, longueur);
  void synchroniserAbonnementArticlesManuels(ancre);
}

/**
 * Hydrate le cycle courant (appelé au montage de /courses). L'ancre dérive du
 * jour de courses du foyer (fail-open lundi) ; la longueur est lue en base
 * (défaut 7). Purge de rétention best-effort (cycles > 12 semaines) — une fois.
 */
export async function hydraterCycle(): Promise<void> {
  const jour = await chargerJourCoursesFoyer().catch(() => 1); // fail-open : lundi
  // ancreParDefaut (pas ancreCourante) : le week-end, la génération vise la
  // semaine prochaine (semaineParDefaut) → on décale le cycle par défaut pour la
  // couvrir, sinon /courses afficherait un cycle courant vide/écoulé (#257).
  const ancre = ancreParDefaut(new Date(), jour);
  // Gardé (revue) : une rejection non catchée deviendrait un unhandledRejection
  // sous `void hydraterCycle()` — repli sur LONGUEUR_DEFAUT au lieu de planter.
  const longueur = await chargerLongueurCycle(ancre).catch(() => LONGUEUR_DEFAUT);
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
 * Navigue vers une ancre ABSOLUE (#279, relais one-shot `?ancre=` depuis
 * `/planning`) — miroir de `naviguerCycle`, mais sans décalage relatif : pas
 * besoin d'un cycle déjà affiché (contrairement à `naviguerCycle`, qui lit
 * `lireCycleAffiche()` pour calculer le décalage). Flush les écritures en
 * attente PUIS charge l'ancre cible. Appelée par `useSyncCourses` quand une
 * ancre est imposée au montage.
 */
export async function allerAuCycle(ancre: string): Promise<void> {
  if (!(await attendreSync())) return; // hors-ligne : ne pas perdre les écritures
  const longueur = await chargerLongueurCycle(ancre);
  await chargerCycleDansCache(ancre, longueur);
}

/**
 * Édition ponctuelle d'UN slot depuis la vue Cycle (#279 suite, retour
 * utilisateur post-merge #281) — écrit directement en base pour la semaine ISO
 * du jour édité, SANS jamais toucher `storePlanning` (mono-semaine). Réutilise
 * `sauvegarderSlotsDistant` (RPC `sauvegarder_slots`, #259) qui n'upserte que
 * les `(jour, type_repas)` présents sur `jourPlanning` — passer un seul repas
 * renseigné ne touche pas l'autre repas du même jour.
 *
 * Met à jour les DEUX bookkeeping anti-écho existants, sinon on déclenche une
 * fausse alerte intrusive sur sa propre édition :
 * - `majPlanningCycle` (temps réel de /courses, #259) : toujours, quelle que
 *   soit la semaine — /courses peut avoir sa propre vue cycle ouverte ailleurs.
 * - `planning_courant_maj` + cache `storePlanning` (alerte de /planning, #56
 *   PR5) : UNIQUEMENT si la semaine éditée est la semaine actuellement
 *   affichée — sinon ce cache ne représente pas cette semaine, rien à patcher.
 *
 * Ce patch passe sous la garde `hydratationEnCours` (#301) : la base est DÉJÀ
 * à jour via `sauvegarder_slots`, donc `planifierPush` ne doit pas relancer un
 * `sauvegarder_planning` de toute la semaine (double écriture). Une édition
 * locale déjà en attente (`planning_dirty`) garde son propre minuteur et
 * repoussera la semaine, patch inclus.
 */
export async function modifierSlotDistant(
  semaine: string,
  jourPlanning: JourPlanning
): Promise<void> {
  const maj = await sauvegarderSlotsDistant(semaine, [jourPlanning]);
  majPlanningCycle.set(semaine, Date.parse(maj));

  if (semaine === localStorage.getItem(CLE_SEMAINE)) {
    localStorage.setItem(CLE_MAJ, maj);
    const local = planningLocal();
    if (local && local.semaine === semaine) {
      const jours = local.jours.map((jp) =>
        jp.jour === jourPlanning.jour ? jourPlanning : jp
      );
      // Restaure la valeur précédente (et non `false`) : une relecture
      // (chargerSemaineDansCache) peut tenir la garde pendant son `await`.
      const gardeAvant = hydratationEnCours;
      hydratationEnCours = true;
      try {
        storePlanning.ecrire(JSON.stringify({ semaine, jours }));
      } finally {
        hydratationEnCours = gardeAvant;
      }
    }
  }
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
  // Réabonnement « à chaud » (nav SPA) : coches (par ancre) + planning du cycle
  // (alerte US-21, #259). Au chargement froid, hydraterCycle → chargerCycleDansCache
  // (re)posent les deux une fois l'ancre/longueur résolues.
  const cycle = lireCycleAffiche();
  void synchroniserAbonnementCoches(cycle?.ancre ?? null);
  void synchroniserAbonnementPlanningCycle(cycle?.ancre ?? null, cycle?.longueur ?? LONGUEUR_DEFAUT);
  void synchroniserAbonnementArticlesManuels(cycle?.ancre ?? null);
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
 *
 * `ancreForcee` (#279) : si fournie (relais one-shot depuis `/planning`, via
 * `?ancre=` sur le lien « Liste de courses → »), bascule DIRECTEMENT sur cette
 * ancre au montage, sans passer par le défaut du jour de `hydraterCycle` —
 * sinon ce défaut écraserait silencieusement l'ancre demandée (`hydraterCycle`
 * ne consulte jamais le cycle déjà affiché). Lue une seule fois au montage
 * (deps `[]`) : un changement de query param en cours de vie du composant
 * n'est pas un cas d'usage ici (l'appelant nettoie l'URL après coup).
 */
export function useSyncCourses(ancreForcee?: string | null): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSyncCoches();
    if (ancreForcee) {
      void allerAuCycle(ancreForcee);
    } else {
      void hydraterCycle();
    }
    return arreter;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ancreForcee lue une seule fois au montage, volontairement
  }, []);
  return etatCourant;
}
