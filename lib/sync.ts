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
import { creerStoreJSON, storeCoches, storePlanning, surEditionPlanning } from "@/lib/stockage";
import {
  basculerCocheArticleManuelDistant,
  chargerArticlesManuelsDistants,
  chargerEtatCochesDistant,
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
import { basculerCoche, parserCoches, type Coches } from "@/lib/coches";
import { cleHorodatage } from "@/lib/horodatage";
import { deriverOps } from "@/lib/coches-sync";
import {
  creerMoteurCoches,
  type Etat,
  type MoteurCoches,
  type StockageCoches,
} from "@/lib/moteur-coches";
import { signaturePlanning } from "@/lib/planning-diff";
import { fusionnerEditionsLocales } from "@/lib/planning-fusion";
import { ORDRE_JOURS } from "@/lib/generateur";
import { createClient } from "@/lib/supabase/client";
import { semaineDecalee, semaineISO, semaineParDefaut } from "@/lib/semaines";
import {
  ancreParDefaut,
  cycleDecale,
  LONGUEUR_DEFAUT,
  semainesDuCycle,
} from "@/lib/cycles";
import { lireCycle } from "@/lib/lecture-cycle";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { jourCoursesOuLundi, longueurOuDefaut } from "@/lib/ancre-initiale-cycle";
import { parseApiError } from "@/lib/errors";
import { CLE_PREFERENCES_EN_ATTENTE } from "@/lib/preferences";
import type { ArticleManuel, Ingredient, JourPlanning, Planning, SemaineGeneree } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Horodatage de la dernière écriture locale (last-write-wins) et drapeau
// « écriture en attente de push » (file hors-ligne minimale). Un jeu de clés
// par donnée synchronisée : planning et coches (US-13).
const CLE_MAJ = "planning_courant_maj";
const CLE_DIRTY = "planning_dirty";
// Dernier planning CONFIRMÉ par le serveur pour la semaine affichée (#355) :
// écrit à chaque pull (`chargerSemaineDansCache`), après chaque push réussi (le
// planning poussé) et par les écritures qui patchent le cache (`modifierSlotDistant`,
// `appliquerGenerationCycle`). Base de comparaison des éditions locales en
// attente quand une relecture US-21 arrive (`relireEnRejouantEditionsLocales`).
const CLE_CONFIRME = "planning_confirme";
// Semaine dont la dernière relecture US-21 avec rejeu a échoué (#355) : aucun
// push de cette semaine avant une relecture réussie. Persistée pour survivre à
// un rechargement : sinon `hydrater` (« local fait foi ») pousserait le local
// sans relire et effacerait le changement distant que la lecture devait intégrer.
const CLE_A_RELIRE = "planning_a_relire";
// Coches (#362) : file et horodatages des deux moteurs, `coches_en_attente` /
// `coches_maj` (ingrédients, `nom: "coches"`) et `coches_manuels_en_attente` /
// `coches_manuels_maj` (articles manuels, `nom: "coches_manuels"`).
// `courses_cochees_maj` et `courses_dirty` sont legacy : plus écrits, mais
// purgés au changement de foyer pour ne pas laisser de valeur orpheline d'un
// ancien client.
const CLES_MOTEUR_COCHES = [
  "coches_en_attente",
  "coches_maj",
  "coches_manuels_en_attente",
  "coches_manuels_maj",
];
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
  // D'abord arrêter les moteurs de l'ancien foyer : un flush en vol finit sans
  // réécrire sa file purgée ci-dessous ni continuer avec les opérations
  // suivantes, et le blob effacé ci-dessous n'est plus pris pour un geste.
  moteurIngredients?.arreter();
  moteurArticlesManuels?.arreter();
  storePlanning.effacer();
  storeCoches.effacer();
  localStorage.removeItem(CLE_MAJ);
  localStorage.removeItem(CLE_DIRTY);
  localStorage.removeItem(CLE_CONFIRME); // instantané confirmé (#355) de l'ancien foyer
  localStorage.removeItem(CLE_A_RELIRE); // relecture à refaire (#355) de l'ancien foyer
  localStorage.removeItem(CLE_MAJ_COCHES);
  localStorage.removeItem(CLE_DIRTY_COCHES);
  for (const cle of CLES_MOTEUR_COCHES) localStorage.removeItem(cle);
  // Les moteurs seront recréés depuis le stockage purgé (files de l'ancien
  // foyer abandonnées) ; la page est rechargée ensuite par l'appelant.
  moteurIngredients = null;
  moteurArticlesManuels = null;
  etatPlanning = "synchronise";
  etatsMoteurs.coches = "synchronise";
  etatsMoteurs.coches_manuels = "synchronise";
  // Republié : sans cela, l'indicateur gardait l'état de l'ancien foyer
  // (« hors ligne ») jusqu'au rechargement. Les moteurs recréés relisent un
  // stockage déjà purgé (files vides).
  publierEtat();
  blobConnu = {};
  localStorage.removeItem("planning_snapshot"); // CLE_SNAPSHOT de lib/stockage
  // Le foyer a changé → le cycle affiché et son planning projeté (#257) sont
  // périmés (autre foyer = autres plannings/jour de courses).
  localStorage.removeItem(CLE_CYCLE);
  localStorage.removeItem(CLE_CYCLE_PLANNING);
  // Préférences favori/évité non confirmées (#404) : elles visaient l'ancien
  // foyer, les rejouer les écrirait dans le nouveau.
  localStorage.removeItem(CLE_PREFERENCES_EN_ATTENTE);
}

/**
 * Arrête l'instance du module (#371), réservé aux tests : coupe les minuteurs
 * (push débouncé, relectures du planning et des coches), arrête les moteurs de
 * coches et le temps réel. Les écouteurs `window` posés par les hooks sont
 * retirés par leur démontage (`cleanup` de Testing Library), pas ici. Pourquoi :
 * chaque test recharge un module neuf (`vi.resetModules`) ; sans arrêt, les
 * minuteurs et moteurs d'un test réagissaient pendant les suivants. Aucun appel
 * en production. @internal
 */
export async function arreterSync(): Promise<void> {
  suspendrePush();
  annulerNouvelleRelecture();
  annulerRelectureCoches();
  moteurIngredients?.arreter();
  moteurArticlesManuels?.arreter();
  await Promise.all([couperTempsReel(), couperPresence()]);
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

// Indicateur composé (#362) : le planning (push, relecture US-21) et chacun
// des deux moteurs de coche annoncent leur propre état ; l'indicateur affiche
// le pire (« hors-ligne » > « sauvegarde » > « synchronise »). Pourquoi : un
// moteur qui finit son envoi annonçait « synchronise » pendant qu'un push
// planning restait en échec, et un push réussi le faisait pendant que des
// coches restaient en file.
type NomMoteur = "coches" | "coches_manuels";
let etatPlanning: EtatSync = "synchronise";
const etatsMoteurs: Record<NomMoteur, EtatSync> = {
  coches: "synchronise",
  coches_manuels: "synchronise",
};

/** Pire des états (« hors-ligne » > « sauvegarde » > « synchronise »). */
export function composerEtatSync(etats: readonly EtatSync[]): EtatSync {
  if (etats.includes("hors-ligne")) return "hors-ligne";
  if (etats.includes("sauvegarde")) return "sauvegarde";
  return "synchronise";
}

// « synchronise » n'est jamais publié avec des coches en file : un moteur neuf
// (file relue après un rechargement, jamais envoyée) annonce « synchronise »
// sans avoir rien envoyé. Sa file est alors relancée ; son flush publiera
// « sauvegarde » puis son vrai état. Sans effet si un envoi est en cours.
function publierEtat(): void {
  const compose = composerEtatSync([etatPlanning, ...Object.values(etatsMoteurs)]);
  if (compose === "synchronise" && cochesEnAttente()) {
    rejouerCoches();
    return;
  }
  definirEtat(compose);
}

// État du planning (push, relecture US-21, lectures de semaine ou de cycle).
function definirEtatPlanning(nouvel: EtatSync): void {
  etatPlanning = nouvel;
  publierEtat();
}

function surEtatMoteur(nom: NomMoteur): (nouvel: EtatSync) => void {
  return (nouvel) => {
    etatsMoteurs[nom] = nouvel;
    publierEtat();
  };
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
// Semaine lue (#400, RG-09) — store en mémoire : vrai dès que la première
// lecture de `hydrater` est terminée (réussie, ratée ou levée), ou tout de suite
// si le cache local fait foi. Ne repasse jamais à faux : une navigation SPA ne
// relit pas (`dejaHydrate`), un rechargement complet recrée le module. Pourquoi :
// `planning === null` confondait « pas encore lu » et « semaine vide », d'où un
// faux état vide sur un appareil sans cache local.
// ---------------------------------------------------------------------------
let semaineLue = false;
const abonnesSemaineLue = new Set<() => void>();

function marquerSemaineLue(): void {
  if (semaineLue) return;
  semaineLue = true;
  for (const rappel of abonnesSemaineLue) rappel();
}

export const storeSemaineLue = {
  sAbonner(rappel: () => void): () => void {
    abonnesSemaineLue.add(rappel);
    return () => abonnesSemaineLue.delete(rappel);
  },
  lire: (): boolean => semaineLue,
  // Prérendu : jamais lue (le squelette est rendu côté serveur).
  lireServeur: (): boolean => false,
};

/** Vrai quand la première lecture de la semaine est terminée (squelette sinon, #400). */
export function useSemaineLue(): boolean {
  return useSyncExternalStore(
    storeSemaineLue.sAbonner,
    storeSemaineLue.lire,
    storeSemaineLue.lireServeur
  );
}


// ---------------------------------------------------------------------------
// Cycle affiché (#257) — store adossé à localStorage. Porte l'ancre (date ISO)
// et la longueur du cycle courant sur /courses. Source de `ancreActive()`, qui
// clé toute la chaîne coches (gestes / hydratation / temps réel).
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
// Échec du premier chargement du cycle sur /courses (#402, RG-09) — store en
// mémoire. Vrai quand un chargement n'a pu poser AUCUN cycle affiché (lecture
// ratée, ou relais `?ancre=` dont l'envoi préalable échoue) : la page quitte
// alors son squelette pour un état erreur. Un cycle déjà affiché (cache) reste
// affiché, sans erreur. « Réessayer » rejoue le dernier chargement tenté.
// ---------------------------------------------------------------------------
let echecChargementCycle = false;
const abonnesEchecCycle = new Set<() => void>();
let relanceChargementCycle: (() => Promise<void>) | null = null;

function poserEchecChargementCycle(echec: boolean): void {
  if (echecChargementCycle === echec) return;
  echecChargementCycle = echec;
  for (const rappel of abonnesEchecCycle) rappel();
}

// Fin d'un chargement initial ou d'un relais : échec seulement si aucun cycle
// n'est affiché.
function signalerEchecSiAucunCycle(): void {
  if (lireCycleAffiche() === null) poserEchecChargementCycle(true);
}

export const storeEchecChargementCycle = {
  sAbonner(rappel: () => void): () => void {
    abonnesEchecCycle.add(rappel);
    return () => abonnesEchecCycle.delete(rappel);
  },
  lire: (): boolean => echecChargementCycle,
  // Prérendu : jamais en échec (le squelette est rendu côté serveur).
  lireServeur: (): boolean => false,
};

/** Vrai si le premier chargement du cycle de /courses a échoué (#402). */
export function useEchecChargementCycle(): boolean {
  return useSyncExternalStore(
    storeEchecChargementCycle.sAbonner,
    storeEchecChargementCycle.lire,
    storeEchecChargementCycle.lireServeur
  );
}

/**
 * « Réessayer » de l'état erreur de /courses (#402) : lève l'échec tout de
 * suite (retour au squelette) et rejoue le dernier chargement tenté
 * (`hydraterCycle`, ou `allerAuCycle` sur la même ancre).
 */
export function reessayerChargementCycle(): Promise<void> {
  poserEchecChargementCycle(false);
  return relanceChargementCycle?.() ?? hydraterCycle();
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

// Incrémenté à chaque saisie locale (ajout, modification, coche, suppression,
// « Tout décocher ») et à chaque écriture de coche commitée : une lecture
// distante qui chevauche l'une ou l'autre est périmée. Pourquoi le commit : une
// coche rejouée (retour en ligne) se termine pendant la relecture du cycle, sort
// de la file, et l'instantané lu avant elle la décochait à l'écran.
let saisiesArticlesManuels = 0;

// Lectures au plus : la première, plus deux relectures si l'utilisateur saisit
// pendant la lecture. Au-delà, on applique quand même : coches en file protégées
// (dirty-first), coches commitées pendant la lecture aussi (règle 6 du moteur,
// première hydratation comprise).
const LECTURES_ARTICLES_MAX = 3;

// Coche des articles manuels sur le moteur horodaté (#362, RG-41) : deuxième
// instance de `lib/moteur-coches.ts` (`nom: "coches_manuels"`, clés de stockage
// `coches_manuels_maj` / `coches_manuels_en_attente`), clé = id de l'article,
// valeur inutilisée. File hors ligne persistée, une écriture à la fois, dernier
// commit gagnant sur `updated_at` ; un échec met en file (« hors ligne »), sans
// rejet. Le moteur ne porte que la coche : libellé, quantité… restent arbitrés
// par `majLe` dans `surEventArticleManuel`. Créé au premier usage (il relit sa
// file à ce moment-là).
let moteurArticlesManuels: MoteurCoches<null> | null = null;

function moteurArticles(): MoteurCoches<null> {
  return (moteurArticlesManuels ??= creerMoteurCoches<null>({
    nom: "coches_manuels",
    transport: {
      // `null` = aucune ligne mise à jour : article supprimé entre-temps,
      // opération abandonnée (journalisée) par le moteur, jamais ressuscitée.
      async ecrire(_ancre, id, etat) {
        const maj = await basculerCocheArticleManuelDistant(id, etat.coche);
        saisiesArticlesManuels++;
        retenirMajArticle(id, maj);
        return maj;
      },
      async vider(ancre) {
        const lignes = await viderCochesArticlesManuelsDistantes(ancre);
        saisiesArticlesManuels++;
        for (const { id, majLe } of lignes) retenirMajArticle(id, majLe);
        return lignes.map(({ id, majLe }) => ({ cle: id, maj: majLe }));
      },
    },
    vue: {
      // Article absent du store (supprimé) : rien à écrire, pas de résurrection.
      appliquer(id, etat) {
        const local = articlesManuels.find((a) => a.id === id);
        if (!local || local.coche === etat.coche) return;
        definirArticlesManuels(
          articlesManuels.map((a) => (a.id === id ? { ...a, coche: etat.coche } : a))
        );
      },
      vider() {
        if (!articlesManuels.some((a) => a.coche)) return;
        definirArticlesManuels(articlesManuels.map((a) => ({ ...a, coche: false })));
      },
    },
    stockage: stockageMoteurCoches,
    surEtat: surEtatMoteur("coches_manuels"),
    journal: (message, erreur) => console.error(message, erreur),
    estDefinitive: estEchecDefinitif,
  }));
}

/** Charge les articles manuels de l'ancre dans le store, puis hydrate le moteur
 *  de leurs coches. Rejette si la lecture échoue (l'appelant planifie une
 *  nouvelle tentative : sans hydratation, le moteur ignore les événements).
 *
 *  La lecture peut revenir APRÈS un ajout ou une coche de l'utilisateur (elle
 *  part pendant le chargement de /courses, liste déjà utilisable). Pourquoi
 *  ne pas l'appliquer telle quelle : son instantané périmé effaçait la coche
 *  ou l'article ajouté (même schéma que la coche perdue de #339). Donc :
 *  relecture si une saisie a eu lieu pendant la lecture, et coche locale
 *  conservée pour un article dont la coche est encore en file (dirty-first
 *  par clé du moteur). */
async function chargerArticlesManuelsDansCache(ancre: string): Promise<void> {
  ancreArticlesManuelsChargee = ancre;
  for (let lecture = 1; ; lecture++) {
    const saisiesAvant = saisiesArticlesManuels;
    // Début de lecture marqué : une coche confirmée pendant la lecture n'est
    // pas défaite par son instantané (règle 6 du moteur).
    const depuis = moteurArticles().marquerLecture();
    const liste = await chargerArticlesManuelsDistants(ancre);
    if (ancreArticlesManuelsChargee !== ancre) return;
    if (saisiesAvant !== saisiesArticlesManuels && lecture < LECTURES_ARTICLES_MAX) continue;
    definirArticlesManuels(liste);
    // `majLe` absent = horodatage inconnu : tout événement s'appliquera.
    const distant: Record<string, Etat<null> & { maj: string }> = {};
    for (const article of liste) {
      distant[article.id] = { coche: article.coche, valeur: null, maj: article.majLe ?? "" };
    }
    moteurArticles().hydrater(ancre, distant, depuis);
    return;
  }
}

/** Ajoute un article manuel sur l'ancre affichée (RG-43). No-op hors cycle. */
export async function ajouterArticleManuel(saisie: SaisieArticleManuel): Promise<void> {
  const ancre = ancreActive();
  if (ancre === null) return;
  const cree = await creerArticleManuelDistant(ancre, saisie);
  saisiesArticlesManuels++;
  // Upsert par id, comme `surEventArticleManuel` : la lecture du cycle (ou
  // l'écho INSERT) a pu rapporter l'article avant le retour de l'insertion.
  // Un doublon partageait la clé React et la case ne suivait plus l'état. La
  // coche reste celle du store (un geste a pu suivre l'écho INSERT) : c'est
  // le moteur qui l'arbitre, sur l'`updated_at` de la création.
  const connu = articlesManuels.find((a) => a.id === cree.id);
  definirArticlesManuels(
    connu
      ? articlesManuels.map((a) => (a.id === cree.id ? { ...cree, coche: connu.coche } : a))
      : [...articlesManuels, cree]
  );
  if (cree.majLe) {
    moteurArticles().surEvent(ancre, cree.id, { coche: cree.coche, valeur: null }, cree.majLe);
  }
}

/** Modifie un article manuel EN PLACE (RG-43 bis) : conserve id et coché. */
export async function modifierArticleManuel(
  id: string,
  saisie: SaisieArticleManuel
): Promise<void> {
  const majLe = await modifierArticleManuelDistant(id, saisie);
  saisiesArticlesManuels++;
  definirArticlesManuels(
    articlesManuels.map((a) =>
      a.id === id
        ? {
            ...a,
            majLe: majLe ?? a.majLe,
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

// Horloge serveur d'un article (`updated_at`), en ms ; 0 = inconnue.
function majArticle(article: ArticleManuel | undefined): number {
  return article?.majLe ? Date.parse(article.majLe) : 0;
}

// Retient l'`updated_at` renvoyé par une de nos écritures : tout écho qui
// n'est pas plus récent sera ignoré pour les champs hors coche (la coche est
// arbitrée par le moteur). Ce n'est pas une saisie : pas de
// `saisiesArticlesManuels++`, la coche et les champs ne changent pas.
function retenirMajArticle(id: string, majLe: string | null | undefined): void {
  if (!majLe) return;
  const local = articlesManuels.find((a) => a.id === id);
  if (!local || Date.parse(majLe) <= majArticle(local)) return;
  definirArticlesManuels(articlesManuels.map((a) => (a.id === id ? { ...a, majLe } : a)));
}

/** Bascule l'état coché d'un article manuel (colonne dédiée, indépendante du
 *  blob de coches RG-12), par le moteur horodaté (#362). La coche locale
 *  change tout de suite, de façon synchrone (contrat `avecTransition`) ;
 *  l'écriture suit, une à la fois, le dernier geste gagnant. Un échec réseau
 *  met en file et passe l'indicateur à « hors ligne », sans rejet ni revert.
 *  No-op hors cycle affiché. */
export function basculerCocheArticleManuel(id: string): void {
  const article = articlesManuels.find((a) => a.id === id);
  const ancre = ancreActive();
  if (!article || ancre === null) return;
  saisiesArticlesManuels++;
  moteurArticles().poser(ancre, id, { coche: !article.coche, valeur: null });
}

/** Supprime un article manuel (RG-42). */
export async function supprimerArticleManuel(id: string): Promise<void> {
  await supprimerArticleManuelDistant(id);
  saisiesArticlesManuels++;
  definirArticlesManuels(articlesManuels.filter((a) => a.id !== id));
}

/** Décoche tous les articles manuels du cycle affiché SANS les supprimer
 *  (RG-41, « Tout décocher »). No-op hors cycle.
 *
 *  Par le moteur horodaté (#362) : la vue est décochée de façon SYNCHRONE —
 *  `/courses` appelle cette fonction depuis `avecTransition()`, dont le
 *  `flushSync` n'entoure QUE la portion synchrone du callback (une mise à jour
 *  après un `await` sautait hors transition). Le décochage distant suit, après
 *  une écriture de coche déjà en vol, et efface les coches encore en file de
 *  l'ancre ; un échec réseau met en file (« hors ligne »), sans rejet. */
export function viderCochesArticlesManuels(): void {
  const ancre = ancreActive();
  if (ancre === null) return;
  saisiesArticlesManuels++;
  moteurArticles().toutDecocher(ancre);
}

// ---------------------------------------------------------------------------
// Interface de coche de /courses (#362, RG-10, RG-12, RG-41) : un seul point
// d'entrée pour les deux sortes de coches (blob des ingrédients dérivés,
// synchronisé par diff ; colonne `coche` des articles manuels), chacune sur son
// instance du moteur horodaté. La page ne connaît ni l'une ni l'autre et
// n'écrit jamais storeCoches.
// ---------------------------------------------------------------------------

/** Bascule la coche d'un article de la liste. Ingrédient dérivé : le blob est
 *  lu AU MOMENT de l'appel (pas l'instantané du dernier rendu, qui ferait
 *  s'annuler deux touches rapides en une seule). Dans les deux cas, partie
 *  locale synchrone (contrainte `avecTransition`) et promesse résolue tout de
 *  suite : l'écriture suit par le moteur, un échec réseau la met en file
 *  (« hors ligne ») sans rejet. */
export async function basculerCocheArticle(ingredient: Ingredient): Promise<void> {
  // `async` : une exception synchrone inattendue devient un rejet, que le
  // `.catch` de la page journalise.
  if (ingredient.source === "manuel") {
    if (ingredient.id) basculerCocheArticleManuel(ingredient.id);
    return;
  }
  // Geste sur UN article : décocher le dernier coché vide le blob, mais ne
  // doit pas devenir un vidage de l'ancre (cf. `gesteUnitaire`).
  gesteUnitaire = true;
  try {
    ecrireBlob(basculerCoche(cochesLocales(), ingredient));
  } finally {
    gesteUnitaire = false;
  }
}

/** « Tout décocher » (RG-13, RG-41) : blob vidé et articles manuels décochés
 *  localement, de façon synchrone ; les écritures suivent par les moteurs. */
export async function toutDecocher(): Promise<void> {
  storeCoches.effacer();
  viderCochesArticlesManuels();
}

// Applique un event Realtime article_manuel au store (INSERT/UPDATE = upsert
// par id, DELETE = retrait). Idempotent vis-à-vis de nos propres écritures
// (déjà appliquées localement par les fonctions ci-dessus) : ré-appliquer le
// même contenu ne change rien d'observable. La COCHE n'est jamais prise de
// l'event pour un article connu : elle est confiée au moteur, qui l'arbitre sur
// `updated_at` (écho ou périmé ignoré, différé pendant une écriture sur l'article).
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
    majLe: typeof ligne.updated_at === "string" ? ligne.updated_at : undefined,
  };
  // Le temps réel ne garantit pas l'ordre de livraison : pour les champs hors
  // coche, un écho qui n'est pas strictement plus récent que l'état connu (ex.
  // INSERT de la création livré après une modification) est périmé, on
  // l'ignore. Horloge serveur, cf. migration 20261104120000_article_manuel_updated_at.
  const connu = articlesManuels.find((a) => a.id === article.id);
  const perime = connu && article.majLe && Date.parse(article.majLe) <= majArticle(connu);
  if (!perime) {
    definirArticlesManuels(
      connu
        ? articlesManuels.map((a) => (a.id === article.id ? { ...article, coche: connu.coche } : a))
        : [...articlesManuels, article]
    );
  }
  // Coche : le moteur tranche, même si les autres champs sont périmés (il
  // connaît l'horodatage de nos écritures de coche, pas celui des modifications).
  moteurArticles().surEvent(
    ancre,
    article.id,
    { coche: article.coche, valeur: null },
    article.majLe ?? null
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
// Vrai pendant la lecture de `chargerSemaineDansCache` (#368) : aucun push ne
// part (un geste pose `dirty`, la fin de la lecture décide). Pourquoi : un push
// parti pendant une navigation écrirait l'horodatage et l'instantané confirmé
// de la semaine quittée par-dessus ceux de la semaine lue.
let lectureSemaineEnCours = false;
// Compte les gestes de l'utilisateur sur le planning (#368) : une lecture
// pendant laquelle il a bougé ne remplace pas le cache à l'aveugle (jumeau de
// `gestesCoches`, #339).
let gestesPlanning = 0;
let pushEnCours = false;
let rePushDemande = false;
let minuteur: ReturnType<typeof setTimeout> | null = null;

// Anti-écho exact du temps réel planning (#352, US-21). Toute écriture planning
// par RPC (`pousser`, `modifierSlotDistant`, `appliquerGenerationCycle`) retient
// l'`updated_at` que la base lui renvoie, par semaine ; un event Realtime n'est
// l'écho d'une de NOS écritures que si son `updated_at` est retenu. Tout autre
// event, même plus ancien que `planning_courant_maj`, vient d'un autre membre :
// relecture + comparaison de signature. Pourquoi pas « <= planning_courant_maj » :
// un commit d'un autre membre passé juste avant le nôtre (T_autre < T_nous) était
// pris pour un écho ; le cache restait sans son slot, et la prochaine édition en
// vue Semaine (`sauvegarder_planning`, toute la semaine) l'écrasait en base.
// Clé à la microseconde (`now()` de Postgres) : deux écritures d'une même
// milliseconde restent distinctes.
const HORODATAGES_RETENUS_PAR_SEMAINE = 32;
const SEMAINES_RETENUES = 8;
const horodatagesEcrits = new Map<string, number[]>();

// Borné : par semaine (les plus anciens sortent d'abord) et en nombre de
// semaines. Un écho très tardif d'un horodatage oublié est juste relu.
function retenirHorodatageEcrit(semaine: string, iso: string): void {
  const cle = cleHorodatage(iso);
  if (cle === null) return;
  const cles = horodatagesEcrits.get(semaine) ?? [];
  horodatagesEcrits.delete(semaine); // réinsertion = semaine la plus récente
  cles.push(cle);
  if (cles.length > HORODATAGES_RETENUS_PAR_SEMAINE) cles.shift();
  horodatagesEcrits.set(semaine, cles);
  if (horodatagesEcrits.size > SEMAINES_RETENUES) {
    const plusAncienne = horodatagesEcrits.keys().next().value;
    if (plusAncienne !== undefined) horodatagesEcrits.delete(plusAncienne);
  }
}

function estEchoPlanning(semaine: string, cle: number): boolean {
  return horodatagesEcrits.get(semaine)?.includes(cle) ?? false;
}

// Écritures planning en vol et events temps réel reçus pendant ce temps (#352,
// US-21). L'écho Realtime d'une écriture peut arriver AVANT la réponse HTTP de
// sa RPC, donc avant que son `updated_at` ne soit retenu : jugé à ce moment-là,
// il passerait pour un changement distant (relecture qui écrase les éditions
// faites pendant l'écriture, alerte sur sa propre écriture). On garde TOUS les
// horodatages reçus (un écho et un vrai changement peuvent se croiser), par
// semaine, et on les juge quand la dernière écriture se termine.
let ecrituresPlanningEnVol = 0;
const eventsPlanningDifferes = new Map<string, Set<number>>();

function terminerEcriturePlanning(): void {
  ecrituresPlanningEnVol = Math.max(0, ecrituresPlanningEnVol - 1);
  if (ecrituresPlanningEnVol > 0) return;
  const differes = [...eventsPlanningDifferes];
  eventsPlanningDifferes.clear();
  for (const [semaine, cles] of differes) {
    // Abonnement coupé (départ de /planning) ou passé à une autre semaine
    // pendant l'écriture : plus rien à juger (ni relecture, ni réabonnement).
    if (semaine !== semainePlanningVoulue) continue;
    // Échos de nos écritures : ignorés ; un autre horodatage = un autre membre
    // a écrit pendant ce temps → traitement US-21 habituel.
    if ([...cles].some((cle) => !estEchoPlanning(semaine, cle))) {
      void traiterChangementPlanningDistant(semaine);
    }
  }
  jugerEventsCycleDifferes(); // jumeau côté cycle
}

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

// Instantané confirmé (#355, `CLE_CONFIRME`). Illisible = absent : la relecture
// US-21 retombe alors sur « le distant fait foi ».
function lireConfirme(): Planning | null {
  const brut = localStorage.getItem(CLE_CONFIRME);
  if (brut === null) return null;
  try {
    return JSON.parse(brut) as Planning;
  } catch {
    return null;
  }
}

function ecrireConfirme(planning: Planning | null): void {
  if (planning === null) localStorage.removeItem(CLE_CONFIRME);
  else localStorage.setItem(CLE_CONFIRME, JSON.stringify(planning));
}

// Patche l'instantané confirmé de `semaine` comme le cache (écriture déjà faite
// en base par une RPC partielle : `sauvegarder_slots`, `sauvegarder_cycle`).
// Sans instantané de cette semaine, rien à patcher.
function patcherConfirme(
  semaine: string,
  patch: (jours: JourPlanning[]) => JourPlanning[]
): void {
  const confirme = lireConfirme();
  if (confirme === null || confirme.semaine !== semaine) return;
  ecrireConfirme({ ...confirme, jours: patch(confirme.jours) });
}

// Vrai si tout jour présent dans `confirme` l'est aussi dans `local` (#355).
// Une semaine PARTIELLE est normale (`dbPlanningToDomain` ne garde que les jours
// ayant au moins un créneau : week-end « Aucun », semaine coupée par un cycle,
// RG-44/46) ; seul un local qui aurait PERDU des jours rend le rejeu douteux.
function joursConserves(confirme: Planning, local: Planning): boolean {
  return confirme.jours.every((jc) => local.jours.some((jl) => jl.jour === jc.jour));
}

// Pousse le planning courant en base. Sérialisé (garde `pushEnCours`) pour
// éviter les delete→insert concurrents (duplicate key / RLS). Au succès,
// l'horodatage local prend la valeur serveur renvoyée et `dirty` est levé ;
// à l'échec (réseau/hors-ligne), `dirty` reste et le push sera rejoué.
async function pousser(): Promise<void> {
  // Relecture US-21 en cours (#355) : `dirty` reste posé, elle relance le push
  // à sa fin. Garde ICI et pas seulement dans `relancerPush` : `attendreSync`,
  // le remontage de `hydrater`, le retour en ligne et le re-push de fin de
  // `pousser` l'appellent directement. Parti pendant la lecture,
  // `sauvegarder_planning` (toute la semaine) effacerait en base le changement
  // distant en cours de lecture.
  if (traitementPlanningEnCours) return;
  // Lecture d'une semaine en cours (#368) : `dirty` reste posé, sa fin relance.
  if (lectureSemaineEnCours) return;
  if (pushEnCours) {
    rePushDemande = true;
    return;
  }
  const planning = planningLocal();
  if (planning === null) return; // rien à pousser
  // Relecture ratée pour cette semaine (#355) : la refaire d'abord. Pousser le
  // local sans elle effacerait le changement de l'autre membre ; c'est elle
  // qui relancera le push (de la fusion) si elle réussit.
  if (lireRelectureARefaire() === planning.semaine) {
    void traiterChangementPlanningDistant(planning.semaine);
    return;
  }

  pushEnCours = true;
  rePushDemande = false; // toute écriture pendant ce push le repassera à true
  ecrituresPlanningEnVol++; // anti-écho US-21 (#352), cf. surEventPlanning
  definirEtatPlanning("sauvegarde");
  try {
    const majServeur = await sauvegarderPlanningDistant(planning);
    retenirHorodatageEcrit(planning.semaine, majServeur);
    localStorage.setItem(CLE_MAJ, majServeur);
    // La base contient désormais exactement le planning poussé (#355).
    ecrireConfirme(planning);
    // Ne lever `dirty` que si AUCUNE écriture locale n'est survenue pendant le
    // push (sinon le local a re-divergé → on garde dirty et on rejoue).
    if (!rePushDemande) localStorage.removeItem(CLE_DIRTY);
    definirEtatPlanning("synchronise");
  } catch (erreur) {
    definirEtatPlanning("hors-ligne");
    console.error("Synchronisation du planning échouée (sera rejouée).", erreur);
  } finally {
    pushEnCours = false;
    if (rePushDemande) {
      rePushDemande = false;
      void pousser(); // reprend une écriture en vol avant que celle-ci ne se termine
    }
    terminerEcriturePlanning();
  }
}

// À chaque édition du planning par l'utilisateur (canal `surEditionPlanning`,
// #363) : marque `dirty` (le local diverge) et planifie un push débounce. On NE
// touche PAS l'horodatage (réservé au serveur). Un geste n'est JAMAIS filtré
// (#368) : pendant la lecture de `chargerSemaineDansCache`, il est compté et
// c'est la fin de la lecture qui le pousse ou le rejoue.
function planifierPush(): void {
  gestesPlanning += 1;
  localStorage.setItem(CLE_DIRTY, "1");
  relancerPush();
}

// (Re)planifie le push débouncé du planning courant, hors garde d'hydratation
// (aussi utilisé par la relecture US-21 qui rejoue des éditions locales, #355).
function relancerPush(): void {
  // Écriture pendant un push en cours : il rejouera (pas de clear de dirty).
  if (pushEnCours) {
    rePushDemande = true;
    return;
  }
  // Relecture US-21 en cours : `dirty` suffit, elle replanifie le push à sa fin
  // (pas de minuteur inutile ; `pousser` est de toute façon gardé, #355).
  if (traitementPlanningEnCours) return;
  // Lecture d'une semaine en cours (#368) : idem, sa fin relance le push.
  if (lectureSemaineEnCours) return;
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => void pousser(), DELAI_DEBOUNCE_MS);
}

// Suspend le push débouncé en attente (la relecture US-21 le replanifie si
// `dirty` reste posé, cf. traiterChangementPlanningDistant).
function suspendrePush(): void {
  if (minuteur) clearTimeout(minuteur);
  minuteur = null;
}

// La logique « le local non poussé/non horodaté fait foi, sinon la base »
// vit désormais dans hydrater() (cas e2e/offline) et naviguerVers() (chargement
// d'une semaine précise) — cf. plus bas.

// ---------------------------------------------------------------------------
// Coches d'ingrédients PAR-ARTICLE sur le moteur horodaté (#362, RG-10, RG-12,
// RG-13, RG-32, RG-41).
//
// La liste reste un BLOB localStorage (storeCoches) : page, annulation US-09 et
// lib/coches.ts inchangées. La base stocke UNE LIGNE PAR ARTICLE
// (`etat_courses_article`, décoche = `coche = false`, ligne conservée). Toute
// écriture du blob par l'utilisateur est traduite en gestes par DIFF avec le
// dernier blob connu de la synchro (`blobConnu`, cf. deriverOps) et confiée au
// moteur (`lib/moteur-coches.ts`) : file persistée, une écriture à la fois,
// arbitrage « dernier commit gagnant » sur `updated_at`. Les événements
// Realtime passent par le moteur, qui seul écrit le blob en retour.
// ---------------------------------------------------------------------------

// Vrai pendant une écriture du blob par la synchro (moteur, purge après
// génération) : `surChangementCoches` ne doit PAS la prendre pour un geste.
let applicationDistanteEnCours = false;
// Dernier blob connu de la synchro (gestes déjà confiés au moteur + écritures
// du moteur) : référence du diff des gestes.
let blobConnu: Coches = {};
// Compte les gestes confiés au moteur et ses écritures commitées : une lecture
// des coches distantes qui chevauche l'un ou l'autre est relue (cf.
// lireEtHydraterCoches).
let gestesCoches = 0;
// Vrai pendant l'écriture du blob par `basculerCocheArticle` (un seul article) :
// un blob vidé y est une décoche unitaire, pas « Tout décocher ». Pourquoi :
// un vidage de l'ancre effaçait en base la coche d'un autre membre pas encore
// reçue. « Tout décocher », RG-13 et l'annulation US-09 gardent le vidage.
let gesteUnitaire = false;

// Semaine du planning actif (#5) — clé de la chaîne PLANNING (push + temps réel
// planning sur /planning). NE clé PLUS les coches (cf. ancreActive).
function semaineActive(): string | null {
  return planningLocal()?.semaine ?? null;
}

// Ancre du CYCLE affiché (#257) — clé de toute la chaîne COCHES (gestes,
// hydratation, temps réel). Null tant qu'aucun cycle n'est affiché (ex. sur
// /planning avant toute visite de /courses) : les gestes n'y partent pas.
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

// Écriture du blob par la synchro, jamais prise pour un geste.
function ecrireBlobSynchro(blob: Coches): void {
  const avant = applicationDistanteEnCours;
  applicationDistanteEnCours = true;
  try {
    ecrireBlob(blob);
  } finally {
    applicationDistanteEnCours = avant;
  }
}

// Blob (immuable) après application de l'état d'une clé ; même référence si
// rien ne change.
function avecEtat(blob: Coches, cle: string, etat: Etat<number>): Coches {
  if (etat.coche) {
    if (blob[cle] === etat.valeur) return blob;
    return { ...blob, [cle]: etat.valeur };
  }
  if (!(cle in blob)) return blob;
  const suivant = { ...blob };
  delete suivant[cle];
  return suivant;
}

// Vide le blob local et sa référence (changement de cycle ; purge RG-13 déjà
// faite côté serveur par la génération).
function viderBlobLocal(): void {
  blobConnu = {};
  if (storeCoches.lire() !== null) ecrireBlobSynchro({});
}

// Stockage du moteur (clés `coches_maj`, `coches_en_attente`) : localStorage
// peut lever (mode privé, quota) → dégradé journalisé, comme lib/stockage.ts.
const stockageMoteurCoches: StockageCoches = {
  lire(cle) {
    try {
      return localStorage.getItem(cle);
    } catch (erreur) {
      console.error(`localStorage indisponible (lecture "${cle}").`, erreur);
      return null;
    }
  },
  ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, valeur);
    } catch (erreur) {
      console.error(`localStorage indisponible (écriture "${cle}").`, erreur);
    }
  },
  effacer(cle) {
    try {
      localStorage.removeItem(cle);
    } catch (erreur) {
      console.error(`localStorage indisponible (effacement "${cle}").`, erreur);
    }
  },
};

/** Échec d'écriture de coche définitif (règle 5 du moteur) : statut HTTP 4xx
 *  hors 401 / 408 / 429, porté par `cause.status` (`lib/persistance.ts`). Une
 *  erreur réseau (statut 0 ou absent), un 5xx, 401, 408 ou 429 restent
 *  transitoires : rejoués. Pourquoi : rejouée, une écriture refusée (RLS,
 *  requête invalide) bloquait toute la file à vie ; abandonnée, elle est
 *  journalisée (un geste perdu). 401 : au retour du réseau, le jeton expiré
 *  peut partir avant que son rafraîchissement aboutisse ; le geste est rejoué. */
export function estEchecDefinitif(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) return false;
  const statut = (erreur.cause as { status?: unknown } | undefined)?.status;
  if (typeof statut !== "number" || statut < 400 || statut >= 500) return false;
  return statut !== 401 && statut !== 408 && statut !== 429;
}

// Moteur des coches d'ingrédients, créé au premier usage : il relit sa file
// persistée à ce moment-là (jamais au chargement du module, prérendu compris).
let moteurIngredients: MoteurCoches<number> | null = null;

function moteurCoches(): MoteurCoches<number> {
  return (moteurIngredients ??= creerMoteurCoches<number>({
    nom: "coches",
    transport: {
      // Décoche = ligne conservée `coche = false` (upsert) : la cible ne
      // disparaît jamais, le transport ne renvoie donc jamais `null`.
      // Chaque écriture commitée compte comme un geste (jumeau de
      // `saisiesArticlesManuels++`) : une lecture qui la chevauche est relue,
      // pour un instantané plus frais. Au-delà du plafond de relectures, c'est
      // la règle 6 du moteur (première hydratation comprise) qui garde la
      // coche rejouée commitée pendant la lecture.
      async ecrire(ancre, cle, etat) {
        const maj = etat.coche
          ? await cocherArticleDistant(ancre, cle, etat.valeur)
          : await decocherArticleDistant(ancre, cle);
        gestesCoches += 1;
        return maj;
      },
      async vider(ancre) {
        const lignes = await viderCochesDistantes(ancre);
        gestesCoches += 1;
        return lignes;
      },
    },
    vue: {
      appliquer(cle, etat) {
        blobConnu = avecEtat(blobConnu, cle, etat);
        const local = cochesLocales();
        const suivant = avecEtat(local, cle, etat);
        if (suivant !== local) ecrireBlobSynchro(suivant);
      },
      vider() {
        viderBlobLocal();
      },
    },
    stockage: stockageMoteurCoches,
    surEtat: surEtatMoteur("coches"),
    journal: (message, erreur) => console.error(message, erreur),
    estDefinitive: estEchecDefinitif,
  }));
}

// Coches encore en file dans l'un des deux moteurs (ingrédients, articles manuels).
function cochesEnAttente(): boolean {
  return moteurCoches().enAttente() || moteurArticles().enAttente();
}

// Rejoue les files des deux moteurs (retour réseau, montage, attente d'envoi).
// Sans effet sur une file vide ou déjà en cours d'envoi ; ne rejette jamais.
function rejouerCoches(): void {
  void moteurCoches().rejouer();
  void moteurArticles().rejouer();
}

// Écriture du blob hors synchro = geste de l'utilisateur (coche, décoche,
// « Tout décocher », RG-13 sur /planning, annulation US-09, autre onglet) :
// diff avec `blobConnu`, puis gestes confiés au moteur (la vue est déjà à
// jour). Blob vidé = « Tout décocher » (un seul UPDATE `coche = false`).
//
// Seul `applicationDistanteEnCours` filtre : une écriture de l'utilisateur
// passe TOUJOURS, y compris pendant l'hydratation d'un cycle (sinon la coche
// restait locale, jamais poussée, puis l'hydratation suivante l'écrasait).
function surChangementCoches(): void {
  if (applicationDistanteEnCours) return;
  const local = cochesLocales();
  const ops = deriverOps(blobConnu, local);
  blobConnu = local;
  if (ops.length === 0) return;
  const ancre = ancreActive();
  if (ancre === null) return; // aucun cycle affiché : rien à pousser
  gestesCoches += 1;
  const moteur = moteurCoches();
  if (Object.keys(local).length === 0 && !gesteUnitaire) {
    moteur.toutDecocher(ancre);
    return;
  }
  for (const op of ops) {
    moteur.poser(
      ancre,
      op.cle,
      op.type === "cocher" ? { coche: true, valeur: op.quantite } : { coche: false, valeur: 0 },
      { vueDejaAJour: true }
    );
  }
}

// Lit l'état distant des coches de l'ancre (décoches comprises) et l'hydrate
// dans le moteur, qui garde le local des clés en file (dirty-first par clé).
// Relue si un geste a été fait pendant la lecture : son écriture a pu se
// terminer avant la réponse, qui ne la contient pas (coche effacée à l'écran).
// Rien n'est appliqué si le cycle affiché a changé entre-temps.
async function lireEtHydraterCoches(ancre: string): Promise<void> {
  for (let essai = 0; ; essai += 1) {
    const gestes = gestesCoches;
    // Début de lecture marqué : une coche confirmée pendant la lecture (coche
    // rejouée au retour en ligne, écho déjà reçu) n'est pas défaite par son
    // instantané (règle 6 du moteur).
    const depuis = moteurCoches().marquerLecture();
    const distant = await chargerEtatCochesDistant(ancre);
    if (ancreActive() !== ancre) return;
    if (gestes !== gestesCoches && essai < 2) continue;
    const etats: Record<string, Etat<number> & { maj: string }> = {};
    for (const [cle, { coche, valeur, maj }] of Object.entries(distant)) {
      etats[cle] = { coche, valeur, maj };
    }
    moteurCoches().hydrater(ancre, etats, depuis);
    return;
  }
}

// Lecture des coches ratée en ligne (5xx, délai dépassé), celles des
// ingrédients ou celles des articles manuels : sans hydratation, le moteur
// ignore tous les événements Realtime du cycle. Nouvelle tentative
// différée (2 s puis ×2, plafond 30 s, 5 tentatives, comme la relecture US-21
// du planning), seulement `useSyncCourses` monté, en ligne et pour le cycle
// encore affiché ; annulée au démontage, levée par toute lecture réussie.
// Hors ligne, c'est le retour en ligne qui relit.
const RELECTURE_COCHES_DELAI_INITIAL_MS = 2000;
const RELECTURE_COCHES_DELAI_MAX_MS = 30_000;
const RELECTURE_COCHES_TENTATIVES_MAX = 5;
let relectureCochesAutorisee = false;
let minuteurRelectureCoches: ReturnType<typeof setTimeout> | null = null;
let tentativesRelectureCoches = 0;
let ancreRelectureCoches: string | null = null;

// Invariant : sans effet avant `demarrerSyncCoches` (et après `couperTempsReel`) :
// seule `/courses` (`useSyncCourses`) relit les coches en tâche de fond.
// `/planning` (`hydraterCoches`) n'en relit qu'une fois, sans nouvelle tentative.
function planifierRelectureCoches(ancre: string): void {
  if (!relectureCochesAutorisee) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (ancre !== ancreRelectureCoches) {
    ancreRelectureCoches = ancre;
    tentativesRelectureCoches = 0;
  }
  if (tentativesRelectureCoches >= RELECTURE_COCHES_TENTATIVES_MAX) return;
  const delai = Math.min(
    RELECTURE_COCHES_DELAI_INITIAL_MS * 2 ** tentativesRelectureCoches,
    RELECTURE_COCHES_DELAI_MAX_MS
  );
  tentativesRelectureCoches++;
  if (minuteurRelectureCoches) clearTimeout(minuteurRelectureCoches);
  minuteurRelectureCoches = setTimeout(() => {
    minuteurRelectureCoches = null;
    if (ancreActive() !== ancre) return;
    void relireCoches(ancre);
  }, delai);
}

function annulerRelectureCoches(): void {
  if (minuteurRelectureCoches) clearTimeout(minuteurRelectureCoches);
  minuteurRelectureCoches = null;
  tentativesRelectureCoches = 0;
  ancreRelectureCoches = null;
}

// Lit les coches du cycle : ingrédients et articles manuels (#216, même ancre ;
// leur coche est hydratée dans son moteur, qui garde le local d'un article dont
// la coche est en file ; une saisie faite pendant la lecture n'est pas écrasée,
// cf. chargerArticlesManuelsDansCache). Les deux lectures partent ensemble et
// la première erreur est relancée après les deux. Pourquoi : en séquence, une
// lecture des coches en échec sautait celle des articles (liste sans ses
// articles manuels jusqu'à la nouvelle tentative).
async function lireCochesDuCycle(ancre: string): Promise<void> {
  const resultats = await Promise.allSettled([
    lireEtHydraterCoches(ancre),
    chargerArticlesManuelsDansCache(ancre),
  ]);
  for (const resultat of resultats) {
    if (resultat.status === "rejected") throw resultat.reason;
  }
}

// Relit les coches du cycle (ingrédients et articles manuels) ; un échec est
// journalisé et retenté plus tard.
async function relireCoches(ancre: string): Promise<void> {
  try {
    await lireCochesDuCycle(ancre);
    if (ancreActive() !== ancre) return;
    annulerRelectureCoches();
  } catch (erreur) {
    console.error("Relecture des coches distantes échouée.", erreur);
    planifierRelectureCoches(ancre);
  }
}

// Hydratation des coches hors /courses (`hydrater` de /planning, quand le
// cache local fait foi) : rejoue les files hors ligne (ingrédients et articles
// manuels) puis lit les coches d'ingrédients de l'ancre affichée.
async function hydraterCoches(): Promise<void> {
  rejouerCoches();
  const ancre = ancreActive();
  if (ancre === null) return;
  try {
    await lireEtHydraterCoches(ancre);
    annulerRelectureCoches();
  } catch (erreur) {
    console.error("Chargement des coches distantes échoué.", erreur);
  }
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

type LigneArticle = Partial<{
  foyer_id: string;
  ancre: string;
  cle: string;
  quantite: number;
  coche: boolean;
  updated_at: string;
}>;

// Event Realtime d'`etat_courses_article` → moteur, qui l'arbitre sur
// `updated_at` (écho ou périmé ignoré, différé si un geste sur la clé est en
// file) puis écrit le blob. Ignoré si l'ancre n'est plus celle affichée :
// l'ancien abonnement vit encore pendant le chargement d'un autre cycle.
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
  if (ancre !== ancreActive()) return;
  // DELETE = purge (vieux cycle, compte, foyer) : sans horodatage. Une ligne
  // `coche = false` (décoche à ligne conservée, #362) est une décoche horodatée.
  if (payload.eventType === "DELETE") {
    moteurCoches().surEvent(ancre, ligne.cle, null, null);
    return;
  }
  moteurCoches().surEvent(
    ancre,
    ligne.cle,
    { coche: ligne.coche !== false, valeur: Number(ligne.quantite ?? 0) },
    ligne.updated_at ?? null
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
  // Synchrone (#352) : un event encore livré par le canal en cours de retrait,
  // ou différé par une écriture en vol, n'est plus jugé après la coupure.
  semainePlanningVoulue = null;
  eventsPlanningDifferes.clear();
  // Une lecture encore en vol ne rouvre pas le canal (#355), et la relecture
  // US-21 ratée n'est plus retentée hors de `useSync` (reste persistée : refaite
  // au prochain déclencheur de push). `relecturePlanningDemandee` n'est PAS
  // levé : la relecture finale d'un traitement en cours protège encore le push
  // de sa fusion (elle ne rouvre aucun canal).
  abonnementPlanningAutorise = false;
  annulerNouvelleRelecture();
  relectureCochesAutorisee = false;
  annulerRelectureCoches();
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
// de l'event, comparé aux horodatages renvoyés par NOS écritures
// (`horodatagesEcrits`, #352) — retenu = écho filtré ; sinon un autre membre a
// écrit, quel que soit l'ordre des horodatages.
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
// Event distant reçu PENDANT un traitement (#355) : sa semaine, pour UNE
// relecture finale (plusieurs events pendant la lecture = une seule relecture).
// Jeté, il laissait la fusion (sans ce changement) repartir en push et
// l'effacer en base.
let relecturePlanningDemandee: string | null = null;
// Semaine dont la dernière relecture avec rejeu a échoué (#355) : `pousser`
// refait la relecture avant tout push de cette semaine. Levé par toute lecture
// réussie (rejeu ou `chargerSemaineDansCache`, cf. `relectureReussie`).
// Persistée (`CLE_A_RELIRE`) : un rechargement ne doit pas pousser sans relire.
function lireRelectureARefaire(): string | null {
  return localStorage.getItem(CLE_A_RELIRE);
}

// Nouvelle tentative différée d'une relecture ratée (#355) : sans elle, rien ne
// la relançait tant que l'utilisateur ne retouchait pas au planning (en ligne,
// aucun event `online` ne vient). Back-off simple et borné ; seulement pendant
// que `useSync` est monté (`/planning`, `/bienvenue` ; `abonnementPlanningAutorise`), arrêtée par
// `couperTempsReel`. Hors ligne, l'event `online` relance déjà (`pousser`).
const RELECTURE_DELAI_INITIAL_MS = 2000;
const RELECTURE_DELAI_MAX_MS = 30_000;
const RELECTURE_TENTATIVES_MAX = 5;
let minuteurRelecture: ReturnType<typeof setTimeout> | null = null;
let tentativesRelecture = 0;

function planifierNouvelleRelecture(semaine: string): void {
  if (!abonnementPlanningAutorise) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (tentativesRelecture >= RELECTURE_TENTATIVES_MAX) return; // reste : les déclencheurs de push
  const delai = Math.min(
    RELECTURE_DELAI_INITIAL_MS * 2 ** tentativesRelecture,
    RELECTURE_DELAI_MAX_MS
  );
  tentativesRelecture++;
  if (minuteurRelecture) clearTimeout(minuteurRelecture);
  minuteurRelecture = setTimeout(() => {
    minuteurRelecture = null;
    if (lireRelectureARefaire() !== semaine || semaineActive() !== semaine) return;
    void traiterChangementPlanningDistant(semaine);
  }, delai);
}

function annulerNouvelleRelecture(): void {
  if (minuteurRelecture) clearTimeout(minuteurRelecture);
  minuteurRelecture = null;
  tentativesRelecture = 0;
}

// Relecture ratée : aucun push avant une relecture réussie, indicateur
// « hors-ligne » (le changement distant n'est pas encore intégré), nouvelle
// tentative différée.
function relectureRatee(semaine: string): void {
  localStorage.setItem(CLE_A_RELIRE, semaine);
  definirEtatPlanning("hors-ligne");
  planifierNouvelleRelecture(semaine);
}

// Toute lecture réussie de la semaine rétablit l'indicateur (le push éventuel
// le repassera par « sauvegarde ») et lève la relecture à refaire, seulement si
// c'est la MÊME semaine (#355) : lire une autre semaine n'intègre pas le
// changement distant non relu de celle-ci. Les coches en file gardent l'état de
// leurs moteurs (indicateur composé, cf. `publierEtat`).
function relectureReussie(semaine: string): void {
  if (lireRelectureARefaire() === semaine) {
    localStorage.removeItem(CLE_A_RELIRE);
    annulerNouvelleRelecture();
  }
  if (!pushEnCours) definirEtatPlanning("synchronise");
}

// Re-pull forcé du planning de la semaine puis, si le contenu a changé, alerte.
// Avec des éditions locales en attente (`dirty`) et un instantané confirmé
// exploitable, elles sont rejouées sur le distant au lieu d'être écrasées (#355).
async function traiterChangementPlanningDistant(semaine: string): Promise<void> {
  if (traitementPlanningEnCours) {
    relecturePlanningDemandee = semaine;
    return;
  }
  if (semaine !== semaineActive()) return; // l'utilisateur a navigué entre-temps
  traitementPlanningEnCours = true;
  // Pas de push pendant la relecture : parti maintenant, `sauvegarder_planning`
  // (toute la semaine) écraserait en base le changement qu'on est en train de
  // lire. Replanifié à la fin si des éditions restent à pousser.
  suspendrePush();
  try {
    // Fusion ou remplacement décidés APRÈS la lecture, dès qu'un instantané
    // confirmé de la semaine existe (#355), même sans édition en attente au
    // départ : un clic pendant la lecture pose `dirty` pendant l'`await`.
    if (confirmeDeLaSemaine(semaine) && (await relireEnRejouantEditionsLocales(semaine))) {
      return;
    }
    const sigAvant = signaturePlanning(planningLocal());
    // Force le re-pull du planning. Lecture ratée : même protection que le
    // rejeu (#355), sinon le `finally` relançait le push (`dirty` toujours
    // posé) et `sauvegarder_planning` effaçait le changement distant non relu.
    // Aussi sans édition en attente : une édition ultérieure pousserait toute
    // la semaine sans ce changement.
    if (!(await chargerSemaineDansCache(semaine))) {
      relectureRatee(semaine);
      return;
    }
    // Comparé au distant (= instantané confirmé après la lecture), pas au
    // cache : un geste fait pendant la lecture y est rejoué (#368) et ne doit
    // pas passer pour un changement distant.
    if (semaineActive() === semaine && signaturePlanning(lireConfirme()) !== sigAvant) {
      declencherAlertePlanning();
    }
  } finally {
    traitementPlanningEnCours = false;
    const aRelire = relecturePlanningDemandee;
    relecturePlanningDemandee = null;
    if (aRelire !== null && aRelire === semaineActive()) {
      // Relecture finale AVANT tout push, contre l'instantané devenu « distant ».
      // Elle reprend la garde synchroniquement et relancera le push à sa fin.
      void traiterChangementPlanningDistant(aRelire);
    } else if (estDirty() && lireRelectureARefaire() !== semaine) {
      // Lecture ratée : pas de push avant une relecture réussie (refaite par
      // `pousser` au prochain déclencheur : édition, retour en ligne, navigation,
      // rechargement ; ou par la nouvelle tentative différée, #355).
      relancerPush();
    }
  }
}

// Le rejeu des éditions locales (#355) n'est sûr que si l'on sait ce qui a
// changé localement : instantané confirmé de la MÊME semaine que le cache, et
// aucun jour du confirmé perdu par le local (une semaine partielle, elle, est
// normale : week-end « Aucun », créneau désactivé, cf. `joursConserves`).
// Sinon : chemin historique, le distant fait foi.
function baseDuRejeu(semaine: string): { confirme: Planning; local: Planning } | null {
  if (!estDirty()) return null;
  const local = planningLocal();
  const confirme = lireConfirme();
  if (local === null || confirme === null) return null;
  if (local.semaine !== semaine || confirme.semaine !== semaine) return null;
  if (!joursConserves(confirme, local)) return null;
  return { confirme, local };
}

// Instantané confirmé de la semaine relue : la relecture lit alors le distant
// SANS toucher au cache et décide fusion ou remplacement APRÈS la lecture
// (#355). Décidé avant, une édition faite pendant la lecture (`dirty` posé
// pendant l'`await`) était écrasée par le chemin historique.
function confirmeDeLaSemaine(semaine: string): boolean {
  return lireConfirme()?.semaine === semaine && planningLocal()?.semaine === semaine;
}

/**
 * Relecture US-21 qui rejoue les éditions locales en attente (#355) : lecture
 * brute du distant (sans écraser le cache), puis `fusionnerEditionsLocales`
 * (créneaux modifiés localement et intacts à distance : rejoués ; même créneau
 * modifié des deux côtés : le distant gagne). Le résultat est écrit
 * directement dans le store, hors canal d'édition (#363) ; `dirty` reste posé si des créneaux ont été rejoués (le
 * push est replanifié par l'appelant). L'instantané confirmé devient le
 * DISTANT, pas la fusion : seul un push réussi confirme les éditions rejouées.
 * Alerte ssi le distant diffère de l'instantané confirmé (vrai changement
 * distant). Sans édition en attente APRÈS la lecture, le cache est simplement
 * remplacé par le distant (alerte ssi il diffère du cache d'avant) : la
 * décision suit la lecture, pour qu'un clic fait pendant l'`await` soit rejoué
 * et non écrasé (#355). Renvoie `false` si ni le rejeu ni le remplacement ne
 * sont applicables après la lecture (semaine supprimée à distance, local ayant
 * perdu des jours…) : l'appelant reprend alors le chemin historique.
 */
async function relireEnRejouantEditionsLocales(semaine: string): Promise<boolean> {
  let distant: Awaited<ReturnType<typeof chargerPlanningDistant>>;
  try {
    distant = await chargerPlanningDistant(semaine);
  } catch (erreur) {
    // Cache et `dirty` intacts ; le push attend une relecture réussie (cf.
    // `lireRelectureARefaire`), sinon il effacerait le changement distant.
    relectureRatee(semaine);
    console.error("Relecture du planning échouée (éditions locales conservées).", erreur);
    return true;
  }
  relectureReussie(semaine);
  // Navigation pendant la lecture : la semaine quittée n'est plus en cache.
  if (semaineActive() !== semaine) return true;
  // Relu APRÈS l'await : inclut les éditions faites pendant la lecture.
  const base = baseDuRejeu(semaine);
  if (distant === null) return false;
  // Éditions en attente mais rejeu douteux (local ayant perdu des jours) :
  // chemin historique, le distant fait foi.
  if (base === null && estDirty()) return false;
  // Aucune édition en attente : remplacement par le distant (une seule
  // lecture), comparé au cache d'avant pour l'alerte, comme le chemin historique.
  const reference = base?.confirme ?? planningLocal();
  if (reference === null) return false;

  const { planning, rejoues } = base
    ? fusionnerEditionsLocales(base.confirme, base.local, distant.planning)
    : { planning: distant.planning, rejoues: [] };
  // Écriture interne : ne passe pas par le canal d'édition, donc aucun push (#363).
  storePlanning.ecrire(JSON.stringify(planning));
  localStorage.setItem(CLE_MAJ, distant.updatedAt);
  ecrireConfirme(distant.planning);
  if (rejoues.length > 0 || pushEnCours) localStorage.setItem(CLE_DIRTY, "1");
  else localStorage.removeItem(CLE_DIRTY);
  // Défensif : `pousser` est gardé pendant le traitement et un event reçu
  // pendant un push est différé, donc aucun push ne devrait être en vol ici.
  // S'il l'était (parti avec l'ancien planning), il ne doit pas lever `dirty`
  // à son succès : `rePushDemande` lui fait repousser la fusion derrière lui
  // (la fusion, écrite hors canal d'édition, ne passe pas par `planifierPush`, #363).
  if (pushEnCours) rePushDemande = true;
  if (signaturePlanning(distant.planning) !== signaturePlanning(reference)) {
    declencherAlertePlanning();
  }
  return true;
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
  // Canal d'une semaine quittée ou en cours de coupure (#352) → ignorer.
  if (semaine !== semainePlanningVoulue) return;
  const ligne = payload.eventType === "DELETE" ? payload.old : payload.new;
  if (ligne.foyer_id && ligne.foyer_id !== foyer) return;
  if (ligne.semaine && ligne.semaine !== semaine) return;
  const cle = cleHorodatage(ligne.updated_at);
  // Sans horodatage exploitable, ou écho d'une de nos écritures → ignorer.
  if (cle === null || estEchoPlanning(semaine, cle)) return;
  // Écriture en vol : peut-être son écho, arrivé avant la réponse de la RPC
  // (#352) → jugé à la fin de l'écriture (terminerEcriturePlanning).
  if (ecrituresPlanningEnVol > 0) {
    const cles = eventsPlanningDifferes.get(semaine) ?? new Set<number>();
    cles.add(cle);
    eventsPlanningDifferes.set(semaine, cles);
    return;
  }
  void traiterChangementPlanningDistant(semaine);
}

let canalPlanning: RealtimeChannel | null = null;
let semainePlanningAbonnee: string | null = null;
// Semaine dont on VEUT les events, posée synchroniquement (#352) — alors que
// `semainePlanningAbonnee` ne change qu'à l'exécution de la file `chainePlanning`.
// Null après `couperTempsReel`. Un event d'une autre semaine (canal en cours de
// retrait) ou un event différé d'une semaine quittée n'est jamais jugé.
let semainePlanningVoulue: string | null = null;
let chainePlanning: Promise<void> = Promise.resolve();
// Vrai seulement entre le montage de `useSync` (`demarrerSync` : `/planning`,
// `/bienvenue`) et sa coupure (`couperTempsReel`) (#355). Une lecture encore en
// vol au démontage (`chargerSemaineDansCache` d'une hydratation, d'une
// navigation ou d'une relecture US-21) se termine sans rouvrir de canal ni
// reposer `semainePlanningVoulue` : sinon le canal restait ouvert hors de ces
// pages et ses events étaient jugés (relecture, alerte) sur une page qui ne les
// attend pas. Exception assumée : une relecture finale (`relecturePlanningDemandee`)
// déjà demandée au démontage s'exécute encore, et peut ouvrir l'alerte US-21
// hors de `/planning` (fenêtre étroite).
let abonnementPlanningAutorise = false;

function synchroniserAbonnementPlanning(semaine: string | null): Promise<void> {
  if (semaine !== null && !abonnementPlanningAutorise) return chainePlanning;
  semainePlanningVoulue = semaine;
  for (const s of [...eventsPlanningDifferes.keys()]) {
    if (s !== semaine) eventsPlanningDifferes.delete(s);
  }
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
// store/modale que #56 PR5). Même anti-écho exact que la semaine (#352) : un
// event dont l'`updated_at` est retenu (`horodatagesEcrits`) est l'écho d'une de
// nos écritures ; tout autre event est jugé. Pendant une écriture planning en vol
// ou la fenêtre de génération (`suppressionAlerteCycle`, qui couvre aussi la
// re-projection de rafraichirCycleGenere), les events sont différés, puis jugés
// à la fin (`jugerEventsCycleDifferes`) : notre écho est ignoré, celui d'un
// autre membre n'est plus perdu.
// ---------------------------------------------------------------------------
let suppressionAlerteCycle = false;
let traitementCycleEnCours = false;
// Event distant reçu PENDANT une re-projection du cycle (#355, jumeau de
// `relecturePlanningDemandee`) : UNE re-projection finale à la fin du traitement
// (une rafale = une seule). Jeté, le changement d'un autre membre écrit après la
// lecture en cours n'apparaissait ni dans la liste ni dans l'alerte.
let rejouerTraitementCycle = false;
const eventsCycleDifferes = new Map<string, Set<number>>();
// Re-projection demandée PENDANT la fenêtre de génération (#355), typiquement
// la re-projection finale d'un traitement qui se termine pendant une
// génération : différée comme les events (jugée par `jugerEventsCycleDifferes`)
// au lieu d'être jetée. Ses horodatages ne sont plus connus ici (déjà triés
// par `surEventPlanningCycle`) : c'est un drapeau, pas une entrée de
// `eventsCycleDifferes`.
let reprojectionCycleDifferee = false;

// Juge les events du cycle différés, une fois la dernière écriture planning
// terminée et hors fenêtre de génération.
function jugerEventsCycleDifferes(): void {
  if (ecrituresPlanningEnVol > 0 || suppressionAlerteCycle) return;
  const differes = [...eventsCycleDifferes];
  eventsCycleDifferes.clear();
  const reprojection = reprojectionCycleDifferee;
  reprojectionCycleDifferee = false;
  if (
    reprojection ||
    differes.some(([semaine, cles]) => [...cles].some((cle) => !estEchoPlanning(semaine, cle)))
  ) {
    void traiterChangementCycleDistant();
  }
}

// Re-projette le cycle affiché depuis la base (planning des 1-2 semaines
// touchées). Écrase la projection locale (contrairement à chargerCycleDansCache,
// PAS de dirty-first : un re-pull US-21/génération DOIT refléter la base).
// Lecture via `lireCycle` (chantier 05) : une semaine en échec rejette
// l'ensemble (ErreurLectureCycle), propagée à l'appelant comme avant.
async function rechargerProjectionCycle(ancre: string, longueur: number): Promise<void> {
  definirCyclePlanning((await lireCycle({ ancre, longueur })).planning);
}

async function traiterChangementCycleDistant(): Promise<void> {
  if (suppressionAlerteCycle) {
    reprojectionCycleDifferee = true; // jugée à la fin de la génération (#355)
    return;
  }
  if (traitementCycleEnCours) {
    rejouerTraitementCycle = true; // re-projection finale (#355)
    return;
  }
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
    if (rejouerTraitementCycle) {
      rejouerTraitementCycle = false;
      void traiterChangementCycleDistant();
    }
  }
}

// Canaux planning du cycle, un par semaine ISO touchée (clés = semaine).
const canauxPlanningCycle = new Map<string, RealtimeChannel>();
let chainePlanningCycle: Promise<void> = Promise.resolve();

// Filtre l'écho de nos propres écritures (`updated_at` retenu, #352) avant de
// traiter un changement distant du planning du cycle (US-21).
function surEventPlanningCycle(
  semaine: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: { updated_at?: string };
    old: { updated_at?: string };
  }
): void {
  const ligne = payload.eventType === "DELETE" ? payload.old : payload.new;
  const cle = cleHorodatage(ligne.updated_at);
  // Sans horodatage exploitable, ou écho d'une de nos écritures → ignorer.
  if (cle === null || estEchoPlanning(semaine, cle)) return;
  if (ecrituresPlanningEnVol > 0 || suppressionAlerteCycle) {
    const cles = eventsCycleDifferes.get(semaine) ?? new Set<number>();
    cles.add(cle);
    eventsCycleDifferes.set(semaine, cles);
    return;
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
  eventsCycleDifferes.clear(); // plus rien à juger après la coupure (#352)
  rejouerTraitementCycle = false; // ni re-projection finale (#355)
  reprojectionCycleDifferee = false; // ni re-projection différée (#355)
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
 * Régénération du cycle refusée SANS aucune écriture (#355) : des envois
 * (planning ou coches) restent en attente et ne partent pas (hors ligne,
 * relecture US-21 à refaire). Classe dédiée pour que la vue Cycle sache
 * qu'aucune RPC n'est partie, donc qu'il n'y a rien à relire.
 */
export class ErreurEnvoisEnAttente extends Error {
  constructor() {
    super("Des modifications ne sont pas encore enregistrées. Vérifie ta connexion et réessaie.");
    this.name = "ErreurEnvoisEnAttente";
  }
}

/**
 * Applique une génération fenêtrée (#259) : persiste le cycle en UNE écriture
 * atomique via la RPC `sauvegarder_cycle` (#304) — jours du cycle sur toutes les
 * semaines ISO touchées (sans écraser les jours voisins) ET purge des coches du
 * cycle (RG-13) dans la même transaction —, puis remet à zéro les coches locales
 * et re-projette depuis la base. Même RPC que le serveur MCP (règle du jumeau).
 *
 * Anti-écho US-21 (#352) : troisième écrivain du planning, au même titre que
 * `pousser` et `modifierSlotDistant` — compteur des écritures en vol pendant la
 * RPC, `updated_at` retenus pour chaque semaine écrite, et cache `storePlanning`
 * patché si la semaine affichée est touchée (sinon la vue Semaine, abonnée à
 * cette semaine, garderait l'ancien contenu et son prochain push écraserait le
 * cycle). Côté cycle, `suppressionAlerteCycle` diffère en plus les events
 * jusqu'à la fin de la re-projection (`jugerEventsCycleDifferes`).
 *
 * Envois vidés d'abord (#355, comme `naviguerVers`) : un push planning en
 * attente (`sauvegarder_planning`, toute la semaine) parti APRÈS la RPC
 * écraserait les jours générés de la semaine affichée ; s'il ne peut pas partir
 * (hors ligne, relecture US-21 à refaire), la génération est refusée avec un
 * message, sans RPC.
 */
export async function appliquerGenerationCycle(
  ancre: string,
  semaines: SemaineGeneree[]
): Promise<void> {
  if (!(await attendreSync())) throw new ErreurEnvoisEnAttente();
  suppressionAlerteCycle = true;
  try {
    ecrituresPlanningEnVol++;
    try {
      const majs = await sauvegarderCycleDistant(ancre, semaines);
      for (const [semaine, maj] of Object.entries(majs)) {
        retenirHorodatageEcrit(semaine, maj);
      }
      reporterGenerationSurSemaineAffichee(semaines, majs);
    } finally {
      terminerEcriturePlanning();
    }
    await rafraichirCycleGenere();
  } finally {
    suppressionAlerteCycle = false;
    jugerEventsCycleDifferes();
  }
}

// Reporte dans le cache `storePlanning` les jours générés de la semaine
// affichée (#352), comme le fait la RPC `sauvegarder_cycle` en base : seuls les
// (jour, type_repas) fournis sont remplacés, les autres jours et créneaux
// restent. La base est déjà à jour : écriture directe du store, qui ne pousse
// rien (seul le canal d'édition pousse, #363) ; une édition locale en attente
// (dirty) garde son propre minuteur et repoussera la semaine, patch inclus.
function reporterGenerationSurSemaineAffichee(
  semaines: SemaineGeneree[],
  majs: Record<string, string>
): void {
  const semaine = localStorage.getItem(CLE_SEMAINE);
  if (semaine === null) return;
  const generee = semaines.find((s) => s.semaine === semaine);
  const maj = majs[semaine];
  if (!generee || !maj) return;
  const local = planningLocal();
  if (local !== null && local.semaine !== semaine) return; // cache incohérent : ne pas toucher
  const jours = fusionnerJoursGeneres(local?.jours ?? [], generee.jours);
  localStorage.setItem(CLE_MAJ, maj);
  // L'instantané confirmé suit la base, comme le cache (jumeau, #355).
  patcherConfirme(semaine, (joursConfirmes) =>
    fusionnerJoursGeneres(joursConfirmes, generee.jours)
  );
  // Écriture interne (la base est déjà à jour) : aucun push (#363).
  storePlanning.ecrire(JSON.stringify({ semaine, jours }));
}

// Miroir local de l'upsert de `sauvegarder_cycle` sur une semaine : par jour
// généré, chaque créneau fourni remplace le créneau local (recette, personnes,
// restes) ; un créneau non fourni n'est pas touché. Jours dans l'ordre lundi →
// dimanche, comme la relecture de la base (`dbPlanningToDomain`).
function fusionnerJoursGeneres(
  locaux: JourPlanning[],
  generes: JourPlanning[]
): JourPlanning[] {
  const parJour = new Map(locaux.map((jp) => [jp.jour, jp] as const));
  for (const genere of generes) {
    let jp: JourPlanning = parJour.get(genere.jour) ?? { jour: genere.jour };
    for (const repas of ["dejeuner", "diner"] as const) {
      const recette = genere[repas];
      if (!recette) continue;
      const personnes = { ...jp.personnes };
      const restes = { ...jp.restes };
      delete personnes[repas];
      delete restes[repas];
      if (genere.personnes?.[repas] !== undefined) personnes[repas] = genere.personnes[repas];
      if (genere.restes?.[repas] !== undefined) restes[repas] = genere.restes[repas];
      jp = { ...jp, [repas]: recette, personnes, restes };
    }
    parJour.set(genere.jour, jp);
  }
  return ORDRE_JOURS.flatMap((jour) => {
    const jp = parJour.get(jour);
    return jp ? [jp] : [];
  });
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
      // Envois vidés AVANT l'appel réseau (#355) : hors ligne, le `fetch`
      // échouait d'abord avec un « Failed to fetch » brut. `appliquerGenerationCycle`
      // revide ensuite (un envoi a pu naître pendant la génération).
      if (!(await attendreSync())) throw new ErreurEnvoisEnAttente();
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

/** Remet à zéro les coches LOCALES du cycle affiché (RG-13 — la purge distante,
 *  `UPDATE … coche = false`, est faite par la RPC `sauvegarder_cycle`, #304 ;
 *  ses événements Realtime, plus récents, confirment la décoche dans le moteur)
 *  et re-projette le planning depuis la base (après une génération fenêtrée). */
async function rafraichirCycleGenere(): Promise<void> {
  const courant = lireCycleAffiche();
  if (!courant) return;
  // Des coches en file (geste fait pendant la RPC, écriture en échec) seraient
  // rejouées par-dessus la remise à zéro, et leur `updated_at`, postérieur à
  // celui de la RPC, gagnerait : « Tout décocher » les retire de la file et
  // part après une écriture déjà en vol (la vue est vidée au passage).
  // Articles manuels : `sauvegarder_cycle` ne touche pas `article_manuel`
  // (RG-41, seule une purge de cycle les touche), leur file reste intacte.
  // Seule la file de CETTE ancre compte : une opération d'un autre cycle
  // (hors ligne) ne doit pas faire partir un vidage inutile.
  const moteur = moteurCoches();
  if (moteur.enAttente(courant.ancre)) moteur.toutDecocher(courant.ancre);
  viderBlobLocal();
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
  // Coches : les files des deux moteurs sont rejouées (sans effet si un envoi
  // est déjà en cours, ni si elles sont vides). Un échec laisse en file : on
  // n'insiste pas pendant l'attente (pas de rafale hors ligne).
  rejouerCoches();
  for (
    let i = 0;
    i < 100 && (pushEnCours || estDirty() || cochesEnAttente());
    i++
  ) {
    // Push bloqué par une relecture US-21 (#355) puis replanifié à sa fin : on
    // le part tout de suite plutôt que d'attendre le débounce. Seulement s'il
    // y a un minuteur (pas de rafale de pushes après un échec hors ligne).
    if (minuteur && estDirty() && !pushEnCours && !traitementPlanningEnCours) {
      suspendrePush();
      void pousser();
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  return !(estDirty() || cochesEnAttente());
}

// Plafond des lectures d'une semaine relancées par un geste fait sur une AUTRE
// semaine pendant la lecture (#368, même plafond que les coches, #339).
const MAX_LECTURES_SEMAINE = 3;

// Charge une semaine dans le cache PLANNING SANS flush préalable, et sans push
// pendant la lecture. Une semaine sans planning vide le cache → état vide. Pose
// la semaine affichée. Depuis #257, cette fonction ne touche PLUS aux coches :
// elles sont propres au CYCLE (clé = ancre, ≠ semaine) et gérées par
// chargerCycleDansCache (/courses).
// Renvoie `true` si la lecture a réussi (#355) : une lecture ratée est loggée
// et laisse le cache intact, à l'appelant de protéger le push s'il le faut
// (relecture US-21, cf. traiterChangementPlanningDistant).
// Geste fait pendant la lecture (#368) : sur la même semaine, il est rejoué sur
// le distant ; sur la semaine encore affichée (navigation), elle est poussée
// d'abord puis la cible relue, au plus `MAX_LECTURES_SEMAINE` fois ; au-delà, ou
// si l'envoi échoue, la navigation est abandonnée (rien n'est perdu, le geste
// part au push suivant) et la fonction renvoie `false`.
async function chargerSemaineDansCache(semaine: string): Promise<boolean> {
  for (let lecture = 1; ; lecture++) {
    const issue = await lireSemaineDansCache(semaine);
    if (issue !== "geste-autre-semaine") return issue === "lu";
    if (lecture >= MAX_LECTURES_SEMAINE || !(await attendreSync())) {
      const local = planningLocal();
      if (local) {
        definirSemaineAffichee(local.semaine);
        void synchroniserAbonnementPlanning(local.semaine);
      }
      if (estDirty()) relancerPush();
      return false;
    }
  }
}

// Une lecture de `chargerSemaineDansCache`. La décision suit l'`await` (#368) :
// `geste-autre-semaine` si l'utilisateur a modifié une autre semaine pendant
// la lecture (le cache n'est alors pas touché).
async function lireSemaineDansCache(
  semaine: string
): Promise<"lu" | "echec" | "geste-autre-semaine"> {
  const gestes = gestesPlanning;
  // Planning figé au début de la lecture : base du rejeu d'un geste fait
  // pendant l'`await` (#368).
  const avant = planningLocal();
  let distant: Awaited<ReturnType<typeof chargerPlanningDistant>>;
  lectureSemaineEnCours = true;
  try {
    distant = await chargerPlanningDistant(semaine);
  } catch (erreur) {
    console.error("Chargement de la semaine échoué.", erreur);
    lectureSemaineEnCours = false;
    afficherSemaineLue(semaine);
    return "echec";
  }
  lectureSemaineEnCours = false;
  const local = planningLocal();
  if (gestes === gestesPlanning) {
    if (distant) {
      storePlanning.ecrire(JSON.stringify(distant.planning));
    } else {
      storePlanning.effacer();
    }
    localStorage.removeItem(CLE_DIRTY);
  } else if (local === null || local.semaine !== semaine) {
    // Geste sur la semaine encore affichée (navigation) : la pousser d'abord.
    return "geste-autre-semaine";
  } else if (distant && avant?.semaine === semaine) {
    // Même semaine : seul le geste fait pendant la lecture est rejoué sur le
    // distant (un créneau changé des deux côtés : le distant gagne). Écriture
    // interne, hors canal d'édition : aucun push immédiat (#363).
    const { planning, rejoues } = fusionnerEditionsLocales(avant, local, distant.planning);
    storePlanning.ecrire(JSON.stringify(planning));
    if (rejoues.length > 0) localStorage.setItem(CLE_DIRTY, "1");
    else localStorage.removeItem(CLE_DIRTY);
  }
  // Sinon (cache vide au départ, ou semaine absente en base) : pas de base pour
  // rejouer, le local du geste fait foi et `dirty` reste posé.
  if (distant) localStorage.setItem(CLE_MAJ, distant.updatedAt);
  else localStorage.removeItem(CLE_MAJ);
  // Le distant lu est le nouveau planning confirmé de la semaine (#355).
  ecrireConfirme(distant ? distant.planning : null);
  relectureReussie(semaine); // lève aussi la relecture à refaire (#355)
  definirEtatPlanning("synchronise");
  afficherSemaineLue(semaine);
  return "lu";
}

// Fin d'une lecture de semaine (réussie ou non) : pose la semaine affichée,
// (ré)abonne son temps réel, et relance le push d'un geste fait pendant la
// lecture (gardé pendant l'`await`, #368).
function afficherSemaineLue(semaine: string): void {
  definirSemaineAffichee(semaine);
  void synchroniserAbonnementPlanning(semaine);
  if (estDirty()) relancerPush();
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
  try {
    // Changement d'ancre : le blob local est celui de l'ANCIEN cycle. On le
    // retire tout de suite, sinon une coche posée avant l'arrivée des coches
    // distantes ferait passer tout l'ancien blob pour des gestes, poussés sous
    // la NOUVELLE ancre. Les gestes non poussés de l'ancien cycle (ex. hors
    // ligne) ne sont pas perdus : ils restent dans la file du moteur, avec
    // leur ancre.
    if (lireCycleAffiche()?.ancre !== ancre) viderBlobLocal();
    // Lecture via `lireCycle` (chantier 05) : une semaine en échec rejette
    // l'ensemble (jamais de projection partielle), journalisé par le catch
    // ci-dessous sans écraser le cache.
    const projete = (await lireCycle({ ancre, longueur })).planning;
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
    // Pose l'ancre affichée AVANT toute opération sur les coches : un geste
    // lit `ancreActive()` (dérivé du cycle affiché) et doit donc viser le
    // NOUVEAU cycle, pas l'ancien (#257, revue).
    definirCycleAffiche(ancre, longueur);
    // Coches par-article, clées par ancre (#257), sur le moteur (#362) : la
    // file hors ligne est rejouée (chaque opération dans son ancre), puis
    // l'état distant est hydraté ; une clé encore en file garde le local
    // (dirty-first par clé), et un geste fait pendant la lecture la fait
    // relire (cf. lireEtHydraterCoches).
    rejouerCoches();
    try {
      await lireCochesDuCycle(ancre);
      annulerRelectureCoches();
    } catch (erreur) {
      planifierRelectureCoches(ancre); // sinon le temps réel resterait muet
      throw erreur;
    }
    // Des coches encore en file gardent l'indicateur des moteurs (« sauvegarde »
    // ou « hors-ligne ») : ils repassent eux-mêmes à « synchronise » à la fin
    // (indicateur composé, cf. `publierEtat`). Un push planning en échec ou une
    // relecture US-21 à refaire gardent aussi le leur.
    if (!pushEnCours && !estDirty() && lireRelectureARefaire() === null) {
      definirEtatPlanning("synchronise");
    }
  } catch (erreur) {
    console.error("Chargement du cycle échoué.", erreur);
    // Aucun cycle affiché (premier accès sans cache) : état erreur, sinon
    // squelette sans fin (#402, RG-09). Un cycle déjà affiché reste affiché.
    signalerEchecSiAucunCycle();
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
  relanceChargementCycle = hydraterCycle; // « Réessayer » (#402)
  poserEchecChargementCycle(false);
  // Fail-open lundi, repli loggé : même helper que la vue Cycle (jumeau, #352).
  const jour = await jourCoursesOuLundi(chargerJourCoursesFoyer());
  // ancreParDefaut (pas ancreCourante) : à ≤ 2 jours de la fin du cycle, on
  // prépare déjà le suivant (RG-91, #386) ; sinon /courses afficherait un cycle
  // courant presque écoulé (#257).
  const ancre = ancreParDefaut(new Date(), jour);
  // Lecture stricte (#365) : repli client explicite et loggé sur 7 jours (une
  // rejection non catchée deviendrait un unhandledRejection sous `void hydraterCycle()`).
  const longueur = await longueurOuDefaut(chargerLongueurCycle(ancre));
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
  const longueur = await longueurOuDefaut(chargerLongueurCycle(ancre)); // repli client (#365)
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
  relanceChargementCycle = () => allerAuCycle(ancre); // « Réessayer » (#402)
  poserEchecChargementCycle(false);
  if (!(await attendreSync())) {
    // Hors-ligne : ne pas perdre les écritures. Sans cycle affiché, la page
    // passerait sinon un squelette sans fin (#402).
    signalerEchecSiAucunCycle();
    return;
  }
  const longueur = await longueurOuDefaut(chargerLongueurCycle(ancre)); // repli client (#365)
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
 * Anti-écho, sinon on déclenche une fausse alerte intrusive sur sa propre
 * édition :
 * - compteur des écritures en vol + `updated_at` retenu pour la semaine
 *   (`horodatagesEcrits`, #352) : toujours, quelle que soit la semaine — il
 *   sert aux deux temps réels (/planning et cycle de /courses).
 * - `planning_courant_maj` + cache `storePlanning` (vue Semaine de /planning,
 *   #56 PR5) : UNIQUEMENT si la semaine éditée est la semaine actuellement
 *   affichée — sinon ce cache ne représente pas cette semaine, rien à patcher.
 *
 * Ce patch écrit le store directement, hors du canal d'édition (#363) : la base
 * est DÉJÀ à jour via `sauvegarder_slots`, donc aucun `sauvegarder_planning` de
 * toute la semaine ne doit partir (double écriture, #301). Une édition
 * locale déjà en attente (`planning_dirty`) garde son propre minuteur et
 * repoussera la semaine, patch inclus.
 */
export async function modifierSlotDistant(
  semaine: string,
  jourPlanning: JourPlanning
): Promise<void> {
  // Écriture en vol (#352) : son écho reçu avant la réponse est jugé à la fin,
  // une fois son `updated_at` retenu (jumeau de `pousser`).
  ecrituresPlanningEnVol++;
  try {
    const maj = await sauvegarderSlotsDistant(semaine, [jourPlanning]);
    retenirHorodatageEcrit(semaine, maj);

    if (semaine === localStorage.getItem(CLE_SEMAINE)) {
      localStorage.setItem(CLE_MAJ, maj);
      // L'instantané confirmé suit la base, comme le cache (jumeau, #355).
      patcherConfirme(semaine, (jours) => remplacerOuInsererJour(jours, jourPlanning));
      const local = planningLocal();
      if (local && local.semaine === semaine) {
        const jours = remplacerOuInsererJour(local.jours, jourPlanning);
        // Écriture directe du store : ne pousse rien (#363), sans toucher à la
        // garde qu'une relecture (chargerSemaineDansCache) peut tenir.
        storePlanning.ecrire(JSON.stringify({ semaine, jours }));
      }
    }
  } finally {
    terminerEcriturePlanning();
  }
}

// Remplace le jour édité, ou l'insère à sa place (lundi → dimanche) s'il est
// absent (#355) : une semaine partielle (jour sans aucun créneau) n'a pas ce
// jour en cache. Ignoré, un repas ajouté depuis la vue Cycle sur ce jour
// manquait au cache, et le push suivant (`sauvegarder_planning`, toute la
// semaine) le supprimait en base. Même placement que `fusionnerJoursGeneres`.
function remplacerOuInsererJour(
  jours: JourPlanning[],
  jourPlanning: JourPlanning
): JourPlanning[] {
  const parJour = new Map(jours.map((jp) => [jp.jour, jp] as const));
  parJour.set(jourPlanning.jour, jourPlanning);
  return ORDRE_JOURS.flatMap((jour) => {
    const jp = parJour.get(jour);
    return jp ? [jp] : [];
  });
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
 *
 * `semaineVoulue` (lien `/planning?semaine=`, #336, déjà validé par l'appelant)
 * remplace la semaine par défaut ; si le cache local fait foi ou si l'app est
 * déjà hydratée, on y navigue ensuite (`naviguerVers` flushe d'abord).
 */
export async function hydrater(semaineVoulue: string | null = null): Promise<void> {
  if (dejaHydrate) {
    if (estDirty()) void pousser();
    rejouerCoches();
    if (semaineVoulue) void naviguerVers(semaineVoulue);
    return;
  }
  dejaHydrate = true;
  // Semaine lue (#400) : posée à la sortie de la première lecture, quelle
  // qu'elle soit (`finally`) ; le remontage SPA ci-dessus n'y touche pas (un
  // premier appel encore en vol la posera, ex. double montage de StrictMode).
  try {
    purgerHistorique(); // rétention 12 semaines (#5) — fire-and-forget

    const local = planningLocal();
    if (local && (estDirty() || lireMajLocale() === 0)) {
      // Cas e2e/offline : le local fait foi, on ne le remplace pas.
      definirSemaineAffichee(local.semaine);
      // Le cache affiché est déjà la semaine : pas de squelette (#400).
      marquerSemaineLue();
      // Relecture US-21 ratée avant le rechargement (`CLE_A_RELIRE`, #355) :
      // `pousser` la refait d'abord et ne pousse que la fusion.
      if (estDirty()) void pousser();
      await hydraterCoches();
      // Coches clées par CYCLE (#257) : réabonnement sur l'ancre active (null hors
      // /courses → no-op sûr), pas sur la semaine du planning.
      void synchroniserAbonnementCoches(ancreActive());
      void synchroniserAbonnementPlanning(local.semaine);
      if (semaineVoulue && semaineVoulue !== local.semaine) void naviguerVers(semaineVoulue);
      return;
    }

    // Cas nominal : on affiche la semaine par défaut (ou celle du lien) depuis la
    // base (chargement forcé — pas de garde « déjà affichée », car le cache peut
    // être vide). Une lecture ratée est journalisée par `chargerSemaineDansCache`.
    await chargerSemaineDansCache(semaineVoulue ?? semaineParDefaut());
  } finally {
    marquerSemaineLue();
  }
}

// Démarre la synchro : abonnement aux écritures (planning + coches), temps réel
// (coches du foyer + présence) + rejeu au retour en ligne. Retourne une fonction
// d'arrêt (cleanup d'effet).
function demarrerSync(): () => void {
  // Seul un geste de l'utilisateur (écriture d'intention de lib/stockage.ts,
  // ou écriture d'un autre onglet) pousse le planning : les écritures internes
  // de la synchro écrivent le store sans effet de bord (#363).
  const desabonnerPlanning = surEditionPlanning(planifierPush);
  // Référence du diff = blob affiché au montage : il n'est pas un geste (sinon
  // la première coche repousserait toutes les coches d'une session passée).
  blobConnu = cochesLocales();
  const desabonnerCoches = storeCoches.sAbonner(surChangementCoches);
  const surRetourEnLigne = () => {
    if (estDirty()) void pousser();
    rejouerCoches();
  };
  window.addEventListener("online", surRetourEnLigne);
  // Temps réel (#56 PR4/PR5) : abonnement aux coches (par ANCRE de cycle, #257 —
  // null hors /courses → no-op) + au planning du foyer si une semaine/ancre est
  // déjà connue (nav SPA « à chaud » ; au chargement froid, l'abonnement est posé
  // par hydrater/chargerSemaineDansCache/chargerCycleDansCache une fois résolu).
  // La PRÉSENCE est gérée à part (usePresenceCourses).
  abonnementPlanningAutorise = true; // jusqu'à couperTempsReel (#355)
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
 * `semaineVoulue` : cf. hydrater ; doit être stable (lu une fois au montage).
 */
export function useSync(semaineVoulue: string | null = null): EtatSync {
  const etatCourant = useSyncExternalStore(
    storeEtatSync.sAbonner,
    storeEtatSync.lire,
    storeEtatSync.lireServeur
  );
  useEffect(() => {
    const arreter = demarrerSync();
    void hydrater(semaineVoulue);
    return arreter;
  }, [semaineVoulue]);
  return etatCourant;
}

// Démarre la synchro CÔTÉ COCHES uniquement (#257, pour /courses) : abonnement
// aux écritures de coches + temps réel des coches (par ancre) + rejeu au retour
// en ligne. Volontairement PAS d'abonnement storePlanning→push, PAS d'hydratation
// de la semaine, PAS de temps réel planning : /courses affiche un CYCLE (planning
// projeté en mémoire), pas la semaine du planning courant. Retourne l'arrêt.
function demarrerSyncCoches(): () => void {
  relectureCochesAutorisee = true; // jusqu'à couperTempsReel
  // Référence du diff = blob affiché au montage : il n'est pas un geste (sinon
  // la première coche repousserait toutes les coches d'une session passée).
  blobConnu = cochesLocales();
  const desabonnerCoches = storeCoches.sAbonner(surChangementCoches);
  // Retour en ligne : la file des coches part, puis les coches du cycle
  // affiché sont relues (événements manqués hors ligne ; hydratation jamais
  // faite si la page a été chargée hors ligne, sans quoi le moteur ignore
  // les événements Realtime). Le quota de nouvelles tentatives est réarmé
  // (épuisé hors ligne, il ne retentait plus rien), et les canaux temps réel
  // ratés hors ligne (foyer illisible) sont rouverts ; idempotent sinon.
  const surRetourEnLigne = () => {
    annulerRelectureCoches();
    rejouerCoches();
    const ancre = ancreActive();
    if (ancre === null) return;
    void synchroniserAbonnementCoches(ancre);
    void synchroniserAbonnementArticlesManuels(ancre);
    void relireCoches(ancre);
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
