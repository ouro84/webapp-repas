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
- UI : `components/profil/panneau-foyer.tsx`, section de `/profil`, qui porte aussi le sélecteur de jour de courses (`role="radiogroup"`).

## `/profil` (identité) vs `/reglages` (génération)

`/profil` = qui je suis et avec qui (prénom, avatar, foyer, sécurité, préférences d'affichage, déconnexion, suppression de compte). `/reglages` = comment l'app génère. La séparation est volontaire. La nav mène à `/profil` par l'avatar.

- **Avatar « zéro upload »** (RG-35) : `lib/avatar.ts` (`initiale`, `couleurAvatar(email)` = hash djb2 déterministe vers `PALETTE_AVATAR`, `couleurValide`). La couleur est **stockée** (`profiles.couleur_avatar`) ; l'initiale est calculée à l'affichage.
- **Store profil** `useProfil()` (`lib/profil.ts`) : en mémoire, chargé paresseusement au premier abonnement (la nav). `sauvegarderProfil` patche le store pour une mise à jour live. Déconnecté, l'erreur de `chargerProfil` est avalée et l'avatar est neutre (« ? »).
- **Déconnexion = `signOut({ scope: 'local' })`** suivi de `reinitialiserCacheFoyer()`. Le scope local préserve les sessions des autres appareils et membres.
- **Changement de mot de passe** : ré-authentifier au mot de passe actuel (`signInWithPassword`) **avant** `updateUser`, car Supabase ne revérifie pas l'identité.
- **Mot de passe oublié** : `/mot-de-passe-oublie` (`resetPasswordForEmail`, `redirectTo` `/auth/reinitialiser`) puis `/auth/reinitialiser` (`updateUser`, session de récupération via `detectSessionInUrl`). Les templates d'email se configurent dans le dashboard Supabase.

## Tunnel d'onboarding `/bienvenue` (US-23)

- Deux écrans : (1) prénom + nombre de personnes + « foyer végétarien » → écrit `profiles` **et** `reglages` ; (2) rejoindre par code ou « Démarrer seul·e ».
- **Garde proxy** : `proxy.ts` lit `profiles.onboarding_complete` à chaque navigation connectée et redirige vers `/bienvenue` tant que la valeur est fausse ; une fois vraie, il en interdit le retour. **Exemptés** : `/api/*`, `/auth/*`, `/legal/*` (sinon déconnexion, reset de mot de passe, génération et lecture des CGU au signup casseraient). **Fail-open** sur erreur de lecture, pour ne jamais créer de boucle.
- **Branche solo** : génère le premier planning (`POST /api/planning/generer` puis `sauvegarderPlanningComplet`), d'où le `useSync()` monté sur `/bienvenue` pour que le planning soit poussé. Un échec de génération termine quand même l'onboarding.
- **Branche « rejoindre »** : ne génère pas (le foyer a déjà ses données) ; `reinitialiserCacheFoyer()` puis redirection.

## Invitation par deep-link (US-24)

- Le lien d'invitation pointe vers `/signup?code=<code>`. Le code voyage en **`sessionStorage`** (`lib/invitation.ts`, clé `code_invitation_en_attente`), qui survit au flux d'auth. Le proxy, côté serveur, ne peut pas l'écrire : il **préserve `?code`** à travers ses redirections (`urlPreservantCode`).
- Capture : `capterCodeDepuisURL()` (lit `?code` / `?rejoindre`, stocke, nettoie l'URL via `history.replaceState`), appelée par `InvitationEnAttente`, monté une fois dans le layout.
- **Deux consommateurs, un seul code** : le nouvel inscrit (tunnel : aperçu via la RPC `apercu_invitation` → « Tu rejoins le foyer de X », puis jonction) ; le membre existant (`InvitationEnAttente`, inerte sur `/bienvenue` / `/login` / `/signup`, modale `ConfirmationModale`, refus si déjà en foyer partagé). Le code est effacé après consommation. `PanneauFoyer` ne pré-remplit pas le code, pour éviter un double traitement.

## RGPD (US-29/30, RG-64→69)

- **Pages légales** : Markdown committé dans `content/legal/*.md`, édité directement en fichier (sans Notion). `lib/legal-fs.ts` (`node:fs`, Server Components) est séparé de `lib/legal.ts` (constantes client-safe : `PAGES_LEGALES`, `CGU_VERSION_ACTUELLE`), cf. `next-react.md`. Les routes `/legal/*` sont publiques et exemptées de la garde d'onboarding.
- **Case CGU au signup** : prop `cguRequise` de `FormulaireAuth`, garde **avant** tout appel réseau. Après un `signUp()` réussi, `profiles.cgu_version` / `cgu_acceptees_le` sont horodatés en best-effort.
- **Bandeau cookies** : dans le flux normal (cf. `ui.md`). `lib/consentement.ts` : `resoudreConsentement(brut, dntActif)` (pur, DNT prioritaire). Le localStorage fait foi ; le serveur (`profiles.consentement_analytics`) reçoit un push best-effort et n'est jamais relu pour écraser. `consentementAnalytics()` est le point d'accroche prévu pour PostHog.
- Le contenu juridique est un brouillon réaliste : **sa relecture juridique humaine reste un prérequis avant toute ouverture publique.**

## Suppression de compte (US-31, RG-70)

- Route `app/api/compte/supprimer/route.ts` : session, puis RPC `supprimer_mon_compte()`, puis `admin.auth.admin.deleteUser()` (`lib/supabase/admin.ts`, `service_role`). **Ordre strict : RPC d'abord, `deleteUser` ensuite.** Pourquoi : `recette.user_id → auth.users` est en `ON DELETE CASCADE`, et supprimer l'utilisateur avant la RPC détruirait les recettes qu'il a créées **pour tout le foyer**.
- La confirmation « tape SUPPRIMER » est de l'UX ; la protection réelle est la ré-authentification par mot de passe.

## Dette pré-ouverture publique

La confirmation email est **désactivée** (les e2e en dépendent). L'énumération de comptes n'est donc que partiellement fermée : `traduireErreurAuth(err, "signup")` neutralise le message, mais le SDK renvoie un code distinct. La fermeture complète exige d'activer la confirmation en prod, avec un compte e2e pré-confirmé ou un staging sans confirmation.
