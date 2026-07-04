// Fixture Playwright partagée — GARDE ANTI-CRASH (#257, suite rétro CI).
//
// Pourquoi : le crash /courses de #257 (boucle React #185 → error boundary
// « Quelque chose s'est mal passé ») se manifestait en CI par un TIMEOUT
// cryptique (le test attendait un élément que la page crashée ne rendait jamais)
// — jusqu'à 25 min avant annulation, sans message clair. Cette garde transforme
// tout crash React en ÉCHEC EXPLICITE et immédiat.
//
// Comment : on écoute `pageerror` (exceptions non catchées) et les
// `console.error` du navigateur, en ne retenant QUE les signatures de crash
// React (pas les erreurs applicatives volontairement loggées, ex. « Chargement
// du foyer (temps réel) échoué » qui est un repli capturé). En téardown de la
// fixture auto, on assert qu'aucune n'a été captée.
//
// Couverture : la fixture `auto` couvre la `page` par défaut (specs mono-page).
// Les specs MULTI-CONTEXTE (foyer-clonage, coches-realtime, alerte-planning)
// créent leurs propres pages via browser.newContext() → elles doivent appeler
// `attacherGardeCrash(page)` sur chaque page et vérifier `.erreurs` avant la fin.
//
// Usage : remplacer `import { test, expect } from "@playwright/test"` par
// `import { test, expect } from "./fixtures"` dans les specs.

import { test as base, expect, type Page } from "@playwright/test";

export { expect };

// Signatures de crash React, en prod (messages minifiés : « Minified React
// error #185 ») ET en dev/local (messages complets : « Maximum update depth
// exceeded »). Ne matche PAS les erreurs applicatives loggées volontairement.
const RX_CRASH_REACT =
  /Minified React error|Maximum update depth exceeded|Objects are not valid as a React child|Rendered (more|fewer) hooks/;

/**
 * Attache l'écoute des crashs React à une page et renvoie un accès aux erreurs
 * captées. Pour les pages créées à la main (browser.newContext) : appeler tôt,
 * puis `expect(garde.erreurs).toEqual([])` avant de fermer le contexte.
 */
export function attacherGardeCrash(page: Page): { erreurs: string[] } {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => {
    if (RX_CRASH_REACT.test(e.message)) erreurs.push(`pageerror: ${e.message}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && RX_CRASH_REACT.test(m.text())) {
      erreurs.push(`console: ${m.text()}`);
    }
  });
  return { erreurs };
}

// `test` étendu : la fixture `gardeCrash` (auto) surveille la page par défaut et
// fait échouer le test si un crash React est survenu pendant son exécution.
export const test = base.extend<{ gardeCrash: void }>({
  gardeCrash: [
    async ({ page }, use) => {
      const garde = attacherGardeCrash(page);
      await use();
      expect(
        garde.erreurs,
        `Crash React détecté (error boundary) — cf. e2e/fixtures.ts :\n${garde.erreurs.join(
          "\n"
        )}`
      ).toEqual([]);
    },
    { auto: true },
  ],
});
