# Connexion et inscription avec Google — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** proposer « Continuer avec Google » sur `/login` et `/signup`, sans casser CGU, invitation, `suivant`, onboarding, ni le droit à l'effacement.

**Architecture :** le bouton appelle `signInWithOAuth` (PKCE) vers un route handler `app/auth/callback/route.ts` qui échange le code, horodate les CGU et redirige via `cheminDeRetour`. La logique pure (URL de retour, erreurs, prénom, fraîcheur `amr`, méthode de ré-authentification, détection PWA iOS) vit dans `lib/` et se teste sous Vitest. La suppression de compte gagne un contrôle de fraîcheur serveur sur le claim `amr` de la session.

**Tech Stack :** Next.js 16.4 (App Router, `proxy.ts`), `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.110 (`auth.getClaims()`), Tailwind v4, Vitest 4, Playwright 1.64.

**Spec :** `docs/superpowers/specs/2026-11-08-auth-google-design.md` (décisions D1→D15, citées ci-dessous).

## Global Constraints

- Tout en français : identifiants, commentaires, messages, UI. Commentaires citant `US-57`, `RG-92`, `RG-93`, `RG-94` et les `Dxx` du design quand utile.
- Texte JSX : apostrophe typographique `’` (la droite casse `react/no-unescaped-entities`).
- Couleurs : tokens maison (`bg-surface`, `bg-primary`, `text-brand-*`…), toute nouvelle couleur définie pour les deux thèmes dans `app/globals.css` (`:root` et `:root[data-theme="dark"]`). Icônes en SVG inline, jamais d'emoji.
- Le provider est déjà actif sur prod et staging (D15) : aucune config Supabase/Google à faire dans ce plan.
- Libellés figés : bouton « Continuer avec Google » ; mention « En continuant, tu acceptes les CGU et la politique de confidentialité » ; indice iOS « Pour te connecter avec Google, ouvre OMQ dans Safari » ; mention profil « Connecté avec Google » ; message mauvais compte « Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec {email} pour supprimer ton compte. »
- Fraîcheur : **300 secondes** (5 minutes).
- `npm run test:e2e` est interdit en local (pointe la prod) : e2e uniquement via `npm run test:e2e:staging -- <spec>`.
- Commits `type: description`, un par tâche, attribution `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Une seule PR à la fin.
- Après chaque tâche qui touche du code : `graphify update .` (si `graphify-out/` existe).
- Le worktree a son propre `node_modules` (`npm ci` fait le 2026-11-08 ; npm signale des scripts d'installation non approuvés). Si un binaire manque ou qu'un test échoue au chargement d'un paquet natif, vérifier `node_modules/<paquet>/package.json` et `npm install-scripts ls` avant de chercher un bug de code.

## Review Focus

1. **Code OAuth rejoué ou invalide** (bouton Retour du navigateur, lien callback rouvert) : `/auth/callback?code=bidon` doit renvoyer sur `/login` avec le message d'échec, jamais une 500. → e2e Tâche 3.
2. **`suivant` malveillant sur le callback** (`/auth/callback?code=bidon&suivant=//evil.com`) : la redirection reste sur l'origine de l'app. → test Vitest de `urlRetourOAuth` (Tâche 1) + e2e Tâche 3.
3. **Claim `amr` absent ou malformé** (jeton ancien, forme inattendue) : la suppression est **refusée** (403), pas acceptée par défaut. → tests de `authentificationRecente` (Tâche 5).
4. **Métadonnées Google vides** (`given_name` = `"  "`, `full_name` absent) : le prénom pré-rempli vaut `""`, le champ reste vide et le bouton désactivé comme aujourd'hui. → tests de `prenomDepuisMetadonnees` (Tâche 1).
5. **Ré-authentification avec un compte Google neuf** (le mauvais compte n'existe pas encore) : Supabase le crée, le proxy l'envoie sur `/bienvenue`, la vérification d'identifiant de `/profil` ne s'exécute pas. Aucune suppression n'a lieu : comportement accepté (design D10), à noter dans le commentaire de `SupprimerCompte` et dans `foyer-compte.md`. Pas de test.

---

### Task 1 : logique pure de la connexion Google

**Files :**
- Create : `lib/auth-google.ts`
- Test : `lib/auth-google.test.ts`

**Interfaces :**
- Consumes : `cheminDeRetour(brut: string | null): string` (`lib/redirection.ts`).
- Produces :
  - `CHEMIN_CALLBACK = "/auth/callback"`
  - `urlRetourOAuth(origine: string, suivant: string | null): string` — `${origine}/auth/callback`, plus `?suivant=<encodé>` seulement si `suivant` est non nul **et** que `cheminDeRetour(suivant) === suivant` (un chemin rejeté n'est pas transmis).
  - `type ErreurOAuth = "annule" | "echec"`
  - `erreurOAuthDepuisCallback(params: URLSearchParams): ErreurOAuth | null` — `error === "access_denied"` → `"annule"` ; autre `error` → `"echec"` ; pas de `error` et pas de `code` → `"echec"` ; sinon `null`.
  - `messageErreurOAuth(cle: string | null): string | null` — `"annule"` → « Connexion avec Google annulée. Tu peux réessayer ou utiliser ton email. » ; `"echec"` → « La connexion avec Google a échoué. Réessaie dans un instant ou utilise ton email. » ; autre/null → `null`.
  - `prenomDepuisMetadonnees(meta: Record<string, unknown> | null | undefined): string` — `given_name` (string non vide après trim), sinon premier mot de `full_name`, sinon de `name`, sinon `""`. Résultat trimé.
  - `estPwaIos(nav: { standalone?: unknown }): boolean` — `nav.standalone === true`.

- [ ] **Step 1 : écrire les tests qui échouent** (`lib/auth-google.test.ts`), dont :

```ts
expect(urlRetourOAuth("https://omq.test", null)).toBe("https://omq.test/auth/callback")
expect(urlRetourOAuth("https://omq.test", "/oauth/consent?authorization_id=a b"))
  .toBe("https://omq.test/auth/callback?suivant=%2Foauth%2Fconsent%3Fauthorization_id%3Da%2520b")
expect(urlRetourOAuth("https://omq.test", "//evil.com")).toBe("https://omq.test/auth/callback")
expect(urlRetourOAuth("https://omq.test", "/\t/evil.com")).toBe("https://omq.test/auth/callback")
expect(erreurOAuthDepuisCallback(new URLSearchParams("error=access_denied"))).toBe("annule")
expect(erreurOAuthDepuisCallback(new URLSearchParams("error=server_error&code=x"))).toBe("echec")
expect(erreurOAuthDepuisCallback(new URLSearchParams(""))).toBe("echec")
expect(erreurOAuthDepuisCallback(new URLSearchParams("code=abc"))).toBeNull()
expect(messageErreurOAuth("inconnu")).toBeNull()
expect(prenomDepuisMetadonnees({ given_name: "Arnaud", full_name: "Jean Dupont" })).toBe("Arnaud")
expect(prenomDepuisMetadonnees({ given_name: "  ", full_name: " Marie Curie " })).toBe("Marie")
expect(prenomDepuisMetadonnees({ name: "Léa" })).toBe("Léa")
expect(prenomDepuisMetadonnees({ given_name: 42 })).toBe("")
expect(prenomDepuisMetadonnees(undefined)).toBe("")
expect(estPwaIos({ standalone: true })).toBe(true)
expect(estPwaIos({})).toBe(false)
```

(L'encodage exact de `suivant` suit `URLSearchParams` ; ajuster l'attendu du 2e cas à `new URLSearchParams({ suivant }).toString()` si besoin, l'important est l'aller-retour : `new URL(resultat).searchParams.get("suivant")` redonne le chemin d'origine.)

- [ ] **Step 2 :** `npx vitest run lib/auth-google.test.ts` → FAIL (module absent).
- [ ] **Step 3 :** implémenter `lib/auth-google.ts` (aucune dépendance Supabase).
- [ ] **Step 4 :** `npx vitest run lib/auth-google.test.ts` → PASS.
- [ ] **Step 5 :** commit `feat: logique pure de la connexion Google (US-57)`.

---

### Task 2 : collision `?code` sur `/auth/*` (D14)

**Files :**
- Modify : `lib/invitation.ts` (`capterCodeDepuisURL`)
- Modify : `app/auth/reinitialiser/page.tsx` (commentaire d'en-tête)
- Test : `lib/invitation.test.ts` (créer s'il n'existe pas ; environnement jsdom comme les autres tests navigateur du repo)

**Interfaces :**
- Produces : `capterCodeDepuisURL()` inchangée en signature ; sur un chemin qui commence par `/auth/`, elle ne lit ni ne retire `?code` et renvoie `sessionStorage.getItem(CLE)`.

- [ ] **Step 1 : collision confirmée à la lecture du code** (2026-11-08) : `node_modules/@supabase/ssr/dist/main/createBrowserClient.js` force `flowType: "pkce"`, donc le lien de reset arrive en `/auth/reinitialiser?code=…`, et `capterCodeDepuisURL` le capte **et le retire de l'URL**. Rien à revérifier, passer au Step 2. La recette (Tâche 9) rejoue le reset de bout en bout.
- [ ] **Step 2 : tests qui échouent :**
  - `capterCodeDepuisURL` sur `/auth/reinitialiser?code=abc-123` → renvoie `null`, `sessionStorage` vide, `window.location.search` toujours `?code=abc-123` ;
  - non-régression : sur `/signup?code=abcd2345` → renvoie `"ABCD2345"`, stocké, URL nettoyée.
- [ ] **Step 3 :** `npx vitest run lib/invitation.test.ts` → FAIL sur le premier cas.
- [ ] **Step 4 :** garde `window.location.pathname.startsWith("/auth/")` en tête de la branche de capture ; corriger le commentaire de `app/auth/reinitialiser/page.tsx` (session de récupération établie à partir du `?code` PKCE, pas d'un fragment).
- [ ] **Step 5 :** `npx vitest run lib/invitation.test.ts` → PASS.
- [ ] **Step 6 :** commit `fix: le code PKCE de /auth/* n'est plus pris pour une invitation`.

---

### Task 3 : route de callback OAuth

**Files :**
- Create : `app/auth/callback/route.ts`
- Create : `lib/cgu-oauth.ts`
- Test : `lib/cgu-oauth.test.ts`
- Test : `e2e/auth-google.spec.ts` (projet `e2e-partage`, contexte vierge `storageState: { cookies: [], origins: [] }` comme `rgpd-signup.spec.ts`)

**Interfaces :**
- Consumes : `erreurOAuthDepuisCallback`, `cheminDeRetour`, `createClient` (`lib/supabase/server.ts`), `CGU_VERSION_ACTUELLE` (`lib/legal.ts`), `ClientSupabase` (`lib/supabase/types.ts`).
- Produces :
  - `GET` du route handler : erreur → `302 /login?erreur_oauth=<ErreurOAuth>` ; succès → `302 cheminDeRetour(suivant)`, sans `code` dans l'URL.
  - `horodaterCguSiAbsentes(client: ClientSupabase, userId: string): Promise<void>` — lit `profiles.cgu_version` du user ; si `null`, écrit `cgu_version = CGU_VERSION_ACTUELLE`, `cgu_acceptees_le = new Date().toISOString()`. Toute erreur est loggée (`console.error`) et avalée (best-effort, RG-92).

- [ ] **Step 1 : tests Vitest qui échouent** (`lib/cgu-oauth.test.ts`, client Supabase simulé) : `cgu_version` nulle → un `update` avec `cgu_version: 1` sur `user_id = id` ; `cgu_version` = 1 → aucun `update` ; erreur de lecture → aucune exception, `console.error` appelé.
- [ ] **Step 2 :** `npx vitest run lib/cgu-oauth.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter `lib/cgu-oauth.ts`, puis `app/auth/callback/route.ts` : lire `request.nextUrl.searchParams` ; `erreurOAuthDepuisCallback` ; sinon `exchangeCodeForSession(code)` (échec → `console.error` + redirection `echec`) ; puis `horodaterCguSiAbsentes(supabase, data.user.id)` ; redirection `NextResponse.redirect(new URL(cheminDeRetour(params.get("suivant")), request.url))`. Le chemin `/auth/callback` est déjà exempté de la garde d'onboarding par le proxy (`/auth/*`) : ne pas toucher `proxy.ts`.
- [ ] **Step 4 :** `npx vitest run lib/cgu-oauth.test.ts` → PASS.
- [ ] **Step 5 : e2e** dans `e2e/auth-google.spec.ts` :
  - `/auth/callback?error=access_denied` → URL `/login?erreur_oauth=annule` ;
  - `/auth/callback?code=bidon&suivant=//evil.com` → URL sur la même origine, chemin `/login`, `erreur_oauth=echec` (Review Focus 1 et 2).
  (Les assertions sur le message affiché viennent en Tâche 4.)
- [ ] **Step 6 :** `npm run test:e2e:staging -- e2e/auth-google.spec.ts` → PASS.
- [ ] **Step 7 :** commit `feat: route de callback OAuth avec horodatage des CGU (RG-92)`.

---

### Task 4 : bouton Google sur `/login` et `/signup`

**Files :**
- Create : `components/auth/connexion-google.tsx`
- Modify : `components/auth/formulaire-auth.tsx` (nouvelle prop `connexionGoogle?: boolean`, rendu entre le `h1` et le `<form>`)
- Modify : `app/login/page.tsx`, `app/signup/page.tsx` (passent `connexionGoogle`)
- Modify : `app/globals.css` (tokens du bouton Google, deux thèmes)
- Test : `components/auth/connexion-google.test.tsx`
- Test : `e2e/auth-google.spec.ts` (compléter)

**Interfaces :**
- Consumes : `urlRetourOAuth`, `messageErreurOAuth`, `estPwaIos` (Tâche 1), `createClient` (`lib/supabase/client.ts`).
- Produces : `ConnexionGoogle()` — composant client sans prop. Rend, dans l'ordre : le message d'erreur OAuth éventuel (`role="alert"`, lu depuis `?erreur_oauth=` via `useSearchParams`, donc enveloppé dans `<Suspense>` par `FormulaireAuth`), le bouton « Continuer avec Google » (ou, en PWA iOS, l'indice Safari à la place), la mention CGU avec liens `/legal/cgu` et `/legal/confidentialite`, puis un séparateur « ou ».

- [ ] **Step 1 : tests de composant qui échouent** (`connexion-google.test.tsx`, client Supabase simulé) :
  - clic sur « Continuer avec Google » → `signInWithOAuth` appelé avec `{ provider: "google", options: { redirectTo: "http://localhost:3000/auth/callback" } }` (origine jsdom) ; avec `?suivant=/oauth/consent` dans l'URL, `redirectTo` contient `suivant` ;
  - `?erreur_oauth=annule` → le texte « Connexion avec Google annulée » est affiché ;
  - `navigator.standalone = true` → pas de bouton, texte « Pour te connecter avec Google, ouvre OMQ dans Safari » ;
  - la mention CGU est présente avec deux liens.
- [ ] **Step 2 :** `npx vitest run components/auth/connexion-google.test.tsx` → FAIL.
- [ ] **Step 3 : implémenter `ConnexionGoogle`.**
  - Détection iOS : `useSyncExternalStore` (abonnement vide, snapshot client `estPwaIos(navigator)`, snapshot serveur `null`) ; tant que `null`, rendre le bouton (pas de scintillement sur les autres plateformes).
  - Charte « Sign in with Google » : logo G officiel multicolore en SVG inline (`aria-hidden`), libellé « Continuer avec Google », fond/bordure/texte du thème clair `#FFFFFF` / `#747775` / `#1F1F1F` et du thème sombre `#131314` / `#8E918F` / `#E3E3E3`, exposés en tokens `--color-google-fond`, `--color-google-bordure`, `--color-google-texte` dans `globals.css` (deux blocs). Forme pilule et pleine largeur comme le bouton de soumission voisin ; police Roboto Medium via `next/font/google` (poids 500, auto-hébergée, pas de changement de CSP).
  - Clic : état de chargement (`aria-busy`, bouton désactivé), `signInWithOAuth` avec `redirectTo = urlRetourOAuth(window.location.origin, new URLSearchParams(window.location.search).get("suivant"))` ; une erreur renvoyée → affichée avec `messageErreurOAuth("echec")` et loggée.
- [ ] **Step 4 :** `npx vitest run components/auth` → PASS (y compris `formulaire-auth.test.tsx` inchangé).
- [ ] **Step 5 : e2e** (compléter `e2e/auth-google.spec.ts`) :
  - `/login` et `/signup` : bouton « Continuer avec Google » et mention CGU visibles ;
  - `/login?erreur_oauth=annule` : texte « Connexion avec Google annulée » visible ;
  - clic sur le bouton avec `page.route("**/auth/v1/authorize**", …)` qui capture l'URL et répond `200` vide : l'URL contient `provider=google` et un `redirect_to` qui se termine par `/auth/callback`.
- [ ] **Step 6 :** `npm run test:e2e:staging -- e2e/auth-google.spec.ts e2e/rgpd-signup.spec.ts e2e/auth.spec.ts --retries=2` → PASS.
- [ ] **Step 7 :** vérification visuelle rapide en local (`npm run dev` contre staging via le script e2e, ou capture Playwright) des deux thèmes à 390 px : bouton lisible, séparateur aligné, aucun débordement.
- [ ] **Step 8 :** commit `feat: bouton « Continuer avec Google » sur la connexion et l’inscription (US-57)`.

---

### Task 5 : fraîcheur de session avant suppression (RG-93, D9)

**Files :**
- Create : `lib/reauth.ts`
- Test : `lib/reauth.test.ts`
- Modify : `app/api/compte/supprimer/route.ts`

**Interfaces :**
- Produces :
  - `FRAICHEUR_MAX_S = 300`
  - `authentificationRecente(amr: unknown, maintenantS: number): boolean` — `amr` doit être un tableau d'objets ; prend le plus grand `timestamp` numérique ; vrai si `maintenantS - max <= FRAICHEUR_MAX_S` ; tableau vide, non-tableau ou aucun timestamp numérique → `false`. Le type installé est `AMREntry[] | string[]` (`@supabase/auth-js`, `lib/types.d.ts`) : la forme `string[]` n'a pas d'horodatage et donne donc `false` (refus, fail-safe).
  - `aMotDePasse(identites: ReadonlyArray<{ provider: string }> | null | undefined): boolean` — vrai si une identité a `provider === "email"`.
  - `type MethodeReauth = "mot-de-passe" | "google"` ; `methodeReauth(identites): MethodeReauth` — `"mot-de-passe"` si `aMotDePasse`, sinon `"google"`.

- [ ] **Step 1 : tests qui échouent**, dont :

```ts
const t = 1_800_000_000
expect(authentificationRecente([{ method: "password", timestamp: t - 300 }], t)).toBe(true)
expect(authentificationRecente([{ method: "password", timestamp: t - 301 }], t)).toBe(false)
expect(authentificationRecente([{ method: "oauth", timestamp: t - 900 }, { method: "password", timestamp: t - 10 }], t)).toBe(true)
expect(authentificationRecente([], t)).toBe(false)
expect(authentificationRecente(undefined, t)).toBe(false)
expect(authentificationRecente([{ method: "password", timestamp: "x" }], t)).toBe(false)
expect(authentificationRecente(["password"], t)).toBe(false)
expect(methodeReauth([{ provider: "google" }])).toBe("google")
expect(methodeReauth([{ provider: "email" }, { provider: "google" }])).toBe("mot-de-passe")
expect(methodeReauth(undefined)).toBe("google")
```

- [ ] **Step 2 :** `npx vitest run lib/reauth.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter `lib/reauth.ts`, puis dans la route, juste après le contrôle de session et **avant** la RPC : `const { data: claims } = await supabase.auth.getClaims()` ; si `!authentificationRecente(claims?.claims?.amr, Math.floor(Date.now() / 1000))` → `apiError("POST /api/compte/supprimer", null, "Pour supprimer ton compte, confirme d’abord ton identité. La confirmation est valable 5 minutes.", 403)`. Vérifier la forme exacte du retour de `getClaims()` dans les types installés.
- [ ] **Step 4 :** `npx vitest run lib/reauth.test.ts` → PASS.
- [ ] **Step 5 :** `npm run test:e2e:staging -- e2e/suppression-compte.spec.ts --retries=2` → PASS (le parcours mot de passe ré-authentifie juste avant l'appel : session fraîche).
- [ ] **Step 6 :** commit `feat: la suppression de compte exige une authentification de moins de 5 minutes (RG-93)`.

---

### Task 6 : `/profil` pour un compte Google sans mot de passe (D10, D11)

**Files :**
- Modify : `components/profil/supprimer-compte.tsx`
- Modify : `components/profil/changer-mot-de-passe.tsx`
- Test : `components/profil/supprimer-compte.test.tsx`, `components/profil/changer-mot-de-passe.test.tsx` (créer)

**Interfaces :**
- Consumes : `methodeReauth`, `aMotDePasse` (Tâche 5), `urlRetourOAuth` (Tâche 1).
- Produces : clé `sessionStorage` `"reauth_suppression_uid"` ; paramètre d'URL `?suppression=confirmer`.

- [ ] **Step 1 : tests de composant qui échouent** (client Supabase simulé) :
  - `ChangerMotDePasse` avec identités `[{ provider: "google" }]` → pas de champ « Mot de passe actuel », texte « Connecté avec Google » ; avec `[{ provider: "email" }]` → formulaire inchangé ;
  - `SupprimerCompte`, compte Google seul, sans paramètre → bouton « Confirmer avec Google » ; clic → `sessionStorage["reauth_suppression_uid"] = <id>` puis `signInWithOAuth({ provider: "google", options: { redirectTo: <origine>/auth/callback?suivant=%2Fprofil%3Fsuppression%3Dconfirmer, queryParams: { prompt: "select_account", login_hint: <email> } } })` ;
  - retour `?suppression=confirmer` avec le même uid → champ « SUPPRIMER » affiché sans champ mot de passe, paramètre retiré de l'URL (`history.replaceState`) ; soumission → `POST /api/compte/supprimer` ;
  - retour avec un uid différent → message « Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec {email d’origine} pour supprimer ton compte. » (email d'origine mémorisé avec l'uid), `signOut({ scope: "local" })` appelé, aucune requête de suppression ;
  - compte avec identité `email` : parcours mot de passe inchangé.
- [ ] **Step 2 :** `npx vitest run components/profil` → FAIL.
- [ ] **Step 3 : implémenter.** Les identités viennent de `supabase.auth.getUser()` (déjà appelé par `SupprimerCompte`). Mémoriser `{ uid, email }` en JSON sous `"reauth_suppression_uid"`, l'effacer après lecture. Lecture du paramètre au montage via `window.location.search` dans l'effet, `setState` dans la promesse (règle `set-state-in-effect`). Mettre à jour le commentaire d'en-tête de `SupprimerCompte` : la protection réelle est désormais le contrôle de fraîcheur serveur (RG-93), et le cas « compte Google neuf choisi par erreur » finit sur `/bienvenue` sans suppression (Review Focus 5). Un 403 de la route s'affiche tel quel (`corps.error`).
- [ ] **Step 4 :** `npx vitest run components/profil` → PASS.
- [ ] **Step 5 :** `npm run test:e2e:staging -- e2e/profil.spec.ts e2e/suppression-compte.spec.ts --retries=2` → PASS.
- [ ] **Step 6 :** commit `feat: ré-authentification Google avant suppression et profil sans mot de passe (D10, D11)`.

---

### Task 7 : prénom pré-rempli dans `/bienvenue` (RG-94, D8)

**Files :**
- Modify : `app/bienvenue/page.tsx` (effet de pré-remplissage, vers la ligne 90)
- Test : couvert par `lib/auth-google.test.ts` (Tâche 1) ; pas de nouveau test de page.

**Interfaces :**
- Consumes : `prenomDepuisMetadonnees` (Tâche 1).

- [ ] **Step 1 :** remplacer `if (profil?.prenom) setPrenom(profil.prenom)` par un pré-remplissage `profil?.prenom || prenomDepuisMetadonnees(data.user?.user_metadata)` (seulement si la valeur est non vide). Rien n'est écrit en base avant la validation de l'étape.
- [ ] **Step 2 :** `npm run test:run` → PASS ; `npm run test:e2e:staging -- e2e/onboarding.spec.ts --retries=2` → PASS (un compte email n'a pas de métadonnées : champ vide comme avant).
- [ ] **Step 3 :** commit `feat: prénom pré-rempli depuis Google dans l’onboarding (RG-94)`.

---

### Task 8 : documentation

**Files :**
- Modify : `SPECS_FONCTIONNELLES.md`, `ADR.md`, `.claude/rules/foyer-compte.md`, `CHANGELOG.md`, `lib/messages-auth.ts` (commentaire `MESSAGE_INSCRIPTION_NEUTRE` qui dit la confirmation désactivée)
- Notion (base « Guide OMQ ») puis `content/aide/**` via `npm run pull:aide`

- [ ] **Step 1 :** `grep -oE "RG-[0-9]+" SPECS_FONCTIONNELLES.md | sort -t- -k2 -n | tail -1` et idem pour `US-` : confirmer que RG-91 et US-56 sont les derniers. Sinon décaler les numéros partout (plan, design, commentaires de code).
- [ ] **Step 2 :** `SPECS_FONCTIONNELLES.md` : US-57 « Se connecter avec Google » après US-56 (scénarios : inscription neuve, connexion, liaison même adresse, annulation, invitation par lien, PWA iOS) ; RG-92 (CGU : mention + horodatage au callback si vide), RG-93 (authentification de la session < 5 min avant suppression, pour tous ; méthode selon les identités ; mauvais compte), RG-94 (prénom pré-rempli) après RG-91.
- [ ] **Step 3 :** `ADR.md` : bloc `[RÉVISION - ADR-10 — 2026-11-08]` : fraîcheur serveur sur `amr` (et pourquoi pas `last_sign_in_at`), limite de la ré-authentification Google (session Google active suffit), liaison automatique des identités, callback en route handler (collision `?code`).
- [ ] **Step 4 :** `.claude/rules/foyer-compte.md` : ajouter « Connexion Google » (callback, `?code` réservé à `/auth/*`, mention CGU, `ConnexionGoogle`, iOS standalone #390), remplacer dans « Suppression de compte » la phrase « la protection réelle est la ré-authentification par mot de passe » par le contrôle `amr` (RG-93) ; corriger « Dette pré-ouverture publique » : confirmation email **activée en prod**, désactivée sur staging (e2e) ; ajouter `lib/auth-google*.ts`, `lib/reauth*.ts`, `lib/cgu-oauth*.ts` aux `paths:`. Corriger le commentaire de `lib/messages-auth.ts` dans le même sens.
- [ ] **Step 5 :** `CHANGELOG.md`, `[Unreleased]` → `### Ajouté` : « Connexion et inscription avec un compte Google… » (ton utilisateur, comme les entrées voisines) ; `### Corrigé` si la Tâche 2 a confirmé la collision.
- [ ] **Step 6 :** article Notion « Se connecter avec Google » via l'API REST (`NOTION_TOKEN`, cf. `.claude/rules/aide-notion.md`) : comment se connecter, que faire sur iPhone avec l'app installée, comment supprimer son compte avec Google. Puis `npm run pull:aide` et vérifier le diff de `content/aide`.
- [ ] **Step 7 :** commit `docs: connexion Google (US-57, RG-92 à RG-94, ADR-10)`.

---

### Task 9 : vérification finale, recette et PR

- [ ] **Step 1 :** `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, `npm run build` → tous verts.
- [ ] **Step 2 :** `npm run test:e2e:staging -- e2e/auth-google.spec.ts e2e/auth.spec.ts e2e/rgpd-signup.spec.ts e2e/acquisition.spec.ts e2e/onboarding.spec.ts e2e/profil.spec.ts e2e/suppression-compte.spec.ts e2e/oauth-mcp.spec.ts --retries=2` → PASS. Un échec sans lien avec la PR : appliquer la règle « flaky préexistant » (prouver par `--repeat-each`, timebox ≈ 1 h).
- [ ] **Step 3 : recette manuelle sur staging avec Arnaud** (son compte Google, `localhost:3000` via le script staging) : inscription neuve (foyer créé, `/bienvenue`, prénom pré-rempli, `cgu_version` = 1 en base) ; déconnexion puis reconnexion ; liaison avec un compte email existant de même adresse ; invitation `/signup?code=…` puis Google → aperçu « Tu rejoins le foyer de… » ; `suivant` vers le consentement MCP avec un compte existant ; suppression d'un compte Google seul (y compris tentative avec un autre compte) ; mot de passe oublié de bout en bout (Tâche 2).
- [ ] **Step 4 :** `graphify update .` ; push de `feat/auth-google` ; PR (corps via `mattpocock-skills:pr`) qui mentionne : config Google/Supabase déjà faite (D15), issues #388 à #391, recette faite, absence de test iPhone (#390). Attendre la CI verte (`gh pr checks <n> --watch`) avant tout merge, merge sur décision d'Arnaud.
