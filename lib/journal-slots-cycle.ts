// Journal des écritures de la vue Cycle non confirmées (PR #405).
//
// La vue Cycle écrit chaque édition directement en base, par une file d'une
// écriture en vol par (semaine, jour) (`lib/file-ecriture-slots.ts`). Une
// page rechargée (ou l'app fermée) pendant une écriture perdait la valeur
// suivante, mise en file derrière : un Ctrl+Z juste après « Changer » laissait
// en base le repas changé. La file pose ici la dernière valeur voulue par
// (semaine, jour) et l'en retire une fois le jour réglé ; le premier
// chargement de la vue rejoue ce qui reste avant de lire le cycle.
// Jumeau du journal des préférences (`lib/preferences.ts`, #404) ; la vue
// Semaine a son propre mécanisme (`planning_dirty`). Purgé au changement de
// foyer (`reinitialiserCacheFoyer`, lib/sync.ts).

import type { JourPlanning } from "@/types";

export const CLE_SLOTS_CYCLE_EN_ATTENTE = "slots_cycle_en_attente";

type Journal = Record<string, { semaine: string; jour: JourPlanning }>;

const cle = (semaine: string, nomJour: JourPlanning["jour"]) => `${semaine}|${nomJour}`;

function lireJournal(): Journal {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CLE_SLOTS_CYCLE_EN_ATTENTE) ?? "{}");
  } catch (erreur) {
    console.error("Journal des modifications du cycle illisible (ignoré).", erreur);
    return {};
  }
}

function majJournal(maj: (journal: Journal) => void): void {
  if (typeof window === "undefined") return;
  const journal = lireJournal();
  maj(journal);
  try {
    if (Object.keys(journal).length === 0) localStorage.removeItem(CLE_SLOTS_CYCLE_EN_ATTENTE);
    else localStorage.setItem(CLE_SLOTS_CYCLE_EN_ATTENTE, JSON.stringify(journal));
  } catch (erreur) {
    console.error("Journal des modifications du cycle non enregistré.", erreur);
  }
}

/** Dernière valeur voulue pour un jour (avant tout envoi, débounce compris). */
export function journaliserSlot(semaine: string, jour: JourPlanning): void {
  majJournal((journal) => {
    journal[cle(semaine, jour.jour)] = { semaine, jour };
  });
}

/** Jour réglé (écrit, ou refusé et remis à l'écran) : plus rien à rejouer. */
export function retirerSlot(semaine: string, nomJour: JourPlanning["jour"]): void {
  majJournal((journal) => {
    delete journal[cle(semaine, nomJour)];
  });
}

// Échec d'une écriture coupée par le navigateur (page quittée) : la valeur
// reste à rejouer (`lib/page-quittee.ts`).
export { pageQuittee } from "@/lib/page-quittee";

// Un seul rejeu à la fois (double montage de StrictMode).
let rejeuEnCours: Promise<void> | null = null;

/**
 * Rejoue les écritures d'une page précédente, une par jour, puis les retire.
 * Un échec est journalisé et la valeur abandonnée : rejouée plus tard, elle
 * pourrait écraser une modification plus récente d'un autre membre.
 */
export function rejouerSlotsEnAttente(
  ecrire: (semaine: string, jour: JourPlanning) => Promise<void>
): Promise<void> {
  rejeuEnCours ??= (async () => {
      for (const { semaine, jour } of Object.values(lireJournal())) {
      try {
        await ecrire(semaine, jour);
      } catch (erreur) {
        console.error("Modification du cycle en attente non rejouée.", erreur);
      }
      retirerSlot(semaine, jour.jour);
    }
  })().finally(() => {
    rejeuEnCours = null;
  });
  return rejeuEnCours;
}
