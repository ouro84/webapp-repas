"use client";

// Alerte intrusive de modification du planning (#56 PR5, US-21).
//
// Un membre du foyer modifie le planning de la semaine à la maison pendant qu'un
// autre est « en magasin » : ce dernier reçoit, via le temps réel (lib/sync.ts),
// une alerte BLOQUANTE. Au moment de l'event, le planning ET la liste de courses
// ont déjà été re-pull (le « local fait foi » est levé) ; cette modale ne fait
// qu'informer. Acquittement à action unique → ferme (acquitterAlertePlanning).
//
// Monté une seule fois dans le layout : inerte hors des pages synchronisées
// (/planning, /courses), où rien ne déclenche l'alerte.

import { ConfirmationModale } from "@/components/ui/confirmation";
import { acquitterAlertePlanning, useAlertePlanning } from "@/lib/sync";

export function AlerteModifPlanning() {
  const alerte = useAlertePlanning();
  if (!alerte) return null;
  return (
    <ConfirmationModale
      titre="Planning mis à jour"
      message="Attention, le planning de la semaine vient d’être modifié ! Votre liste de courses a été mise à jour."
      libelleConfirmer="OK, j’ai compris"
      sansAnnuler
      onConfirmer={acquitterAlertePlanning}
      onAnnuler={acquitterAlertePlanning}
    />
  );
}
