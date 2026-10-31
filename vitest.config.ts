import path from "node:path";
import { defineConfig } from "vitest/config";

// Configuration Vitest — compatible Next.js App Router (ADR-05).
//
// Vitest tourne en dehors de Next : il ne connaît ni le tsconfig de Next,
// ni son environnement navigateur. Cette config recrée le strict nécessaire :
// l'alias "@/" et un DOM simulé pour les composants React.
export default defineConfig({
  resolve: {
    alias: {
      // Réplique le paths "@/*": ["./*"] de tsconfig.json — sans lui,
      // les imports type `import { genererPlanning } from "@/lib/generateur"`
      // échoueraient dans les tests.
      "@": path.resolve(__dirname, "."),
    },
  },

  // Note : Vitest 4 (rolldown/oxc) transforme le JSX en mode "automatic"
  // nativement — pas besoin de plugin React ni d'option esbuild pour
  // que les fichiers .tsx de test fonctionnent.

  test: {
    // jsdom simule le DOM du navigateur : indispensable pour
    // @testing-library/react (render, screen…). Les tests de logique pure
    // (lib/generateur, lib/courses) y tournent aussi sans surcoût notable.
    environment: "jsdom",

    // Emplacement des tests : à côté du code (*.test.ts) ou dans tests/.
    include: ["**/*.test.{ts,tsx}"],

    // Jamais de tests dans les artefacts de build ou les dépendances. integrations/ a ses
    // propres tests, sous node --test (#308).
    exclude: ["node_modules", ".next", "integrations/**"],

    // globals désactivé (défaut) : on importe describe/it/expect depuis
    // "vitest" explicitement — cohérent avec TypeScript strict, et pas
    // besoin de modifier le tsconfig ("types": ["vitest/globals"]).
    globals: false,
  },
});
