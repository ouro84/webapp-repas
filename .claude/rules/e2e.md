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
- **Port : 3000 par défaut ; `E2E_PORT=<port> npm run test:e2e:staging -- …` fait tourner l'e2e local à côté d'un serveur déjà sur 3000** (`next dev -p`, garde-fou du script sur ce port). `autoriser` (`e2e/oauth.ts`) réécrit alors le `Location` d'`/oauth/authorize` (localhost:3000, `site_url` de staging) vers ce port et attend que `/oauth/consent` soit servi (compilation à la demande). Tout `page.goto(urlAutorisation(…))` hors d'`autoriser` appelle d'abord `rabattreSiteUrl(page)` (no-op sur 3000). Pourquoi : ne jamais arrêter un serveur tiers ni toucher à `site_url`, partagé avec la CI.
- **`npm run test:e2e:staging` passe ses arguments à Playwright sans shell** (`scripts/commande-playwright.mjs` : `node` + CLI `@playwright/test`, résolu depuis le script, pas le cwd). Les motifs `-g` avec espaces, `|` et accents sont donc sûrs (`-g "desktop|320 px"`). Pourquoi : l'ancien `spawn("npx", { shell: true })` repassait par cmd.exe, qui coupait le motif. Couverture : `tests/commande-playwright.test.ts`.
- **Supprimer `.next` (et pas seulement `.next/dev`) avant tout `next start` local.** Pourquoi : un build fait pendant un e2e staging embarque les `NEXT_PUBLIC_*` de staging (le `.env.local` est alors swappé) ; un `next start` ultérieur servirait staging en croyant servir la prod.
- **Sous Windows, Playwright arrête `next dev` en fin de run et peut laisser `.next/dev` à moitié écrit** : `tsc` échoue alors sur `.next/dev/types/*.d.ts`, et le run suivant peut servir des 404 sur des pages existantes (`/oauth/consent`). Supprimer `.next/dev` (cache régénéré) avant de relancer `tsc` ou un e2e. Pourquoi : symptôme trompeur, il ressemble à un bug de route ou de typage.
- **Indicateur de dev Next masqué en e2e local** : le `webServer` pose `OMQ_E2E=1`, que `next.config.ts` traduit en `devIndicators: false`. Pourquoi : en `next dev`, l'indicateur (bas-gauche) recouvre l'onglet « Ce soir » de la barre du bas et intercepte les clics (`<nextjs-portal> … intercepts pointer events`) ; la CI (`next start`) n'en a pas.
- Config (`playwright.config.ts`) : viewport mobile 390×844 (la grille desktop est en `display:none`), `reporter: "list"` (le reporter `dot` rendait un blocage muet), `timeout: 60_000`, `expect.timeout: 10_000`, `retries: 2` en CI et `0` en local (pour voir les vrais échecs), `screenshot: "only-on-failure"`. En CI, `test-results/` est publié en artefact.

## Comptes de test et projets

- Projet **`e2e-partage`** : compte partagé, exécution en série (`workers: 1`). En CI, le compte est `claude-e2e-p1@example.com` (variable `E2E_EMAIL`) ; par défaut, `claude-e2e-test@example.com`. Signup idempotent dans `auth.setup.ts`, session réutilisée via `e2e/.auth/user.json`.
- Projet **`e2e-jetable`** (`SPECS_JETABLE` : onboarding, acquisition, foyer-clonage, foyer-rg29, rgpd-signup, suppression-compte, oauth-mcp, mcp-ecriture, panier-demande) : comptes à email unique par run, `--workers=4`. Ils s'accumulent sur staging (la clé anon ne peut pas supprimer un compte), sauf ceux de `suppression-compte.spec`, réellement supprimés.
- Un compte né d'un signup a `onboarding_complete = false` et serait redirigé vers `/bienvenue` : appeler `marquerOnboardingCompletDistant` après le signup (sauf `onboarding.spec`, qui teste justement le tunnel).
- Confirmation email désactivée sur staging, condition nécessaire à `auth.setup.ts`.

- **`oauth-mcp.spec`** (#305) et **`mcp-ecriture.spec`** (#306) jouent un assistant IA avec `e2e/oauth.ts` (DCR, PKCE, échange de code, appels JSON-RPC à `/api/mcp`, parcours `inscrire` / `connecter` / `autoriser`). Il exige OAuth Server activé sur staging et `site_url = http://localhost:3000` (cf. `mcp.md`) ; chaque test crée un client DCR, qui s'accumule sur staging comme les comptes jetables.
- **`panier-demande.spec`** (#308, dans `SPECS_JETABLE`) : un récepteur HTTP local joue l'exécuteur, enregistré par `enregistrerExecuteurPanier` avec son URL.
  - **Les outils de l'exécuteur s'appellent avec `appelerOutilMcp(request, jeton, nom, args, "/api/mcp/executeur")`** (5e argument `chemin`, défaut `/api/mcp`), et `listerOutilsMcp(request, jeton, chemin)` liste les outils d'un endpoint. Pourquoi : `prendre_demande_panier`, `cocher_article_demande` et `rapporter_panier` ne sont plus sur `/api/mcp` (#330) ; un appel sans chemin échoue en « outil inconnu ».
  - Le récepteur appelle **`closeAllConnections()` avant `close()`**. Pourquoi : le `fetch` de Next garde ses connexions ouvertes, `close()` seul attend leur expiration.
  - Toute écriture sur `demande_panier` / `executeur_panier` passe par un helper `service_role` (`vieillirDemandePanier`, `deplacerDemandePanier`, `supprimerDemandesPanier`, `enregistrerExecuteurPanier`, `supprimerExecuteurPanier` en `afterAll`). Pourquoi : les rôles client n'ont aucun droit d'écriture. `vieillirDemandePanier` recule `cree_le` ou `pris_le` depuis la valeur en base, pour simuler l'expiration (RG-83) sans attendre ; `deplacerDemandePanier` change l'ancre : il sert à poser la demande d'un autre cycle sans passer par un lancement, par exemple pour tester que `etat_panier(p_ancre)` la filtre. Un lancement sur un autre cycle passe par la route (`{ ancre }`), le bouton de la carte ou l'outil MCP `lancer_demande_panier`.
  - **Un cycle terminé ne se teste qu'avec un cycle PASSÉ généré par `generer_cycle({ ancre, remplacer: true })` (plage −12 semaines), puis atteint par `/courses?ancre=<date>` ; l'ancre du cycle affiché par défaut se lit dans `demande.ancre` d'une demande prise (`demandeTerminee`), et le cycle passé se prend à `cycleDecale(ancre, -2)`.** Pourquoi : la carte n'est montée que sur un cycle qui a une liste ; le week-end, le cycle affiché par défaut est déjà le suivant, donc « −1 » serait encore le cycle en cours ; la date du jour (Paris) décide de « terminé », pas un réglage qu'on pourrait poser. Le test vérifie aussi, par un compteur de requêtes, qu'un clic sur le bouton grisé n'appelle pas la route.
  - **Un test qui coche un article dans l'UI le décoche dans le même test, et se place en dernier du fichier.** Pourquoi : une coche restante change le libellé du bouton (« Compléter mon panier ») pour tous les tests suivants du compte.
  - **Une seule connexion par mot de passe et par compte** (`sessionDe`, jeton mis en cache), jamais un `jetonMotDePasse` par lecture. Pourquoi : l'Auth de staging limite les connexions ; avec 4 workers jetables en parallèle, la CI prenait des 429 jusque dans le `beforeAll` des relances.
  - **Relire une demande par son id, pas via `etat_panier().derniere`.** Pourquoi : vieillir `cree_le` change l'ordre du tri `cree_le desc`, la « dernière » n'est plus celle qu'on croit.
  - **Tests UI de la carte : chaque compte a un planning sur le cycle courant** (`generer_cycle` par MCP dans le `beforeAll`), et `ouvrirCourses` attend la liste chargée, la réception **complète** (`finished()`) de `rpc/etat_panier` (la seule lecture de la carte) et des lectures `foyers?select=jour_courses` (celles de la page, qui choisit le cycle avant de monter la carte), puis deux `requestAnimationFrame` ; présence et absence se lisent ensuite **sans poll** (`count()`), la présence chez A servant de témoin de la même séquence. Pourquoi : `waitForResponse` résout dès les en-têtes et `toHaveCount(0)` passe à son premier essai ; sans cette séquence, une carte montrée par erreur à un foyer sans exécuteur resterait verte (et sans liste, la carte n'est jamais montée).
  - **Captures de contrôle visuel hors CI** : `CAPTURES_PANIER=<dossier absolu hors du dépôt> npm run test:e2e:staging -- e2e/panier-demande.spec.ts -g captures` (320 et 390 px, clair et sombre, par `emulateMedia` puisque le thème par défaut suit le système ; vérifie aussi l'absence de débordement et un bouton sur une ligne). Sans la variable, le test est sauté ; un chemin relatif ou dans le dépôt est refusé. Pourquoi : des PNG dans `test-results/` seraient publiés en artefact CI, et le dossier n'a rien à faire dans le repo.
  - **Le test de captures crée son état et nettoie derrière lui** (`supprimerDemandesPanier` au début et en `finally`), sans dépendre de sa place dans le fichier. Pourquoi : l'état « disponible » exige un foyer sans demande, ce que l'ordre des tests ne garantit pas.

- **`prochain-repas.spec`** (#336) : le repas affiché par `/ce-soir` dépend de l'heure ; le test calcule le créneau avec `prochainRepasActif` / `repasActifSuivant` (réglages par défaut remis en `beforeEach`) et y écrit une recette du catalogue par `planifierRepasDistant(request, semaine, repas)` (nom exact → id uuid, RPC `sauvegarder_slots`). Pourquoi : une génération réelle laisse le créneau courant vide le week-end (elle vise la semaine suivante), le test ne vérifiait alors que l'état vide. En headless, le Wake Lock est refusé : le `console.warn` dans les logs est attendu.
- **`lien-cycle.spec`** (#320, RG-87) : compte partagé, lecture seule ; la vue préférée se pose par init script (`vue_planning`), gardé par un drapeau `sessionStorage` pour ne l'appliquer qu'une fois, et les dates attendues se calculent avec `datesCycle` (celles que le navigateur de période affiche, et non plus un « Courses du … ») sur le jour de courses lundi (`ancreParDefaut`, `cycleDecale`). Pourquoi : `addInitScript` rejoue à chaque chargement complet et écraserait la valeur lue après un `reload` ; le week-end décale le cycle par défaut, donc des dates figées casseraient.

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
| Longueur de cycle étirée (`cycle_courses`) | `nettoyerLongueursCycleDistantes` (et `definirLongueurCycleDistant(request, ancre, longueur)` pour tester un cycle ≠ 7 jours) |

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
- **`getByRole("alert")` seul matche aussi le route-announcer de Next** (toujours monté, `role="alert"`) : scoper à `page.locator("main")` ou cibler le texte exact. Une assertion « aucune alerte » (`toHaveCount(0)`) attend d'abord un marqueur de page chargée. Pourquoi : sans scope, `toHaveCount(0)` échoue toujours (1 trouvé) ; sans marqueur, il passe avant que la page ait rendu.
- **`getByLabel` matche par sous-chaîne** : `getByLabel("Mot de passe", { exact: true })`, car le bouton « Afficher le mot de passe » matcherait aussi.
- **`browser.newContext()` hérite du `storageState` du projet** (déjà connecté au compte partagé). Pour un contexte vierge : `browser.newContext({ storageState: { cookies: [], origins: [] } })`. Les specs « deux appareils, même compte » (`coches-realtime`, `alerte-planning`) passent `{ storageState: "e2e/.auth/user.json" }` exprès.
- Liens de nav : `getByRole("link", { name })` fonctionne aux deux paliers responsive (cf. `ui.md`) ; à 390 px, il trouve l'onglet du bas (`getByRole("navigation", { name: "Sections" })`). Un connecté qui fait `page.goto("/")` atterrit sur `/ce-soir` : la vitrine se teste en contexte déconnecté (`accueil.spec`).
- **Attendre qu'un abonnement temps réel soit prêt : écouter ses trames, pas `waitForTimeout`** (`abonnementRealtimePret`, `alerte-planning.spec`) : `page.on("websocket")` posé **avant** `goto`, message `system` `postgres_changes` « ok » sur le topic `realtime:planning:…`. Le sérialiseur 2.0.0 de realtime-js envoie des tableaux `[join_ref, ref, topic, event, payload]`, pas des objets. Pourquoi : une attente fixe est soit trop courte (event manqué, test instable), soit du temps perdu. Le helper (`abonnementRealtimePret(page, prefixe)`) prend `"planning:"` (semaine, `/planning`) ou `"planning-cycle:"` (cycle, `/courses`), rejette après 30 s avec un message qui nomme la trame attendue, ou aussitôt si la page se ferme avant le signal, et retire ses écouteurs. Pourquoi (fermeture) : sans rejet, la promesse restait en suspens et l'appelant n'échouait qu'au timeout du test, sans message.
- **Un test qui déclenche une génération réelle attend le TOAST de résultat avec un délai large, puis exige le succès** (`attendreCycleGenere`, `coherence-semaine-cycle.spec` : `/Cycle généré|Impossible de générer|Des modifications ne sont pas/` à 45 s, puis « Cycle généré »), jamais une attente de 20 s sur un élément de la liste. Quand la mise en place n'est pas le sujet du test, amorcer l'état en base (`planifierRepasDistant` sur le jour de `ancreParDefaut`). Après le toast, la vue relit encore le cycle : attendre qu'aucun `aria-busy` ne reste dans `main` (le bouton « Régénérer » le porte jusqu'au `finally` de la génération, relecture comprise) avant de lire la liste, et que le toast de la génération précédente ait disparu avant de relancer. Ne jamais attendre que la liste « change » : une régénération peut redonner la même liste. Pourquoi : un gel de staging de ~30 s faisait échouer l'attente de 20 s ; le toast précède la relecture du cycle, et un toast ancien passerait pour le résultat de la régénération (#357).
- **Un clic pendant une View Transition (liste de courses qui se réordonne après une coche) tombe sur le calque `::view-transition` et se perd** : cocher en boucle jusqu'à observer le nombre de coches attendu (`toPass`), puis lire libellés et compteurs dans un même `toPass`. Pourquoi : un clic perdu laisse la case cochée, et l'écho de la synchro peut afficher un instant l'ancien état.
