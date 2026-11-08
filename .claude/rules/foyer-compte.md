---
paths:
  - "app/profil/**"
  - "app/bienvenue/**"
  - "app/signup/**"
  - "app/login/**"
  - "app/auth/**"
  - "app/mot-de-passe-oublie/**"
  - "app/legal/**"
  - "app/compte-supprime/**"
  - "app/api/compte/**"
  - "components/profil/**"
  - "components/auth/**"
  - "components/ui/invitation-en-attente.tsx"
  - "components/ui/bandeau-cookies.tsx"
  - "components/ui/avatar.tsx"
  - "lib/foyer.ts"
  - "lib/profil.ts"
  - "lib/invitation.ts"
  - "lib/avatar*.ts"
  - "lib/auth-google*.ts"
  - "lib/reauth*.ts"
  - "lib/cgu-oauth*.ts"
  - "lib/legal*.ts"
  - "lib/consentement*.ts"
  - "lib/messages-auth*.ts"
  - "lib/auth-regles.ts"
  - "lib/doublons*.ts"
  - "proxy.ts"
  - "content/legal/**"
---

# Foyer, profil, onboarding, compte

Le mécanisme SQL (RLS `mon_foyer()`, RPC, clonage) est décrit dans `supabase.md`.

## Modèle « foyer de 1 systématique »

Tout utilisateur a déjà un foyer ; il n'existe donc pas d'action « créer un foyer ». Les actions sont **inviter** (`generer_code_invitation`, tout membre, RG-30), **rejoindre** (`rejoindre_foyer(p_code)`) et **quitter** (`quitter_foyer()`).

- **Rejoindre exige d'être solo** (RG-29, sinon il faut d'abord quitter) ; le catalogue perso migre sous le foyer cible, collisions de noms conservées (RG-33). Après une jonction, `detecterDoublons` (`lib/doublons.ts`, pur, nom normalisé) ouvre `ModaleDoublons` : suppression réelle pour une recette du foyer, masquage pour une globale.
- **Quitter clone** tout vers un nouveau foyer solo (RG-34) ; quitter en solo est refusé, et l'UI masque le bouton si `membres <= 1`.
- **Après jonction ou sortie** : `reinitialiserCacheFoyer()` puis rechargement de la page (cf. `sync-planning.md`).
- **Partage du lien** : Web Share API avec repli copier, plus un QR (`qrcode.react`, `QRCodeSVG`) sur fond `bg-white` **littéral** pour rester scannable en dark mode.
- UI : `components/profil/panneau-foyer.tsx`, section de `/profil`, qui porte aussi le sélecteur de jour de courses (`SelecteurJourCourses`, `components/ui/selecteur-jour-courses.tsx`, `role="radiogroup"`, partagé avec `/bienvenue`).

## `/profil` (identité) vs `/reglages` (génération)

`/profil` = qui je suis et avec qui (prénom, avatar, foyer, sécurité, préférences d'affichage, déconnexion, suppression de compte). `/reglages` = comment l'app génère. La séparation est volontaire. La nav mène à `/profil` par l'avatar.

- **Avatar « zéro upload »** (RG-35) : `lib/avatar.ts` (`initiale`, `couleurAvatar(email)` = hash djb2 déterministe vers `PALETTE_AVATAR`, `couleurValide`). La couleur est **stockée** (`profiles.couleur_avatar`) ; l'initiale est calculée à l'affichage.
- **Store profil** `useProfil()` (`lib/profil.ts`) : en mémoire, chargé paresseusement au premier abonnement (la nav). `sauvegarderProfil` patche le store pour une mise à jour live. Déconnecté, l'erreur de `chargerProfil` est avalée et l'avatar est neutre (« ? »).
- **« Assistants connectés »** (`components/profil/assistants-connectes.tsx`, #305) : `auth.oauth.listGrants()` puis `revokeGrant({ clientId })` après `ConfirmationModale`. Le jeton d'accès d'un assistant révoqué reste valable jusqu'à son expiration (1 h) ; ses refresh tokens sont invalidés tout de suite. Cf. `mcp.md`.
- **Déconnexion = `signOut({ scope: 'local' })`** suivi de `reinitialiserCacheFoyer()`. Le scope local préserve les sessions des autres appareils et membres.
- **Changement de mot de passe** : ré-authentifier au mot de passe actuel (`signInWithPassword`) **avant** `updateUser`, car Supabase ne revérifie pas l'identité. Un compte sans identité `email` (Google seul, `aMotDePasse(user.identities)` faux) n'a pas ce formulaire : `ChangerMotDePasse` affiche « Connecté avec Google ». Pourquoi : il n'y a aucun mot de passe actuel à demander, et « Définir un mot de passe » est hors périmètre.
- **Mot de passe oublié** : `/mot-de-passe-oublie` (`resetPasswordForEmail`, `redirectTo` `/auth/reinitialiser`) puis `/auth/reinitialiser` (`updateUser`, session de récupération via `detectSessionInUrl`). Les templates d'email se configurent dans le dashboard Supabase.

## Tunnel d'onboarding `/bienvenue` (US-23)

- **Trois écrans** (barre « Étape X sur 3 » pour tout le monde ; la branche « rejoindre » s'arrête à l'étape 2) : (1) prénom + nombre de personnes + « foyer végétarien » + « On mange à la maison le midi en semaine » (activé par défaut ; désactivé → `plafonds.dejeunerSemaine = "aucun"`) → écrit `profiles` **et** `reglages` ; (2) rejoindre par code ou « Démarrer seul·e » ; (3) **solo seulement**, « Tu fais tes courses quel jour ? » avec `SelecteurJourCourses` (samedi présélectionné, `JOUR_COURSES_PROPOSE`) et « Générer mon planning ». L'écran 3 a un bouton « Retour » vers l'écran 2 (jour choisi conservé). Pourquoi : le premier cycle se cale sur le jour de courses (RG-90), que seul un foyer solo choisit (un foyer rejoint a déjà le sien) ; « Retour » laisse rejoindre un foyer après coup sans recharger le tunnel.
- **Logique pure dans `lib/onboarding.ts`** (`reglagesInitiaux`, `midiSemaineDepuisReglages`, `joursAPartirDe`, `premierCycle`, `urlFinOnboarding`) ; `app/bienvenue/page.tsx` ne fait qu'orchestrer. Pourquoi : la logique reste testable sans navigateur (`tests/onboarding.test.ts`).
- **Garde proxy** : `proxy.ts` lit `profiles.onboarding_complete` à chaque navigation connectée et redirige vers `/bienvenue` tant que la valeur est fausse ; une fois vraie, il en interdit le retour. **Exemptés** : `/api/*`, `/auth/*`, `/legal/*` (sinon déconnexion, reset de mot de passe, génération et lecture des CGU au signup casseraient). **Fail-open** sur erreur de lecture, pour ne jamais créer de boucle.
- **Branche solo** (RG-90, #386), dans cet ordre : `definirJourCoursesFoyer(jour)` (échec → toast, on reste sur l'écran 3, rien n'est généré), `POST /api/planning/generer` avec `{ ancre, longueur }` (`premierCycle` = `ancreParDefaut(aujourd'hui, jour)`, 7 jours), `joursAPartirDe` (jours antérieurs à aujourd'hui retirés, aujourd'hui gardé), `appliquerGenerationCycle`, `marquerOnboardingComplete`. Un échec de génération termine quand même l'onboarding, sans le paramètre de bienvenue. Pourquoi : un premier planning par semaine ISO donnait à un inscrit du mercredi des repas déjà passés, et le jour de courses n'était jamais demandé.
- **Réessai après un échec du seul marquage** : `generationMemo` (`useRef<{ jour, ancre }>`) retient la génération réussie ; un nouveau clic avec le même jour va directement à `marquerOnboardingComplete`, un jour changé (après « Retour ») rejoue toute la séquence. Pourquoi : régénérer réécrirait pour rien un cycle déjà en base.
- **Fin de tunnel, pour tout nouvel inscrit** : `storeVuePlanning.ecrire("cycle")`, puis redirection par `window.location.assign`. Solo avec génération réussie → `/planning?bienvenue=1` : `app/planning/page.tsx` lit le paramètre une fois, l'efface par `history.replaceState` (cf. `next-react.md`) et affiche le toast « Ta liste de courses est prête » (action « Voir » vers `/courses`), gardé par un `useRef` contre le double montage StrictMode. Pourquoi : un paramètre d'URL survit au rechargement complet, un état React non.
- **Branche « rejoindre »** : ne génère pas (le foyer a déjà ses données), n'affiche pas le toast, ne demande pas de jour de courses ; `reinitialiserCacheFoyer()` puis redirection.

## Invitation par deep-link (US-24)

- Le lien d'invitation pointe vers `/signup?code=<code>`. Le code voyage en **`sessionStorage`** (`lib/invitation.ts`, clé `code_invitation_en_attente`), qui survit au flux d'auth. Le proxy, côté serveur, ne peut pas l'écrire : il **préserve `?code`** à travers ses redirections (`urlPreservantCode`).
- Capture : `capterCodeDepuisURL()` (lit `?code` / `?rejoindre`, stocke, nettoie l'URL via `history.replaceState`), appelée par `InvitationEnAttente`, monté une fois dans le layout.
- **`capterCodeDepuisURL` ignore tout chemin `/auth/*`** (ni lecture, ni retrait). Pourquoi : `createBrowserClient` force PKCE, donc le lien de reset arrive en `/auth/reinitialiser?code=<pkce>` ; ce code est celui de Supabase, le capter le volerait au SDK. Même raison pour le retour OAuth Google (`/auth/callback?code=<pkce>`), cf. « Connexion Google ».
- **Deux consommateurs, un seul code** : le nouvel inscrit (tunnel : aperçu via la RPC `apercu_invitation` → « Tu rejoins le foyer de X », puis jonction) ; le membre existant (`InvitationEnAttente`, inerte sur `/bienvenue` / `/login` / `/signup`, modale `ConfirmationModale`, refus si déjà en foyer partagé). Le code est effacé après consommation. `PanneauFoyer` ne pré-remplit pas le code, pour éviter un double traitement.

## Connexion Google (US-57)

- **Callback = route handler** (`app/auth/callback/route.ts`), jamais une page. Il échange le `code` (`exchangeCodeForSession`, client serveur à cookies), horodate les CGU, puis redirige vers `cheminDeRetour(suivant)` **sans recopier `code`**. Erreur `access_denied` ou autre, ou `code` absent : redirection vers `/login?erreur_oauth=annule|echec` (`erreurOAuthDepuisCallback`, messages dans `lib/auth-google.ts`). Pourquoi : une page rendue monterait `InvitationEnAttente` dans le layout, et un `?code` conservé dans l'URL finale serait pris pour un code d'invitation.
- **`?code` n'appartient à l'invitation que hors `/auth/*`.** Ne jamais rediriger du callback vers une page en gardant le `code` OAuth. Pourquoi : les deux usages partagent le nom de paramètre.
- **`urlRetourOAuth(origine, suivant)`** construit le `redirectTo` ; `suivant` n'est propagé que s'il survit tel quel à `cheminDeRetour`. Pourquoi : le même garde anti open-redirect doit s'appliquer à l'aller et au retour.
- **Mention CGU et horodatage** (RG-92) : `horodaterCguSiAbsentes` (`lib/cgu-oauth.ts`) n'écrit que si `cgu_version` est vide, en best-effort. Pourquoi : un compte déjà horodaté garde sa date d'origine, et un échec d'écriture ne doit pas défaire une connexion réussie.
- **`ConnexionGoogle`** (`components/auth/connexion-google.tsx`) est monté par `FormulaireAuth` sur `/login` et `/signup` : message d'erreur, bouton (logo G en SVG inline), mention CGU, séparateur « ou ». Le message `?erreur_oauth=` et la détection iOS se lisent par `useSyncExternalStore` sans `useSearchParams`, snapshot serveur `null` (cf. `next-react.md`). Pourquoi : `useSearchParams` force un repli `<Suspense>` dans le HTML prérendu, le bouton n'apparaîtrait qu'après hydratation et décalerait le formulaire. Un écouteur `pageshow` (`persisted`) réarme le bouton après un retour arrière depuis Google (bfcache).
- **PWA iOS installée** (`estPwaIos`, `navigator.standalone === true`) : le bouton est remplacé par l'indice « Pour te connecter avec Google, ouvre OMQ dans Safari ». Pourquoi : le retour OAuth risque d'atterrir dans Safari, sans le cookie `code_verifier` PKCE. Non vérifié sur un appareil réel ; lever ce masquage après un test (#390).
- **Prénom pré-rempli** (RG-94) : `prenomDepuisMetadonnees` (`lib/auth-google.ts`) dans `app/bienvenue/page.tsx`, après le prénom déjà saisi. Rien n'est écrit avant la validation de l'étape.
- **Liaison des identités** : un compte email à adresse confirmée qui se connecte avec Google sous la même adresse récupère l'identité (défaut Supabase). Aucun écran de liaison. Pourquoi : la liaison manuelle a été jugée inutile pour le périmètre.
- **Le provider est configuré dans le dashboard Supabase** (prod et staging, clients OAuth Google distincts). Les URLs de redirection autorisées de staging incluent `http://localhost:3000/**` et `https://webapp-repas*.vercel.app/**`. Pourquoi : sans elles, le retour de Google est refusé par Supabase.

## RGPD (US-29/30, RG-64→69)

- **Pages légales** : Markdown committé dans `content/legal/*.md`, édité directement en fichier (sans Notion). `lib/legal-fs.ts` (`node:fs`, Server Components) est séparé de `lib/legal.ts` (constantes client-safe : `PAGES_LEGALES`, `CGU_VERSION_ACTUELLE`), cf. `next-react.md`. Les routes `/legal/*` sont publiques et exemptées de la garde d'onboarding.
- **Case CGU au signup** : prop `cguRequise` de `FormulaireAuth`, garde **avant** tout appel réseau. Après un `signUp()` réussi, `profiles.cgu_version` / `cgu_acceptees_le` sont horodatés en best-effort.
- **Bandeau cookies** : dans le flux normal (cf. `ui.md`). `lib/consentement.ts` : `resoudreConsentement(brut, dntActif)` (pur, DNT prioritaire). Le localStorage fait foi ; le serveur (`profiles.consentement_analytics`) reçoit un push best-effort et n'est jamais relu pour écraser. `consentementAnalytics()` est le point d'accroche prévu pour PostHog.
- Le contenu juridique est un brouillon réaliste : **sa relecture juridique humaine reste un prérequis avant toute ouverture publique.**

## Suppression de compte (US-31, RG-70)

- Route `app/api/compte/supprimer/route.ts` : session, puis RPC `supprimer_mon_compte()`, puis `admin.auth.admin.deleteUser()` (`lib/supabase/admin.ts`, `service_role`). **Ordre strict : RPC d'abord, `deleteUser` ensuite.** Pourquoi : `recette.user_id → auth.users` est en `ON DELETE CASCADE`, et supprimer l'utilisateur avant la RPC détruirait les recettes qu'il a créées **pour tout le foyer**.
- La confirmation « tape SUPPRIMER » est de l'UX ; la protection réelle est le **contrôle de fraîcheur de l'authentification** (RG-93) : la route lit le claim `amr` du JWT (`getClaims()`, `authentificationRecente`, `lib/reauth.ts`) et répond 403 si la session s'est authentifiée il y a plus de `FRAICHEUR_MAX_S` (300 s) ou si `claims.sub` diffère de `user.id` (écart loggé), 500 si la vérification elle-même échoue. La RPC `supprimer_mon_compte()` refuse aussi (`OMQ06`, traduit en 403), cf. `supabase.md`. Pourquoi : la RPC est appelable directement par un utilisateur connecté, donc le contrôle doit exister en base ; `last_sign_in_at` est global à l'utilisateur et ne prouve rien sur la session courante.
- **Le composant ne fait que provoquer la ré-authentification** (`components/profil/supprimer-compte.tsx`) : compte avec identité `email` (`methodeReauth`), `signInWithPassword` juste avant l'appel ; Google seul, aller-retour OAuth avec `prompt=select_account` et `login_hint = email`, retour sur `/profil?suppression=confirmer` (le paramètre est consommé puis retiré par `history.replaceState`). Pourquoi : le serveur reste seul juge de la fraîcheur ; le client n'a rien à prouver.
- **Mémo `sessionStorage` `reauth_suppression_uid`** (JSON `{ uid, email }`), posé avant le départ vers Google et consommé au retour. Un `uid` différent signifie un autre compte Google : suppression bloquée, message « Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec {email} pour supprimer ton compte. », puis `signOut({ scope: "local" })`. Un mémo absent ou illisible redemande la confirmation. Pourquoi : `login_hint` ne force pas le compte, seule la comparaison des `uid` détecte l'erreur. Un compte Google neuf choisi par erreur n'a pas fini l'onboarding : le proxy l'envoie sur `/bienvenue`, rien n'est supprimé.
- **Le mémo n'est consommé que si l'effet est encore actif**, sinon le double montage StrictMode le volerait. Un `pageshow` `persisted` réarme le bouton après un retour arrière (bfcache), comme dans `ConnexionGoogle`.

## Dette pré-ouverture publique

La confirmation email est **activée en prod** et **désactivée sur staging** (les e2e en dépendent). L'énumération de comptes reste donc ouverte sur staging : `traduireErreurAuth(err, "signup")` neutralise le message, mais le SDK y renvoie un code distinct. Pourquoi : un compte e2e doit se connecter sans clic dans un email ; le comportement de prod diffère de celui des e2e sur ce point.
