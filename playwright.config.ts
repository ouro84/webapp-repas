import { defineConfig } from "@playwright/test";

// Configuration Playwright — tests e2e des parcours critiques (ADR-05).
//
// Particularités du projet :
// - /planning et /courses sont protégées par le proxy Supabase (ex-middleware) :
//   un projet "setup" s'authentifie une fois et sauvegarde la session
//   (e2e/.auth/user.json), réutilisée par tous les tests.
// - Chromium uniquement : suffisant pour un MVP à usage personnel.
// - Mobile-first : les tests tournent en viewport mobile (l'app est conçue
//   pour ça, RG-06) — la vue desktop reste en display:none.
export default defineConfig({
  testDir: "./e2e",
  // Un seul worker : les tests partagent le même serveur dev et manipulent
  // le localStorage — la sérialisation évite tout aléa.
  workers: 1,
  // Les e2e tapent une vraie instance Supabase (staging en CI) : la latence
  // réseau peut faire dépasser ponctuellement un timeout (lecture après
  // écriture, rendu après génération). En CI, on réessaie les tests
  // transitoirement rouges (chaque test repart d'un état propre en beforeEach,
  // donc le rejeu est sûr) ; en local, pas de retry pour voir les vrais échecs.
  retries: process.env.CI ? 2 : 0,
  // Marge sur les assertions pour absorber la latence du backend distant
  // (défaut 5 s → 10 s) ; les vrais bugs échouent toujours, juste un peu plus tard.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    // L'antivirus du poste de dev (Avast) intercepte le TLS : les requêtes
    // API du setup d'auth passeraient par sa CA non reconnue de Node.
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    // Viewport mobile (RG-06) — la liste verticale du planning est visible,
    // la grille desktop est masquée.
    viewport: { width: 390, height: 844 },
  },
  projects: [
    // Authentification unique avant tous les tests.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Lance le serveur dev si aucun ne tourne déjà sur le port 3000.
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
