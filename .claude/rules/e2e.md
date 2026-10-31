---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "scripts/e2e-staging.mjs"
---

# Tests e2e (Playwright)

## Où tournent les e2e

- Ils tapent une **vraie instance Supabase** : staging en CI et via `npm run test:e2e:staging` en local. `npm run test:e2e` brut taperait la prod (`.env.local`).
- **Playwright lit `.env.local` directement** (`readFileSync` dans `e2e/auth.setup.ts`), pas `process.env`. En CI, le workflow génère ce fichier depuis les secrets `STAGING_*` ; `scripts/e2e-staging.mjs` le swappe en local.
- Le catalogue global n'est seedé que là où les migrations ont tourné : les parcours à **génération réelle** n'ont de sens que contre staging.
- Config (`playwright.config.ts`) : viewport mobile 390×844 (la grille desktop est en `display:none`), `reporter: "list"` (le reporter `dot` rendait un blocage muet), `timeout: 60_000`, `expect.timeout: 10_000`, `retries: 2` en CI et `0` en local (pour voir les vrais échecs), `screenshot: "only-on-failure"`. En CI, `test-results/` est publié en artefact.

## Comptes de test et projets

- Projet **`e2e-partage`** : compte partagé, exécution en série (`workers: 1`). En CI, le compte est `claude-e2e-p1@example.com` (variable `E2E_EMAIL`) ; par défaut, `claude-e2e-test@example.com`. Signup idempotent dans `auth.setup.ts`, session réutilisée via `e2e/.auth/user.json`.
- Projet **`e2e-jetable`** (`SPECS_JETABLE` : onboarding, acquisition, foyer-clonage, foyer-rg29, rgpd-signup, suppression-compte, oauth-mcp, mcp-ecriture, panier-demande) : comptes à email unique par run, `--workers=4`. Ils s'accumulent sur staging (la clé anon ne peut pas supprimer un compte), sauf ceux de `suppression-compte.spec`, réellement supprimés.
- Un compte né d'un signup a `onboarding_complete = false` et serait redirigé vers `/bienvenue` : appeler `marquerOnboardingCompletDistant` après le signup (sauf `onboarding.spec`, qui teste justement le tunnel).
- Confirmation email désactivée sur staging, condition nécessaire à `auth.setup.ts`.

- **`oauth-mcp.spec`** (#305) et **`mcp-ecriture.spec`** (#306) jouent un assistant IA avec `e2e/oauth.ts` (DCR, PKCE, échange de code, appels JSON-RPC à `/api/mcp`, parcours `inscrire` / `connecter` / `autoriser`). Il exige OAuth Server activé sur staging et `site_url = http://localhost:3000` (cf. `mcp.md`) ; chaque test crée un client DCR, qui s'accumule sur staging comme les comptes jetables.
- **`panier-demande.spec`** (#308, dans `SPECS_JETABLE`) : un récepteur HTTP local joue l'exécuteur, enregistré par `enregistrerExecuteurPanier` avec son URL.
  - Le récepteur appelle **`closeAllConnections()` avant `close()`**. Pourquoi : le `fetch` de Next garde ses connexions ouvertes, `close()` seul attend leur expiration.
  - Toute écriture sur `demande_panier` / `executeur_panier` passe par un helper `service_role` (`vieillirDemandePanier`, `deplacerDemandePanier`, `supprimerDemandesPanier`, `enregistrerExecuteurPanier`, `supprimerExecuteurPanier` en `afterAll`). Pourquoi : les rôles client n'ont aucun droit d'écriture. `vieillirDemandePanier` recule `cree_le` ou `pris_le` depuis la valeur en base, pour simuler l'expiration (RG-83) sans attendre ; `deplacerDemandePanier` change l'ancre, seul moyen d'avoir la demande d'un autre cycle (la route vise toujours le cycle courant).
  - **Une seule connexion par mot de passe et par compte** (`sessionDe`, jeton mis en cache), jamais un `jetonMotDePasse` par lecture. Pourquoi : l'Auth de staging limite les connexions ; avec 4 workers jetables en parallèle, la CI prenait des 429 jusque dans le `beforeAll` des relances.
  - **Relire une demande par son id, pas via `etat_panier().derniere`.** Pourquoi : vieillir `cree_le` change l'ordre du tri `cree_le desc`, la « dernière » n'est plus celle qu'on croit.
  - **Tests UI de la carte : chaque compte a un planning sur le cycle courant** (`generer_cycle` par MCP dans le `beforeAll`), et `ouvrirCourses` attend la liste chargée, la réception **complète** (`finished()`) des deux lectures de la carte (`rpc/etat_panier` et `foyers?select=jour_courses`), puis deux `requestAnimationFrame` ; présence et absence se lisent ensuite **sans poll** (`count()`), la présence chez A servant de témoin de la même séquence. Pourquoi : `waitForResponse` résout dès les en-têtes et `toHaveCount(0)` passe à son premier essai ; sans cette séquence, une carte montrée par erreur à un foyer sans exécuteur resterait verte (et sans liste, la carte n'est jamais montée).
  - **Captures de contrôle visuel hors CI** : `CAPTURES_PANIER=<dossier absolu hors du dépôt> npm run test:e2e:staging -- e2e/panier-demande.spec.ts -g captures` (320 et 390 px, clair et sombre, par `emulateMedia` puisque le thème par défaut suit le système ; vérifie aussi l'absence de débordement et un bouton sur une ligne). Sans la variable, le test est sauté ; un chemin relatif ou dans le dépôt est refusé. Pourquoi : des PNG dans `test-results/` seraient publiés en artefact CI, et le dossier n'a rien à faire dans le repo.
  - **Le test de captures crée son état et nettoie derrière lui** (`supprimerDemandesPanier` au début et en `finally`), sans dépendre de sa place dans le fichier. Pourquoi : l'état « disponible » exige un foyer sans demande, ce que l'ordre des tests ne garantit pas.

## Le compte partagé : chaque spec restaure ce qu'elle touche

Un état résiduel fausse les specs suivantes du même job. Nettoyer en `beforeEach` et/ou `afterAll` avec les helpers de `e2e/helpers.ts` :

| Ce que la spec modifie | Helper |
|------------------------|--------|
| Planning, coches | `nettoyerEtatDistant` |
| Réglages de génération | `nettoyerReglagesDistants` |
| Recettes masquées | `nettoyerMasquagesDistants` |
| Favoris / évités | `nettoyerPreferencesDistantes` |
| Jour de courses (réglage foyer) | `reinitialiserJourCoursesDistant` (ou `definirJourCoursesDistant(request, jour)` pour tester un jour ≠ lundi) |
| Prénom / couleur d'avatar | `reinitialiserProfilDistant` |

Les helpers filtrent `foyer_id=not.is.null`. Les recettes créées par `recettes.spec` portent un suffixe `Date.now()` et sont supprimées en `afterAll`.

**Actions réservées aux comptes jetables** (elles casseraient le compte partagé pour la suite) :
- se déconnecter : `signOut` révoque le refresh token commun à tous les contextes. Le test de déconnexion ouvre un contexte vierge et une connexion fraîche ;
- changer le mot de passe (casserait `auth.setup`). `profil.spec` ne teste que les gardes ;
- rejoindre ou quitter un foyer (change `foyer_id`, le catalogue disparaît). Ces parcours vivent dans `foyer-clonage.spec`.

## Préparer l'état de `/courses`

- `/courses` projette depuis la base. Pour préparer un état, injecter **`cycle_planning` + `cycle_affiche`** en localStorage, clés sur **`ancreParDefaut(new Date(), jourCourses)`** (pas `ancreCourante`, pas la semaine ISO, sinon l'injection ne matche plus le week-end).
- Un planning de **fixtures** (id = slug, pas UUID) ne peut pas être persisté (`sauvegarder_planning` → « invalid input syntax for type uuid »). Un test d'édition qui vérifie `/courses` injecte donc `cycle_planning` directement à l'état voulu (personnes portées par `JourPlanning.personnes`).
- Après une génération réelle, **attendre la persistance** avant de naviguer vers `/courses` : `expect.poll` sur `planning_dirty` → `null`.
- Changer le mécanisme de `/courses` = auditer **toutes** les specs qui y naviguent ou injectent son état (cf. règle « audit par invariant » de `CLAUDE.md`).

## Pièges Playwright

- **Attendre l'état attendu avant de lire** (`await expect(locator).toHaveCount(…)` / `toBeVisible()` avant `innerText`), car le backend distant ajoute de la latence. Un test différent qui tombe à chaque run (~1/44) relève de cette latence, pas d'un bug produit.
- **`addInitScript` rejoue à chaque chargement complet** : dans les specs qui purgent un état par init script, naviguer par les liens de l'app (navigation SPA) plutôt que par `page.goto()`.
- **`getByLabel` matche par sous-chaîne** : `getByLabel("Mot de passe", { exact: true })`, car le bouton « Afficher le mot de passe » matcherait aussi.
- **`browser.newContext()` hérite du `storageState` du projet** (déjà connecté au compte partagé). Pour un contexte vierge : `browser.newContext({ storageState: { cookies: [], origins: [] } })`. Les specs « deux appareils, même compte » (`coches-realtime`, `alerte-planning`) passent `{ storageState: "e2e/.auth/user.json" }` exprès.
- **Actions de slot repliées** : cliquer d'abord le toggle « Plus d'actions pour le X » avant « Changer le… » / « Sélectionner le… » / « Marquer le… en restes ».
- Liens de nav : `getByRole("link", { name })` fonctionne aux deux paliers responsive (cf. `ui.md`).
