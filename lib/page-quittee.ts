// Page en train d'être quittée (rechargement, fermeture, navigation pleine
// page) : une écriture qui échoue alors a été coupée par le navigateur, pas
// refusée par le serveur ; les journaux d'écritures non confirmées
// (`lib/preferences.ts`, `lib/journal-slots-cycle.ts`) gardent sa valeur pour
// la rejouer au chargement suivant.
//
// Marquée dès `beforeunload`, pas seulement à `pagehide` : Chromium coupe les
// requêtes en vol AVANT `pagehide` (mesuré en e2e : « Failed to fetch » 8 ms
// avant `pagehide`), et l'échec passait pour un refus. L'app n'annule jamais
// `beforeunload` (aucun écouteur ne l'empêche) ; `pageshow` la rétablit
// (retour par le cache de navigation).

let quittee = false;
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => (quittee = true));
  window.addEventListener("pagehide", () => (quittee = true));
  window.addEventListener("pageshow", () => (quittee = false));
}

export function pageQuittee(): boolean {
  return quittee;
}
