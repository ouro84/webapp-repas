# Contexte projet — Webapp Repas de la semaine

> Dernière mise à jour : 2026-06-06
> Stack : Next.js 16 (App Router) + Supabase + Vercel + Tailwind CSS v4

---

## Règle de mise à jour de ce fichier

Ce fichier est un critère de merge. Toute PR qui introduit un nouveau piège, modifie une convention, ou solde une dette documentée ici doit mettre ce fichier à jour dans le même commit.

Cas déclencheurs :
- Nouveau comportement non-évident découvert pendant le dev
- Convention modifiée (nommage, structure de dossiers, workflow Git)
- Dette soldée → supprimer ou annoter l'entrée concernée
- Nouvelle dépendance avec comportement non-standard
- Changement de version majeure d'une lib

---

## Ce projet en une phrase

Webapp de génération automatique de plannings de repas hebdomadaires, avec liste de courses agrégée. Usage personnel, mobile-first, déployée sur Vercel.

---

## Documents de référence — lire en début de session

| Fichier | Rôle |
|---------|------|
| `SPECS_FONCTIONNELLES.md` | Périmètre MVP, user stories BDD, modèle de données, règles métier — source de vérité pour toute décision de code |
| `ADR.md` | Stack, structure de dossiers, conventions de commits, workflow Git, règles secrets |

**Lire `SPECS_FONCTIONNELLES.md` et `ADR.md` avant toute session de code.** Ne jamais improviser un choix que ces documents ont déjà tranché.

---

## Stack technique

| Rôle | Techno | Version |
|------|--------|---------|
| Framework full-stack | Next.js (App Router) | 16.2.7 |
| Base de données + Auth | Supabase | — (Phase 4) |
| Hébergement | Vercel | — |
| CSS | Tailwind CSS | v4 |
| Typage | TypeScript strict | v5 |
| Tests unitaires | Vitest | — (Phase 7) |
| Tests e2e | Playwright | — (Phase 7) |
| Monitoring d'erreurs | Sentry (`@sentry/nextjs`) | v10 |
| Versioning | Git + GitHub | — |

> **Note Tailwind v4 :** la configuration se fait dans `app/globals.css` via `@theme`, pas dans un fichier `tailwind.config.js`. Les classes utilitaires restent identiques.

---

## Structure de dossiers cible

```
webapp-repas/
├── app/                        # Pages (App Router)
│   ├── layout.tsx              # Layout global
│   ├── page.tsx                # Accueil (route "/")
│   ├── planning/page.tsx       # Planning (route "/planning")
│   └── courses/page.tsx        # Liste de courses (route "/courses")
├── components/
│   ├── ui/                     # Composants génériques (bouton, badge...)
│   └── planning/               # Composants spécifiques au planning
├── lib/                        # Logique métier pure (sans UI)
│   ├── generateur.ts           # Algorithme de génération du planning
│   ├── courses.ts              # Agrégation de la liste de courses
│   └── supabase.ts             # Client Supabase (Phase 4)
├── data/
│   └── recettes.json           # Source de vérité des recettes (MVP)
├── types/
│   └── index.ts                # Types TypeScript partagés
├── public/                     # Assets statiques
├── .env.local                  # Secrets — JAMAIS dans Git
├── .env.example                # Template des variables d'env — dans Git
└── CLAUDE.md
```

---

## Conventions — non négociables

### Commits
Format : `type: description courte`

| Type | Usage |
|------|-------|
| `feat:` | Nouvelle fonctionnalité |
| `fix:` | Correction de bug |
| `chore:` | Maintenance (dépendances, config) |
| `refactor:` | Réécriture sans changement de comportement |
| `test:` | Ajout ou modification de tests |
| `docs:` | Documentation uniquement |

### Workflow Git
- `main` = branche de production, toujours déployable
- Une branche par feature : `feat/generation-planning`, `feat/liste-courses`
- Jamais de commit direct sur `main`

### Secrets
- `.env.local` dans `.gitignore` — jamais commité
- `.env.example` commité avec les noms de variables, sans les valeurs

### Changelog
- `CHANGELOG.md` à la racine, format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
- Tout changement notable est ajouté à la section `[Unreleased]` dans la PR qui l'introduit
- À chaque release GitHub : transformer `[Unreleased]` en section versionnée datée, et mettre à jour les liens de comparaison en bas de fichier

---

## Outils disponibles

| Outil | Usage |
|-------|-------|
| `gh` (GitHub CLI) | Authentifié en tant que `ouro84`. Utiliser pour gérer le backlog GitHub Projects en langage naturel : ajouter des cartes, changer leur statut, lister les items. |

---

## Règles de code

1. **TypeScript strict partout.** Corriger les erreurs de typage, ne pas les contourner.
2. **`app/` pour l'UI, `lib/` pour la logique.** Un algorithme dans `lib/` se teste sans avoir à lancer le navigateur.
3. **Trois états UI minimum.** Tout écran doit gérer : loading, error, empty.
4. **Jamais de `try/catch` vide.** Toute erreur capturée est loggée ou affichée.
5. **Mobile-first.** Les styles sont écrits pour mobile, ajustés pour desktop via `md:` et `lg:`.

---

## Pièges et décisions non-évidentes

> Choses qu'un Claude ouvrant ce projet sans historique pourrait rater. Basé sur le code observé — vérifier le fichier cité en cas de doute.

### Styles & UI

**Tailwind v4 sans fichier de config** — Toute la config est dans `app/globals.css` via `@theme` : chaque token `--color-X-Y` devient automatiquement les classes `bg-X-Y` / `text-X-Y` / `border-X-Y`. Si on crée un `tailwind.config.js`, il est ignoré silencieusement — les modifications n'auront aucun effet.

**Design system maison, pas la palette Tailwind** — Trois palettes custom : `brand-*` (vert), `accent-*` (terracotta), `canvas` (fond crème). Les boutons principaux sont `rounded-full bg-brand-600 hover:bg-brand-700`. Utiliser `green-600` ou `bg-white` pour du brand casse la cohérence visuelle ; les états erreur, eux, utilisent bien les `red-*` standard (cf. `app/error.tsx`, état erreur de `app/planning/page.tsx`).

**`global-error.tsx` n'existe pas (encore)** — `app/error.tsx` couvre les pages, pas le layout racine. C'est l'issue #30 au backlog ; piège documenté dedans : dans `global-error.tsx`, Tailwind n'est pas disponible (globals.css est importé par le layout qui a crashé) → styles inline obligatoires.

### React / Next.js 16

**localStorage = `useSyncExternalStore`, pas `useEffect` + `setState`** — La règle ESLint `react-hooks/set-state-in-effect` (config Next.js 16) interdit le setState synchrone dans un effet au montage. Le pattern du projet (cf. `app/planning/page.tsx`) : mini-store avec snapshot serveur `null` (prérendu en état vide, puis hydratation). Dévier = erreur de lint + risque de mismatch d'hydratation.

**L'événement `storage` ne notifie pas l'onglet courant** — Il ne se déclenche que dans les *autres* onglets. Le mini-store maintient donc un `Set` d'abonnés notifiés manuellement à chaque écriture (`sauvegarderPlanning`). Écrire dans localStorage sans passer par cette fonction = UI qui ne se rafraîchit pas.

**`middleware.ts` est déprécié en Next.js 16** — Warning au démarrage : « The "middleware" file convention is deprecated. Please use "proxy" instead. » Le fichier gère la session Supabase ; il fonctionne encore. Le warning en CI/dev est attendu — ne pas le « corriger » à la va-vite, la migration vers `proxy` est un chantier à part entière.

**Sentry v10 : pas de `sentry.client.config.ts`** — Depuis @sentry/nextjs v9, la config client vit dans `instrumentation-client.ts` à la racine (les tutos qui mentionnent `sentry.client.config.ts` sont obsolètes). `sentry.server.config.ts` et `sentry.edge.config.ts` existent toujours, chargés par `instrumentation.ts`. La variable d'env est `NEXT_PUBLIC_SENTRY_DSN` (pas `SENTRY_DSN`) : le préfixe est requis pour inliner le DSN dans le bundle client — un DSN n'est pas un secret. Choix volontaires : pas de tracing ni de session replay (quota gratuit, usage perso) ; pas d'upload de source maps (pas de `SENTRY_AUTH_TOKEN`) → stack traces minifiées dans Sentry en prod, le digest Next reste la référence.

**Client Supabase scindé en deux** — `lib/supabase/client.ts` (navigateur, `createBrowserClient`) et `lib/supabase/server.ts` (serveur, `createServerClient` + cookies), pas un `lib/supabase.ts` unique comme le montre la structure cible ci-dessus. Imposé par l'App Router (révision ADR-02). Importer le mauvais client = erreurs de session.

### Logique métier (`lib/generateur.ts`)

**Ordre de remplissage : slots contraints d'abord** — Les dîners de semaine (limités aux recettes « rapide »/« normal », RG-01) sont attribués avant les slots week-end (qui acceptent tout). Remplir dans l'ordre chronologique pourrait épuiser le vivier rapide/normal sur le week-end et faire échouer un slot de semaine alors qu'une solution existe.

**Semaine au format ISO 8601 (`"2026-W23"`)** — L'année ISO est celle du jeudi de la semaine : elle peut différer de l'année civile autour du 1er janvier. Tous les calculs de date (génération et affichage `formaterSemaine`) sont en UTC pour neutraliser les fuseaux. Ne pas remplacer par `getFullYear()` + un compteur naïf.

### Tests & CI

**Playwright lit `.env.local` directement, pas `process.env`** — `e2e/auth.setup.ts` parse le fichier avec `readFileSync` (Playwright ne charge pas les env Next). Conséquence en CI : le workflow génère un `.env.local` depuis les secrets GitHub Actions (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, déjà configurés sur le repo). Supprimer cette étape du workflow = e2e cassés en CI uniquement.

**Les e2e tapent la vraie instance Supabase** — Compte de test `claude-e2e-test@example.com`, signup idempotent à chaque run (local et CI). `workers: 1` obligatoire (les tests partagent serveur dev et localStorage), viewport mobile 390×844 (la grille desktop est en `display:none`), session réutilisée via `e2e/.auth/user.json`.

**La confirmation email Supabase est désactivée** — Volontaire en dev (note ADR-02), et `auth.setup.ts` en dépend (le compte de test est utilisable dès le signup). La réactiver pour la prod cassera le setup e2e tel quel — prévoir un compte pré-confirmé ou un autre mécanisme à ce moment-là.

**`npm run test` en CI ne reste pas en watch** — Le script lance `vitest` (mode watch en local), mais Vitest détecte `CI=true` et passe en single-run. En local, préférer `npm run test:run` pour un run unique.

**Branch protection : dette connue, et bloquée par le plan GitHub** — Le workflow CI (`.github/workflows/ci.yml`) tourne sur chaque PR et push vers `main`, mais aucun check n'est *obligatoire* pour merger : rien n'empêche techniquement de merger une PR rouge. Vérifié le 2026-06-06 : la protection de branche (classique et rulesets) est **indisponible sur un repo privé en plan Free** — l'API répond 403 « Upgrade to GitHub Pro or make this repository public ». Décision : on reste comme ça (discipline). Si la situation change (repo public ou GitHub Pro), configurer : require PR before merging + required status check `test` (nom du job CI).

### Environnement de dev (poste Windows + Avast)

**Avast intercepte le TLS → Node ne reconnaît pas sa CA** — Symptôme : le login Supabase échoue en dev local (erreur TLS). Remède : `NODE_OPTIONS=--use-system-ca` (déjà posé en variable d'environnement machine via `setx`). C'est aussi la raison du `ignoreHTTPSErrors: true` dans `playwright.config.ts`. Si l'auth e2e échoue localement avec une erreur certificat, vérifier cette variable avant de chercher ailleurs.

### Conventions de code observées

**Tout est en français** — Noms de variables, fonctions (`genererPlanning`, `choisirAleatoire`, `sAbonner`), commentaires, messages d'erreur et textes UI. Les commentaires citent les règles métier (`RG-xx`) et user stories (`US-xx`) de `SPECS_FONCTIONNELLES.md`. Du code en anglais détonnerait — suivre l'existant.
