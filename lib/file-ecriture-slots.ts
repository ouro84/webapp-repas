// File d'écriture par jour de la vue Cycle (#301, US-49/RG-57).
//
// La vue Cycle applique chaque édition tout de suite dans son état local
// (optimiste) puis confie l'écriture distante à cette file :
// - une rafale de clics sur le stepper personnes (US-07) ne produit qu'UNE
//   écriture, avec la dernière valeur (débounce `DELAI_STEPPER_MS`) ; les
//   actions ponctuelles (changer, sélectionner, restes, annuler) partent
//   immédiatement (`delaiMs: 0`) ;
// - au plus une écriture en vol par jour : deux RPC concurrentes sur le même
//   jour pourraient arriver dans le désordre et laisser l'ancienne valeur en
//   base (ex. « Annuler » cliqué pendant que l'édition s'écrit encore) ;
// - en cas d'échec, `surEchec` reçoit l'état CONFIRMÉ (le dernier connu en
//   base, ou celui d'avant la rafale) pour que la vue y revienne.
//
// Clé = (semaine, jour) et non (semaine, jour, repas) : `sauvegarder_slots`
// upserte le JourPlanning complet, donc deux éditions du même jour (déjeuner
// puis dîner) se fondent en une seule écriture du jour le plus récent.
//
// Pur : ni React ni Supabase, l'écriture et le callback d'échec sont injectés.

import type { JourPlanning } from "@/types";

// Aligné sur DELAI_DEBOUNCE_MS de lib/sync.ts (push débouncé de la vue Semaine).
export const DELAI_STEPPER_MS = 800;

export type FileEcritureSlots = {
  planifier(
    semaine: string,
    jour: JourPlanning,
    options: { delaiMs: number; precedent: JourPlanning }
  ): void;
  // Envoie tout de suite les écritures débouncées et se résout quand plus rien
  // n'est en attente ni en vol. Ne rejette jamais (échecs → surEchec).
  vider(): Promise<void>;
};

type Entree = {
  semaine: string;
  confirme: JourPlanning;
  enAttente: JourPlanning | null;
  minuteur: ReturnType<typeof setTimeout> | null;
  enVol: Promise<void> | null;
};

export function creerFileEcritureSlots(deps: {
  ecrire: (semaine: string, jour: JourPlanning) => Promise<void>;
  surEchec: (semaine: string, jourConfirme: JourPlanning, erreur: unknown) => void;
}): FileEcritureSlots {
  const entrees = new Map<string, Entree>();

  function envoyer(cle: string): void {
    const entree = entrees.get(cle);
    if (!entree || entree.enVol || entree.enAttente === null) return;
    if (entree.minuteur) {
      clearTimeout(entree.minuteur);
      entree.minuteur = null;
    }
    const valeur = entree.enAttente;
    entree.enAttente = null;
    entree.enVol = deps.ecrire(entree.semaine, valeur).then(
      () => {
        entree.enVol = null;
        entree.confirme = valeur;
        // Une valeur arrivée pendant le vol dont le minuteur a déjà expiré part
        // maintenant ; sinon son minuteur la déclenchera.
        if (entree.enAttente !== null && entree.minuteur === null) envoyer(cle);
        else if (entree.enAttente === null) entrees.delete(cle);
      },
      (erreur: unknown) => {
        if (entree.minuteur) clearTimeout(entree.minuteur);
        entrees.delete(cle);
        deps.surEchec(entree.semaine, entree.confirme, erreur);
      }
    );
  }

  return {
    planifier(semaine, jour, { delaiMs, precedent }) {
      const cle = `${semaine}|${jour.jour}`;
      let entree = entrees.get(cle);
      if (!entree) {
        entree = { semaine, confirme: precedent, enAttente: null, minuteur: null, enVol: null };
        entrees.set(cle, entree);
      }
      entree.enAttente = jour;
      if (entree.minuteur) clearTimeout(entree.minuteur);
      entree.minuteur = null;
      if (delaiMs <= 0) {
        envoyer(cle);
      } else {
        entree.minuteur = setTimeout(() => {
          entree.minuteur = null;
          envoyer(cle);
        }, delaiMs);
      }
    },

    async vider() {
      // Boucle : un vol qui se termine peut relancer la valeur arrivée pendant.
      while (entrees.size > 0) {
        for (const cle of [...entrees.keys()]) envoyer(cle);
        const vols = [...entrees.values()]
          .map((e) => e.enVol)
          .filter((v): v is Promise<void> => v !== null);
        if (vols.length === 0) break;
        await Promise.all(vols.map((v) => v.catch(() => {})));
      }
    },
  };
}
