// Setup d'authentification — exécuté une fois avant tous les tests e2e.
//
// 1. S'assure que le compte de test existe côté Supabase (signup idempotent :
//    l'erreur "déjà inscrit" est ignorée). La confirmation email est
//    désactivée en dev (cf. note ADR-02), le compte est utilisable aussitôt.
// 2. Se connecte via la vraie page /login (parcours utilisateur réel).
// 3. Sauvegarde cookies + localStorage dans e2e/.auth/user.json,
//    réutilisés par tous les tests (storageState du projet "chromium").

import { readFileSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "claude-e2e-test@example.com";
const MOT_DE_PASSE = process.env.E2E_PASSWORD ?? "E2E-Test-Claude-2026!";

// Lit une variable dans .env.local (Playwright ne charge pas les env Next).
function lireEnvLocal(cle: string): string {
  const ligne = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));
  if (!ligne) throw new Error(`${cle} introuvable dans .env.local`);
  return ligne.slice(cle.length + 1).trim().replace(/^"|"$/g, "");
}

setup("authentification du compte de test", async ({ page, request }) => {
  const urlSupabase = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const cleAnon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // Création idempotente du compte de test.
  const reponse = await request.post(`${urlSupabase}/auth/v1/signup`, {
    headers: { apikey: cleAnon, "Content-Type": "application/json" },
    data: { email: EMAIL, password: MOT_DE_PASSE },
  });
  // 200 = créé (ou session renvoyée) ; 400/422 = existe déjà — tout est bon.
  if (![200, 400, 422].includes(reponse.status())) {
    throw new Error(
      `Signup du compte de test impossible : HTTP ${reponse.status()} — ${await reponse.text()}`
    );
  }

  // Connexion par le parcours réel.
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  // exact : le bouton œil (aria-label « Afficher le mot de passe ») contient
  // aussi « mot de passe » — sans exact, le locator serait ambigu (#60).
  await page.getByLabel("Mot de passe", { exact: true }).fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // La redirection post-login prouve que le middleware valide la session.
  await page.waitForURL("**/planning");
  await expect(page.getByRole("heading", { name: "Mon planning de la semaine" })).toBeVisible();

  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
