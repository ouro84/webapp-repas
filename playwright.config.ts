import { defineConfig } from "@playwright/test";

// Specs à comptes JETABLES (emails uniques par run, disjoints du compte de test
// partagé) → parallélisables sans course de données. Tout le reste écrit le
// compte partagé et reste sérialisé (cf. `workers` + projets ci-dessous).
const SPECS_JETABLE = /(onboarding|acquisition|foyer-clonage|foyer-rg29|rgpd-signup)\.spec\.ts$/;

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
  // Reporter `list` : nomme chaque test (début/fin) dans les logs CI — sans lui,
  // le reporter `dot` par défaut en CI rend un hang muet (impossible de savoir
  // quel test pend). `list` rend les blocages diagnosticables.
  reporter: "list",
  // Timeout PAR TEST (défaut Playwright 30 s, mais on l'explicite) : borne un
  // test qui pendrait, pour qu'il échoue (nommé) au lieu de laisser le job
  // courir jusqu'au mur des 15 min. Marge pour la latence backend distant.
  timeout: 60_000,
  // Défaut prudent : un seul worker. La plupart des specs écrivent dans le MÊME
  // compte de test partagé (planning/coches/réglages/recettes) → les paralléliser
  // les ferait se courir dessus. La CI relève ce plafond UNIQUEMENT pour le projet
  // « e2e-jetable » (specs à comptes jetables uniques, sûres en parallèle) via
  // `--project=e2e-jetable --workers=N` ; le projet « e2e-partage » reste à 1.
  // En local (un seul `playwright test`), on garde 1 → comportement inchangé.
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
    // Capture une image de l'écran au moment d'un échec → diagnostic CI lisible
    // (les traces .zip exigent un visualiseur ; une capture se lit directement).
    screenshot: "only-on-failure",
    // Viewport mobile (RG-06) — la liste verticale du planning est visible,
    // la grille desktop est masquée.
    viewport: { width: 390, height: 844 },
  },
  projects: [
    // Authentification unique avant tous les tests (connexion du compte partagé
    // → e2e/.auth/user.json).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Partition « compte partagé » : toutes les specs SAUF celles à comptes
    // jetables. Écrivent le même compte de test → exécutées en série (workers:1).
    {
      name: "e2e-partage",
      testMatch: /\.spec\.ts$/,
      testIgnore: SPECS_JETABLE,
      use: { storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    // Partition « comptes jetables » : chaque spec crée ses propres comptes
    // (emails uniques par run) → aucune collision, donc parallélisable en CI
    // (`--project=e2e-jetable --workers=N`). storageState fourni par cohérence
    // (ces specs ouvrent en réalité leurs propres contextes vierges).
    {
      name: "e2e-jetable",
      testMatch: SPECS_JETABLE,
      use: { storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // En CI : build de PROD + `next start` (pas de compilation à la demande ni de
    // runtime dev → e2e nettement plus rapides). En local : `next dev` pour garder
    // l'itération rapide (les e2e ne se lancent pas en local — .env.local = prod).
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // Marge pour le `next build` à froid en CI (compilation complète avant start).
    timeout: 180_000,
  },
});
