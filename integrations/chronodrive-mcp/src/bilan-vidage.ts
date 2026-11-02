// Mise en forme du bilan d'un vidage (#320, RG-82), partagée par le script `src/vider-panier.ts` et
// l'outil `vider_panier` (src/admin.ts). Module sans effet de bord : l'importer ne lance rien.
import type { BilanVidage, StatutRetrait } from "./panier.ts";

export const STATUTS: Record<StatutRetrait, string> = {
  simulee: "serait retiré",
  retiree: "retiré",
  toujours_au_panier: "toujours au panier",
  non_tente: "non tenté (connexion interrompue)",
  non_verifie: "retrait non vérifié",
};

export function formaterBilan(b: BilanVidage): string {
  const lignes = b.lignes.map((l) => {
    const produit = `${l.quantite} × ${l.libelle}${l.marque ? ` · ${l.marque}` : ""}`;
    // Une ligne retirée n'affiche pas son erreur : le DELETE a pu échouer alors que la relecture
    // montre la ligne partie, et c'est la relecture qui fait foi.
    const erreur = l.erreur && l.statut !== "retiree" ? ` : ${l.erreur}` : "";
    return `${produit} — ${STATUTS[l.statut]}${erreur}`;
  });
  const n = b.lignes.length;
  let conclusion: string;
  if (n === 0 && b.vide) conclusion = "Panier déjà vide.";
  else if (b.simulation) conclusion = `Simulation : ${n} ligne(s) seraient retirées, rien n'a été modifié.`;
  else if (b.vide) conclusion = `Panier vidé : ${n} ligne(s) retirée(s), panier relu vide.`;
  else if (!b.relu) conclusion = "Panier non relu : vérifie dans l'appli Chronodrive.";
  else conclusion = `Panier pas entièrement vidé : ${b.restantes ?? b.lignes.filter((l) => l.statut !== "retiree").length} ligne(s) restent, vérifie dans l'appli Chronodrive.`;
  return [...lignes, conclusion].join("\n");
}
