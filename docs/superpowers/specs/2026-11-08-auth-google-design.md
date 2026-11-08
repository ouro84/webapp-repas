# Connexion et inscription avec Google — design

Branche `feat/auth-google`. Décisions issues d'un grilling avec Arnaud le 2026-11-08.

## Intention

Réduire la friction d'inscription pour les bêta-testeurs et l'ouverture B2C (épopée #234) en proposant « Continuer avec Google » à côté du couple email + mot de passe existant. Supabase Auth gère le provider Google nativement (OAuth, flux PKCE) : l'essentiel du travail consiste à brancher ce flux sans casser les mécanismes existants (CGU, invitation au foyer, retour `suivant`, onboarding, ré-authentification avant suppression de compte).

## Objectifs

- Un utilisateur peut créer un compte ou se connecter avec Google depuis `/login` et `/signup`, en un clic.
- Un compte Google suit exactement le même parcours qu'un compte email : trigger `creer_foyer_et_profil` (foyer de 1), tunnel `/bienvenue`, invitation par deep-link, consentement MCP.
- Un compte Google sans mot de passe peut exercer son droit à l'effacement (RGPD, US-31).

## Non-objectifs

- Autres fournisseurs (Apple, Microsoft…) : issue #388.
- Photo Google comme avatar : issue #389 (contredit RG-35, « avatar zéro upload »).
- Custom domain Supabase (pour que Google n'affiche plus `gabyhlcwahzquolwxmgd.supabase.co`) : issue #391, milestone « Go public (B2C) ».
- « Définir un mot de passe » pour un compte Google : évolution possible, hors périmètre.
- Écran « Lier mon compte Google » dans `/profil` : la liaison automatique suffit.

## Anti-objectifs

- Un compte Google qui ne peut pas supprimer son compte.
- Un code OAuth `?code=` capté comme code d'invitation au foyer (collision de paramètre).
- Un open-redirect via le retour post-connexion.
- Une première impression ratée sur iPhone (PWA installée) pour un bêta-testeur.

## Contraintes et faits établis

- Trigger `creer_foyer_et_profil` (`supabase/migrations/20260611140000_foyers_profiles.sql`) : se déclenche sur tout `insert` dans `auth.users`, quel que soit le provider. Aucun changement SQL nécessaire pour la création de compte.
- Config Auth lue le 2026-11-08 via l'API de management :
  - prod (`gabyhlcwahzquolwxmgd`) : `site_url = https://webapp-repas.vercel.app/`, redirections autorisées `https://webapp-repas.vercel.app/**`, `http://localhost:3000/**`, `https://webapp-repas*.vercel.app/**`, confirmation email **activée** (`mailer_autoconfirm = false`, voulu), SMTP par défaut ;
  - staging (`upxoxrjumxpzumakawiv`) : `site_url = http://localhost:3000`, redirections autorisées `http://localhost:3000/**`, `https://webapp-repas*.vercel.app/**` (ajoutées le 2026-11-08), confirmation email désactivée.
  - La liaison automatique des identités est le comportement par défaut de Supabase (pour une adresse confirmée).
- Le proxy (`proxy.ts`) exempte `/auth/*` de la garde d'onboarding ; `urlPreservantCode` recopie `?code` dans ses redirections (invitation).
- `InvitationEnAttente` (monté dans le layout) appelle `capterCodeDepuisURL()`, qui lit `?code` sur les **pages** : le callback doit donc être un **route handler** (pas de layout rendu) et ne jamais rediriger vers une page en gardant le `code` OAuth.
- Le formulaire d'auth relit `?suivant=` via `cheminDeRetour` (`lib/redirection.ts`, anti open-redirect).
- `components/profil/supprimer-compte.tsx` et `changer-mot-de-passe.tsx` ré-authentifient par `signInWithPassword` ; la route `app/api/compte/supprimer/route.ts` ne vérifie aujourd'hui que la session.
- CSP en `Report-Only`, `form-action 'self'` : la redirection vers Google est une navigation JS (`window.location`), non concernée.
- Playwright ne peut pas piloter une vraie connexion Google.

## Décisions (prises avec Arnaud)

### Configuration (faite par Arnaud, guidée)

- **D1.** Un projet Google Cloud « On mange quoi ? » sur le **compte Google personnel** d'Arnaud (pas le Workspace isybuy). Écran de consentement « External », publié « In production » (scopes `openid`, `email`, `profile` : pas de vérification Google requise). Deux clients OAuth « Web application » : un pour la prod, un pour staging, chacun avec l'URI de redirection `https://<ref>.supabase.co/auth/v1/callback`.
- **D2.** Activation du provider Google **à la main dans le dashboard Supabase** (le secret ne transite pas par l'agent). Les URLs de redirection de staging (`http://localhost:3000/**`, `https://webapp-repas*.vercel.app/**`) sont ajoutées via l'API de management. Toute écriture sur la prod exige l'accord explicite d'Arnaud.
- **D3.** Le libellé « Continuer vers gabyhlcwahzquolwxmgd.supabase.co » est accepté pour la bêta (cf. non-objectifs).

### Parcours de connexion

- **D4.** Bouton « Continuer avec Google », **même libellé** en haut de `/login` et de `/signup`, séparateur « ou » au-dessus du formulaire email existant. Respect de la charte « Sign in with Google » (logo G officiel, couleurs imposées, variantes clair et sombre). Le bouton appelle `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })` avec `redirectTo = <origine>/auth/callback`, plus `?suivant=<valeur>` si la page courante en porte un.
- **D5.** Route handler `app/auth/callback/route.ts` :
  1. lit `code`, `error`, `error_description`, `suivant` ;
  2. si `error` (dont l'annulation `access_denied`) ou `code` absent : redirection vers `/login?erreur_oauth=annule|echec` (la clé est `annule` pour `access_denied`, `echec` sinon ; le bouton Google affiche le message français) ;
  3. sinon `exchangeCodeForSession(code)` avec le client serveur à cookies ; échec → même redirection d'erreur, erreur loggée ;
  4. succès → horodatage CGU (D7), puis redirection vers `cheminDeRetour(suivant)`, **sans** recopier `code`. Le proxy envoie ensuite un compte non onboardé vers `/bienvenue`.
- **D6.** Le code d'invitation au foyer (`/signup?code=…`) est déjà en `sessionStorage` avant le départ vers Google (capté par `InvitationEnAttente`) et survit à l'aller-retour dans le même onglet : aucun changement du mécanisme d'invitation.

### CGU (RG-92)

- **D7.** Mention passive sous le bouton Google, sur les deux pages : « En continuant, tu acceptes les CGU et la politique de confidentialité » (liens vers `/legal/*`). Au callback, si `profiles.cgu_version` est vide, horodatage `cgu_version = CGU_VERSION_ACTUELLE` et `cgu_acceptees_le = now()`, en best-effort (échec loggé, ne bloque pas la connexion). La case obligatoire du formulaire email de `/signup` est inchangée.

### Prénom (RG-94)

- **D8.** À l'étape 1 de `/bienvenue`, si `profiles.prenom` est vide, pré-remplir le champ avec `user_metadata.given_name`, sinon le premier mot de `user_metadata.full_name` ou `user_metadata.name`. Le champ reste modifiable ; rien n'est écrit tant que l'utilisateur ne valide pas l'étape. Logique d'extraction pure dans `lib/` (testée par Vitest).

### Suppression de compte et mot de passe (RG-93)

- **D9.** La route `POST /api/compte/supprimer` refuse (403, message français) si l'authentification **de la session courante** date de plus de **5 minutes**, pour **tous** les comptes. Signal : l'horodatage le plus récent du claim `amr` du JWT, lu côté serveur via `supabase.auth.getClaims()`. *Écart à l'implémentation :* si la lecture du claim échoue (erreur retournée ou exception du SDK), la route répond **500** (« Vérification de ta session impossible… »), pas 403 : une panne ne se présente pas comme une session ancienne. Un claim lu mais absent, illisible ou sans horodatage reste un 403. `signInWithPassword` comme une connexion Google ouvrent une nouvelle session avec un `amr` frais. *Choix de l'agent après relecture :* `user.last_sign_in_at` est écarté, car il est global à l'utilisateur (une connexion légitime sur un autre appareil validerait un cookie volé).
- **D10.** Méthode de ré-authentification selon les identités de l'utilisateur (`user.identities`) :
  - identité `email` présente (avec ou sans Google lié) : mot de passe, comme aujourd'hui ;
  - Google seul : bouton « Confirmer avec Google » → `signInWithOAuth` avec `queryParams: { prompt: "select_account" }` et retour sur `/profil?suppression=confirmer` (via `/auth/callback?suivant=…`). Au retour, la section « Supprimer mon compte » s'ouvre directement à l'étape de saisie de « SUPPRIMER », le contrôle de fraîcheur serveur faisant foi.
  - **Mauvais compte Google** : `signInWithOAuth` reçoit aussi `queryParams.login_hint = <email du compte>`. Avant le départ, l'identifiant utilisateur est mémorisé en `sessionStorage` ; au retour, s'il diffère de l'utilisateur connecté, la suppression est bloquée, le message « Tu t'es connecté avec un autre compte Google. Reconnecte-toi avec <email> pour supprimer ton compte. » s'affiche et une déconnexion locale suit. Un compte créé par erreur au passage reste en base (rare, supprimable par son titulaire).
  - Limite acceptée : Google n'impose pas la ressaisie du mot de passe ; si le navigateur est déjà connecté à Google, la ré-authentification se fait en un clic. Elle protège contre le vol du seul cookie OMQ, pas contre un appareil déverrouillé laissé sans surveillance.
- **D11.** Pour un compte sans identité `email`, la section « Changer le mot de passe » de `/profil` est masquée et remplacée par une mention « Connecté avec Google ».

### Comptes existants

- **D12.** Liaison automatique (comportement par défaut de Supabase) : un compte email dont l'adresse est confirmée qui se connecte avec Google sous la même adresse récupère l'identité Google. Pas d'écran de liaison manuelle.

### Collision `?code` existante (correctif embarqué)

- **D14.** Avec PKCE (défaut de `createBrowserClient`), le lien « mot de passe oublié » arrive probablement sur `/auth/reinitialiser?code=…`, une page où `capterCodeDepuisURL()` prendrait ce code pour une invitation au foyer. À vérifier d'abord (lien de reset reçu sur staging, ou lecture du flux supabase-js) ; si confirmé, `capterCodeDepuisURL()` ignore les chemins `/auth/*`, test unitaire à l'appui, commit dédié. Le commentaire de `app/auth/reinitialiser/page.tsx` (« fragment d'URL ») est corrigé au passage.

*Confirmé à l'implémentation :* la collision existait, `capterCodeDepuisURL()` ignore désormais `/auth/*` (commit dédié, test unitaire). Elle couvre aussi le retour OAuth `/auth/callback?code=…`.

### Fermeture de la RPC de suppression

- **D16.** *(Décidé par Arnaud le 2026-11-08.)* Le contrôle de fraîcheur de D9 est **aussi** posé dans `supprimer_mon_compte()` : la RPC est appelable directement par PostgREST par tout utilisateur connecté, et sans contrôle en base la purge des données contournait la route. Migration `20261108120000_suppression_compte_fraicheur.sql` : fonction `authentification_recente(p_max_s integer default 300)` (jumeau SQL de `authentificationRecente`, `lib/reauth.ts` ; aucun droit client) et refus `OMQ06` en première instruction de la RPC recréée. La route traduit `OMQ06` en 403, comme son propre contrôle. Le seuil de 300 s doit rester identique des deux côtés. Appliquée sur staging avant les e2e ; la prod la reçoit par la CI au push sur `main`.

### Mise en production

- **D15.** Provider Google activé sur staging **et** sur la prod le 2026-11-08, avant tout merge (vérifié par l'API de management : clients OAuth distincts, secret présent, contrôle de nonce actif, comptes sans email refusés). Pas de feature flag.

### Hors périmètre, notés à la relecture

- Un compte **neuf** arrivé par `/login?suivant=…` perd `suivant` en passant par `/bienvenue` (comportement identique au flux email aujourd'hui). La recette du retour vers le consentement MCP se fait avec un compte existant.
- CGU des inscriptions email en prod (confirmation activée, `signUp()` sans session) : rattrapage vérifié le 2026-11-08, aucun profil sans `cgu_version` (8/8). Pas d'action.

### iOS standalone

- **D13.** En PWA installée sur iOS (`navigator.standalone === true`), le retour de Google risque d'atterrir dans le contexte Safari, sans le cookie `code_verifier` PKCE : l'échange échoue. Aucun iPhone n'est disponible pour vérifier. Par précaution, le bouton Google est **masqué** dans ce seul cas, remplacé par l'indice « Pour te connecter avec Google, ouvre OMQ dans Safari ». Le formulaire email reste disponible. L'issue #390 demande de lever ce masquage après un test sur l'iPhone d'un bêta-testeur.

## Tests

- **Vitest** : extraction du prénom (D8), construction de `redirectTo` avec `suivant` (D4), traduction des erreurs OAuth en messages français (D5), décision de fraîcheur à 5 minutes à partir du claim `amr` (D9), choix de la méthode de ré-authentification selon les identités et détection du mauvais compte (D10), détection iOS standalone (D13), `capterCodeDepuisURL` qui ignore `/auth/*` (D14). Toute cette logique vit dans `lib/`.
- **E2E (staging)** : présence du bouton et de la mention CGU sur `/login` et `/signup` ; `/auth/callback?error=access_denied` renvoie sur `/login` avec le message ; refus de la suppression de compte si la connexion date de plus de 5 minutes (si un compte de test le permet sans attendre, sinon test unitaire de la route).
- **Recette manuelle sur staging** avec le compte Google d'Arnaud, avant la PR : inscription neuve (foyer créé, `/bienvenue` avec prénom pré-rempli, CGU horodatées), reconnexion, liaison avec un compte email existant, invitation par deep-link, retour `suivant` vers le consentement MCP, suppression d'un compte Google seul.

## Documentation (même PR)

- `SPECS_FONCTIONNELLES.md` : US-57 « Se connecter avec Google », RG-92 (CGU), RG-93 (fraîcheur 5 min), RG-94 (prénom). Revérifier le dernier numéro réel juste avant d'écrire (dernier constaté : RG-91, US-56).
- `ADR.md` : révision d'ADR-10 (fraîcheur serveur, limite de la ré-authentification Google, liaison automatique).
- `.claude/rules/foyer-compte.md` : connexion Google, callback, ré-authentification ; corriger la section « Dette pré-ouverture publique » (la confirmation email est **activée** en prod, désactivée sur staging).
- `CHANGELOG.md` : entrée `[Unreleased]`.
- Aide Notion : article « Se connecter avec Google » (slug `connexion-google`) à créer au statut **Brouillon**, à publier au merge puis `npm run pull:aide`. Pourquoi : le hook `prebuild` de Vercel tire tous les articles « Publié » à chaque déploiement, y compris ceux de `main` ; un article publié avant le merge apparaîtrait en prod avant la fonctionnalité. Les articles « Supprimer mon compte » et « Profil, avatar et mot de passe » demandent aussi une mise à jour au merge (mot de passe, Google).

## Laissé au builder

- Découpage en composants (bouton Google réutilisable pour #388), nommage, emplacement exact des fonctions pures dans `lib/`.
- Texte exact des messages d'erreur OAuth, tant qu'ils sont en français et actionnables.
- Rendu du logo G (SVG inline conforme à la charte).
