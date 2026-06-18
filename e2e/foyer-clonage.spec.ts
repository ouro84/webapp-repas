// Parcours #56 PR6 — offboarding : clonage des données à la sortie (RG-34, US-19).
//
// Contrairement à foyer.spec (qui n'ose PAS de jonction/sortie réelle sur le
// compte de test PARTAGÉ — ça changerait son foyer_id et casserait les autres
// specs), ce parcours fait une VRAIE jonction puis sortie. Il crée donc DEUX
// comptes JETABLES dédiés (emails uniques par run), totalement disjoints du
// compte de test partagé → aucun effet de bord sur les autres specs.
//
// ⚠️ Les comptes jetables ne sont PAS supprimés en teardown : la clé anon ne
// permet pas de détruire un compte (il faudrait la service_role). Ils
// s'accumulent donc sur staging — acceptable et assumé (foyers isolés, sans
// impact sur les autres tests). Validation en CI uniquement : repose sur la
// génération (catalogue global seedé sur staging) et le temps réel ; NE PAS
// lancer en local (.env.local pointe la prod).
//
// Scénario (RG-34) : X génère un planning et invite ; Y rejoint le foyer de X
// (il y voit le planning partagé) ; Y QUITTE → il doit repartir avec une COPIE
// (planning + liste de courses non vides), tandis que X CONSERVE tout
// (pérennité), les deux foyers devenant indépendants.

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  E2E_PASSWORD,
  lireEnvLocal,
  marquerOnboardingCompletDistant,
} from "./helpers";

// 8 caractères de l'alphabet de generer_code_invitation (sans I/O/0/1).
const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;
// Identifiant de run : emails de comptes jetables uniques (évite les collisions
// entre exécutions et les rejeux de retry).
const RUN = Date.now();

// Crée le compte côté Supabase (signup REST idempotent, confirmation email
// désactivée → utilisable aussitôt, cf. auth.setup).
async function inscrire(
  request: APIRequestContext,
  email: string
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  // Onboarding terminé (#22 PR2) : sinon le login serait redirigé vers /bienvenue
  // (compte neuf → onboarding_complete false par défaut) et `connecter` (qui
  // attend /planning) échouerait.
  await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

// Connecte le compte dans un contexte neuf (un « appareil ») via la vraie page
// /login, et renvoie la page authentifiée (sur /planning).
async function connecter(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/planning");
  return page;
}

test("quitter un foyer partagé clone les données chez le partant, sans rien retirer aux autres (RG-34)", async ({
  browser,
  request,
}) => {
  // Parcours long (2 inscriptions + 2 connexions + génération + jonction +
  // sortie + navigations) : le défaut de 30 s ne suffit pas avec la latence
  // staging.
  test.setTimeout(120_000);
  const emailX = `clone-x-${RUN}@example.com`;
  const emailY = `clone-y-${RUN}@example.com`;
  await inscrire(request, emailX);
  await inscrire(request, emailY);

  // storageState VIDE explicite : sinon browser.newContext() HÉRITE du
  // `use.storageState` du projet (= compte de test partagé), et goto('/login')
  // serait redirigé vers /planning (déjà connecté) → pas de champ Email. On veut
  // deux contextes VIERGES, qu'on connecte ensuite à leurs comptes jetables.
  const vierge = { storageState: { cookies: [], origins: [] } };
  const ctxX = await browser.newContext(vierge);
  const ctxY = await browser.newContext(vierge);

  // --- X : génère un planning (données du foyer), puis invite ---
  const x = await connecter(ctxX, emailX);
  await x.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(x.locator("main ul > li")).toHaveCount(7);
  // Attendre la persistance du planning avant que Y le rejoigne/clone.
  await expect
    .poll(async () => x.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await x.goto("/profil");
  const inviter = x.getByRole("button", { name: "Inviter quelqu’un" });
  await expect(inviter).toBeVisible();
  await inviter.click();
  await expect(x.getByText(CODE_RX)).toBeVisible();
  const code = (await x.getByText(CODE_RX).innerText()).trim();
  expect(code).toMatch(CODE_RX);

  // --- Y : rejoint le foyer de X ---
  const y = await connecter(ctxY, emailY);
  await y.goto("/profil");
  await y.getByLabel("Rejoindre un foyer").fill(code);
  await y.getByRole("button", { name: "Rejoindre" }).click();
  // Jonction → reload ; le panneau passe en mode partagé (bouton « Quitter »).
  await expect(y.getByRole("button", { name: "Quitter le foyer" })).toBeVisible();
  // Y voit bien le planning PARTAGÉ de X (foyer commun).
  await y.goto("/planning");
  await expect(y.locator("main ul > li")).toHaveCount(7);

  // --- Y : quitte → clonage (RG-34) ---
  await y.goto("/profil");
  await y.getByRole("button", { name: "Quitter le foyer" }).click();
  // Bouton de confirmation de la modale (exact : « Quitter le foyer » le contient).
  await y.getByRole("button", { name: "Quitter", exact: true }).click();
  // Sortie → reload ; retour en solo (le champ « Rejoindre » réapparaît, plus de « Quitter »).
  await expect(y.getByLabel("Rejoindre un foyer")).toBeVisible();
  await expect(y.getByRole("button", { name: "Quitter le foyer" })).toHaveCount(0);

  // CŒUR RG-34 : Y repart AVEC une copie — son planning n'est pas vide…
  await y.goto("/planning");
  await expect(y.locator("main ul > li")).toHaveCount(7);
  // …et sa liste de courses (dérivée du planning cloné) non plus.
  await y.goto("/courses");
  await expect(y.getByText(/^\d+ cochés? sur [1-9]\d*/)).toBeVisible();

  // PÉRENNITÉ : X conserve son planning (rien ne lui a été retiré à la sortie de Y).
  await x.goto("/planning");
  await expect(x.locator("main ul > li")).toHaveCount(7);

  await ctxX.close();
  await ctxY.close();
});
