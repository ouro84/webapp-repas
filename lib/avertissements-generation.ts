// Messages d'avertissement de génération (#168) — cœur PUR, testable.
//
// La génération renvoie des compteurs de préférences SOUPLES non honorées
// (dégradation gracieuse, jamais bloquante) : repas non végé (RG-26), jours
// sans légume (RG-27), repas hors-saison (RG-28). La page planning en faisait
// des toasts inline avec une logique singulier/pluriel dupliquée. On l'extrait
// ici pour la tester sans dépendre du catalogue réel (l'e2e ne peut pas
// déclencher ces cas de façon déterministe) et pour verrouiller le contrat des
// messages. La page mappe simplement la liste retournée en toasts d'info.

export type CompteursAvertissement = {
  /** Repas qui n'ont pas pu être végétariens (RG-26). */
  vegeNonHonore?: number;
  /** Jours sans aucun repas « légumes » (RG-27). */
  mixNonHonore?: number;
  /** Repas complétés hors-saison par dégradation gracieuse (RG-28). */
  saisonNonHonore?: number;
};

/**
 * Construit la liste des messages d'avertissement à afficher après une
 * génération, dans l'ordre RG-26 → RG-27 → RG-28. Un compteur nul ou absent ne
 * produit aucun message ; chaque message s'accorde en nombre (singulier/pluriel).
 * Liste vide = génération pleinement honorée (aucun avertissement).
 */
export function messagesAvertissementGeneration(
  compteurs: CompteursAvertissement
): string[] {
  const { vegeNonHonore = 0, mixNonHonore = 0, saisonNonHonore = 0 } = compteurs;
  const messages: string[] = [];

  if (vegeNonHonore > 0) {
    messages.push(
      vegeNonHonore === 1
        ? "1 repas n’a pas pu être végétarien (pas assez de recettes végé)."
        : `${vegeNonHonore} repas n’ont pas pu être végétariens (pas assez de recettes végé).`
    );
  }
  if (mixNonHonore > 0) {
    messages.push(
      mixNonHonore === 1
        ? "1 jour n’a pas de repas « légumes » (pas assez de recettes légumes)."
        : `${mixNonHonore} jours n’ont pas de repas « légumes » (pas assez de recettes légumes).`
    );
  }
  if (saisonNonHonore > 0) {
    messages.push(
      saisonNonHonore === 1
        ? "1 repas est hors saison (pas assez de recettes de saison)."
        : `${saisonNonHonore} repas sont hors saison (pas assez de recettes de saison).`
    );
  }
  return messages;
}
