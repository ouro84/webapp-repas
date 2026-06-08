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
- **Jamais de merge avant la CI verte.** Aucune PR n'est mergée tant que tous les tests automatiques (job `test` + checks Vercel) ne sont pas terminés **et** au vert — même si le merge a été explicitement demandé. La protection de branche est indisponible (plan Free, cf. piège dédié), donc cette règle tient par discipline : attendre la fin des checks (`gh pr checks <n> --watch`), pas seulement leur lancement.
  - **Si un check échoue alors qu'un merge a été demandé** : ne pas merger, ne pas by-passer en silence. Remonter à l'humain les éléments d'arbitrage — quel check, le lien du run, l'extrait de log pertinent, la cause probable, et si l'échec est lié à la PR ou pré-existant/flaky (réseau, staging non seedé…) — puis proposer soit une **correction**, soit un **by-pass justifié**, et laisser l'humain trancher.

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
| `supabase` (CLI, devDependency) | Migrations de schéma (`supabase/migrations/`). En CI uniquement pour `db push` — en local le binaire Go est bloqué par Avast (cf. piège ci-dessous), passer par `scripts/query-supabase.mjs`. Token : `SUPABASE_ACCESS_TOKEN` dans `.env.local`. |

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

**Logo + icônes : SVG, pas d'emoji (#59)** — L'app s'appelle **« On mange quoi ? »** (baseline « La question du soir a enfin sa réponse »). Le logo est `components/ui/logo.tsx` (mark assiette+fourchette en négatif, `fill="currentColor"`, décoratif `aria-hidden` — le nom est en texte à côté) ; sa couleur se pilote par `text-brand-*`. Favicon = `app/icon.svg` (palette brand-600, sans `currentColor` car hors contexte CSS) ; image OG = `app/opengraph-image.png`. Source vectorielle d'archive : `revueDesign/` (non versionné). **Règle no-emoji-icons** : pas d'emoji ni de glyphe Unicode comme icône — utiliser un SVG inline ou **`lucide-react`** (ex. `RefreshCw` pour « changer », tree-shakable). La police ronde du wordmark viendra avec #P14, l'icône PWA avec #P18.

**`global-error.tsx` n'existe pas (encore)** — `app/error.tsx` couvre les pages, pas le layout racine. C'est l'issue #30 au backlog ; piège documenté dedans : dans `global-error.tsx`, Tailwind n'est pas disponible (globals.css est importé par le layout qui a crashé) → styles inline obligatoires.

### React / Next.js 16

**localStorage = `useSyncExternalStore`, pas `useEffect` + `setState`** — La règle ESLint `react-hooks/set-state-in-effect` (config Next.js 16) interdit le setState synchrone dans un effet au montage. Le pattern du projet : mini-stores partagés dans `lib/stockage.ts` (`storePlanning`, `storeCoches`) avec snapshot serveur `null` (prérendu en état vide, puis hydratation). Dévier = erreur de lint + risque de mismatch d'hydratation.

**L'événement `storage` ne notifie pas l'onglet courant** — Il ne se déclenche que dans les *autres* onglets. Chaque store de `lib/stockage.ts` maintient donc un `Set` d'abonnés notifiés manuellement à chaque écriture. Écrire dans localStorage sans passer par ces stores = UI qui ne se rafraîchit pas. Les écritures métier passent par `sauvegarderPlanningComplet` (qui **efface aussi les coches** de la liste de courses, RG-13) ou `sauvegarderRemplacementSlot` (qui les conserve) — ne pas appeler `storePlanning.ecrire` directement depuis une page.

**L'undo restaure planning ET coches ensemble (US-09, RG-19)** — `capturerSnapshotAnnulation` fige `planning_courant` + `courses_cochees` dans `planning_snapshot` (localStorage) avant chaque action destructive ; `restaurerSnapshotAnnulation` réécrit les deux. Deux pièges : (1) ne pas restaurer via `sauvegarderPlanningComplet`, qui ré-effacerait les coches qu'on veut justement rendre — c'est pour ça que la restauration écrit les stores directement *dans* `lib/stockage.ts` (la règle reste centralisée). (2) Snapshot **mono-niveau** (un seul cran d'undo) et **expirant** (~6 s, marge sur les ~5 s du toast) : il n'est volontairement pas un historique. Le toast d'annulation réutilise un `id` sonner fixe (`"annulation-planning"`) pour qu'une nouvelle action remplace le précédent.

**`middleware.ts` est déprécié en Next.js 16** — Warning au démarrage : « The "middleware" file convention is deprecated. Please use "proxy" instead. » Le fichier gère la session Supabase ; il fonctionne encore. Le warning en CI/dev est attendu — ne pas le « corriger » à la va-vite, la migration vers `proxy` est un chantier à part entière.

**Sentry v10 : pas de `sentry.client.config.ts`** — Depuis @sentry/nextjs v9, la config client vit dans `instrumentation-client.ts` à la racine (les tutos qui mentionnent `sentry.client.config.ts` sont obsolètes). `sentry.server.config.ts` et `sentry.edge.config.ts` existent toujours, chargés par `instrumentation.ts`. La variable d'env est `NEXT_PUBLIC_SENTRY_DSN` (pas `SENTRY_DSN`) : le préfixe est requis pour inliner le DSN dans le bundle client — un DSN n'est pas un secret. Choix volontaires : pas de tracing ni de session replay (quota gratuit, usage perso) ; pas d'upload de source maps (pas de `SENTRY_AUTH_TOKEN`) → stack traces minifiées dans Sentry en prod, le digest Next reste la référence.

**Client Supabase scindé en deux** — `lib/supabase/client.ts` (navigateur, `createBrowserClient`) et `lib/supabase/server.ts` (serveur, `createServerClient` + cookies), pas un `lib/supabase.ts` unique comme le montre la structure cible ci-dessus. Imposé par l'App Router (révision ADR-02). Importer le mauvais client = erreurs de session.

### Recettes & génération (depuis #2)

**La source de vérité des recettes est Supabase, pas `data/recettes.json`** — Le JSON ne sert plus qu'd'asset d'amorçage du catalogue global (cf. migration `..._recettes_globales.sql` et `scripts/generer-seed-recettes.mjs`). Les tests (`tests/recettes-dataset.test.ts`, fixtures) continuent de le lire, mais l'app lit la base. Modifier le JSON ne change rien à l'app déployée — il faut une migration/CRUD.

**Catalogue global (lecture seule) + recettes perso** — Les recettes `user_id IS NULL` sont globales (visibles de tous, non éditables) ; celles de l'utilisateur sont privées et modifiables. RLS : SELECT autorise `user_id IS NULL OR auth.uid() = user_id`, mais insert/update/delete restent « propriétaire ». Pour « modifier » une globale, on la **duplique** dans son espace (PR3). Ne pas attendre qu'un `update`/`delete` touche une globale : la RLS le refuse silencieusement.

**Génération côté serveur, liste côté client** — La génération passe par `POST /api/planning/generer` (lit les recettes sous RLS, applique `lib/generateur`, renvoie le planning ; le client le persiste en localStorage). Mais le sélecteur (#14) et le « ↺ changer » ont besoin de la liste : ils la chargent via `lib/recettes.ts` (client). Deux accès distincts, c'est voulu.

**La fiche de recette lit le slot, pas Supabase (US-10)** — La recette complète (avec ses ingrédients) est déjà dans le planning persisté : `FicheRecette` s'affiche directement depuis l'objet du slot, sans appel réseau ni état loading. Déclencheur = le **nom du plat** (un `<button>`), pas la card entière — elle porte déjà changer/sélectionner/stepper (pas d'imbrication d'interactifs). Les quantités sont mises à l'échelle via les mêmes helpers que la liste de courses (`facteurEchelle`/`arrondirQuantite` de `lib/personnes`, formatage `lib/unites.ts`) → ne pas réimplémenter, sous peine de diverger. Le raccourci « Modifier » n'apparaît que pour une recette **perso** : l'éditabilité vient de `chargerRecettesGerees()` (la page planning charge cette variante, pas `chargerRecettes`, pour disposer du flag `editable`). **Pas de champ saisonnalité dans le modèle** : c'est le backlog #P12 — ne pas inventer le champ.

**`useSearchParams` exige une frontière `<Suspense>` (Next 16)** — Le deep-link d'édition `/recettes?edition=<id>` (depuis la fiche) lit le query param via `useSearchParams` ; sans `<Suspense>` parent, le build casse. `app/recettes/page.tsx` isole donc le contenu dans `ContenuRecettes`, l'export par défaut l'enveloppe. L'ouverture du formulaire se fait dans le `.then()` du chargement (pas en synchrone dans l'effet → règle `set-state-in-effect`).

**Les e2e de génération ne valident qu'en CI** — En local, les e2e tapent l'instance de `.env.local` (prod), qui n'a le catalogue global que si la migration y a été appliquée (au merge). Le catalogue est seedé sur **staging** par la CI (migration avant e2e), donc les parcours de génération sont fiables en CI mais peuvent échouer en local si la base pointée n'est pas seedée.

**Les e2e CRUD recettes écrivent en base** — `e2e/recettes.spec.ts` crée de vraies recettes (nom suffixé par le `Date.now` du run, pour l'identification et éviter les collisions strict-mode). Un `afterAll` les supprime toutes (recherche par suffixe + suppression via l'UI) → pas d'accumulation sur le compte de test. **Ne pas lancer `recettes.spec` en local** : `.env.local` pointe la prod, ça y créerait (transitoirement) des recettes ; si le teardown échoue, elles y resteraient. Validation en CI (staging).

### Logique métier (`lib/generateur.ts`)

**14 repas, éligibilité par slot (jour × type de repas)** — Depuis #3, la génération produit un déjeuner ET un dîner chaque jour (14 slots). L'éligibilité (RG-01) dépend du jour **et** du type de repas, centralisée dans `tempsEligibles(jour, typeRepas)` : dîner de semaine = `"rapide"`, déjeuner de semaine = `"rapide"`/`"normal"`, week-end = tout. `estEligible` prend donc `(recette, jour, typeRepas)` — ne pas retomber sur l'ancienne signature « par jour seul ». Cette table est le point d'extension de #P09 (paramétrage par slot).

**Ordre de remplissage : slots contraints d'abord** — `poidsContrainte` = taille du vivier de temps éligibles : dîners de semaine (1, « rapide ») servis avant les déjeuners de semaine (2), eux-mêmes avant le week-end (3, tout). Remplir dans l'ordre chronologique pourrait épuiser un vivier restreint et faire échouer un slot alors qu'une solution existe.

**`dejeuner` reste optionnel dans le type, mais peuplé chaque jour** — Le générateur remplit les 14 slots ; `JourPlanning.dejeuner` est néanmoins gardé `?:` optionnel pour relire sans casse les plannings persistés à 9 repas (antérieurs à #3). `remplacerSlot`/`remplacerSlotManuel`/`modifierPersonnes` renvoient donc encore `null` si le slot demandé est absent d'un vieux planning — ne pas supposer qu'un déjeuner existe toujours.

**Repas en « restes » : flag par slot, exclu des courses (US-12, RG-22)** — `JourPlanning.restes?.{dejeuner|diner}` marque un repas non cuisiné. `lib/restes.ts` : `estRestes(jp, type)` + `marquerRestes(planning, jour, type, valeur)` (setter immuable). `genererListeCourses` **saute** les slots en restes — un repas en restes ne produit aucun article. La recette sous-jacente est **conservée** (démarquer la restitue), mais `remplacerSlot`/`remplacerSlotManuel` **effacent** le flag (on recuisine) ; la génération repart sans restes. Côté UI, un slot restes n'affiche ni `BadgeTemps`, ni stepper, ni fiche. Marquage déclenché depuis la card (bouton) et le `SelecteurRecette` (prop `onRestes`), via snapshot d'annulation (#62).

**Semaine au format ISO 8601 (`"2026-W23"`)** — L'année ISO est celle du jeudi de la semaine : elle peut différer de l'année civile autour du 1er janvier. Tous les calculs de date sont en UTC pour neutraliser les fuseaux. Ne pas remplacer par `getFullYear()` + un compteur naïf. **Toute la logique calendaire vit dans `lib/semaines.ts`** (depuis #55) : `semaineISO` (calcul), `formaterSemaine` (affichage), `semainesSelectionnables`/`semaineParDefaut`/`libelleRelatif` (sélecteur US-11). `generateur.ts` et la page planning l'importent — ne pas redéfinir ces fonctions en local.

**Semaine cible : plage validée côté serveur (US-11, RG-21)** — `genererPlanning(recettes, semaine?)` accepte une semaine cible ; `POST /api/planning/generer` lit `{ semaine }` dans le corps et **rejette (400) toute semaine hors de `semainesSelectionnables()`** (courante → +6). Le client n'est pas l'autorité. Le sélecteur de semaine (page planning) est rendu **après hydratation** (`useHydratation`) car son défaut dépend de la date du client (week-end → semaine prochaine) — sinon mismatch SSR. Mono-actif : une seule semaine en `planning_courant` (l'historique multi-semaines = #P08).

### Migrations Supabase

**Tout changement de schéma passe par un fichier de migration** — `supabase/migrations/<timestamp 14 chiffres>_<nom>.sql`, appliqué par la CI via `supabase db push` (staging sur chaque PR, prod sur push `main`). Ne plus jamais modifier le schéma à la main dans le SQL editor : la base divergerait des migrations et le `db push` suivant pourrait casser.

**La baseline `20260606225900_init.sql` remplace les migrations manuelles** — Les fichiers `20260603_001/_002` (format de nommage incompatible CLI) ont été fusionnés dedans, contenu vérifié contre le schéma réel de la prod via l'API de management. L'historique distant (`supabase_migrations.schema_migrations`) a été marqué manuellement sur prod **et** staging le 2026-06-06 : la baseline y figure comme appliquée, `db push` ne la rejouera pas. Une base neuve, elle, la rejouera entièrement — c'est voulu.

**`db pull` / `db dump` ne marchent pas sur ce poste** — Double blocage : ces commandes exigent Docker (non installé), et le binaire Go du CLI est bloqué par Avast (cf. piège Avast ci-dessous). Pour inspecter un schéma distant : `node scripts/query-supabase.mjs <ref> "<sql>"` (API de management, requiert `SUPABASE_ACCESS_TOKEN`). Refs : prod `gabyhlcwahzquolwxmgd`, staging `upxoxrjumxpzumakawiv`.

**Sync multi-device (#6) — base = source de vérité, planning + coches (livré)** — `planning_slot` porte `personnes`/`restes`, table `etat_courses` (coches JSONB), couche d'accès `lib/persistance.ts` + adaptateurs `dbPlanningToDomain`. Tout vit dans `lib/sync.ts` : un gestionnaire **abonné à `storePlanning` ET `storeCoches`** pousse en base (débounce 800 ms) à chaque écriture — aucun handler à modifier — et **`useSync()`** (pages planning **et** courses) hydrate au montage planning puis coches. **Logique dirty-first / horloge serveur** (corrige le clobber dû au décalage d'horloges) : `planning_courant_maj` / `courses_cochees_maj` valent l'`updated_at` **renvoyé par la base** (jamais l'horloge client) ; une édition pose seulement le drapeau `planning_dirty` / `courses_dirty`, et **le local fait foi tant que dirty** (jamais écrasé). Pull seulement si cache **vide** ou `updated_at` serveur **strictement** plus récent ; un cache **non horodaté** (legacy/injecté en test) est aussi considéré le plus frais. `pousser*()` est **sérialisé** (garde anti-concurrence) → pas de `duplicate key`/RLS. **Conséquence e2e** : les specs partant d'un état vide (planning.spec, courses.spec) **nettoient l'état distant** du compte de test en `beforeEach` (`e2e/helpers.ts` → `nettoyerEtatDistant`, DELETE REST sous RLS) — sinon un planning/des coches persistés réapparaîtraient. Mono-actif (delete→insert) ; le snapshot d'undo reste **local** (non synchronisé). **Caveat** : l'`updated_at` est posé par le client à l'écriture (pas un trigger SQL `now()`) — suffisant pour l'usage mono-utilisateur séquentiel (amélioration : #104).

**Historique multi-semaines (#5) — la persistance n'est plus mono-actif** — Depuis PR1 de #5, `sauvegarderPlanningDistant` fait un **upsert par (user, semaine)** (delete de cette semaine puis insert), plus le delete-all d'avant → les semaines **s'accumulent** en base (historique borné par `purgerSemainesAvant`, rétention 12 semaines). `etat_courses` est clé-vé **par (user, semaine)** (migration `..._historique_plannings`) ; les coches sont donc propres à chaque semaine — dans `lib/sync`, elles s'attachent à la **semaine du planning actif** (`semaineActive()`). `chargerPlanningDistant(semaine?)` : sans argument = semaine la plus récente (runtime actuel) ; avec, une semaine précise. **La navigation entre semaines (← →), l'affichage par semaine et les confirmations regen/modif sur semaines passées arrivent en PR2/PR3** — en PR1 le runtime reste sur la semaine active (aucune régression #6/#55).

### Tests & CI

**Playwright lit `.env.local` directement, pas `process.env`** — `e2e/auth.setup.ts` parse le fichier avec `readFileSync` (Playwright ne charge pas les env Next). Conséquence en CI : le workflow génère un `.env.local` depuis les secrets GitHub Actions `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`, mappés vers les noms `NEXT_PUBLIC_*` attendus par l'app. Supprimer cette étape du workflow = e2e cassés en CI uniquement. Les secrets staging doivent exister dans les deux coffres (Actions **et** Dependabot, cf. piège Dependabot ci-dessous).

**Les e2e tapent une vraie instance Supabase — staging en CI, celle de `.env.local` en local** — Depuis 2026-06-06, la CI pointe vers l'instance Supabase staging (séparée de la prod) ; en local, les e2e utilisent l'instance configurée dans `.env.local`. Compte de test `claude-e2e-test@example.com`, signup idempotent à chaque run. `workers: 1` obligatoire (les tests partagent serveur dev et localStorage), viewport mobile 390×844 (la grille desktop est en `display:none`), session réutilisée via `e2e/.auth/user.json`. La confirmation email doit être désactivée sur le staging aussi, sinon `auth.setup.ts` casse.

**Les PR Dependabot lisent un coffre de secrets séparé** — Les workflows déclenchés par Dependabot n'ont pas accès aux secrets Actions classiques : ils lisent le coffre Dependabot (Settings → Secrets and variables → Dependabot). Les secrets Supabase y sont donc dupliqués. Conséquence : tout nouveau secret utilisé par la CI doit être créé dans **les deux coffres**, et une rotation de clé doit mettre à jour **les deux** — sinon, seules les PR Dependabot échouent (symptôme déroutant).

**La confirmation email Supabase est désactivée** — Volontaire en dev (note ADR-02), et `auth.setup.ts` en dépend (le compte de test est utilisable dès le signup). La réactiver pour la prod cassera le setup e2e tel quel — prévoir un compte pré-confirmé ou un autre mécanisme à ce moment-là.

**`addInitScript` rejoue à chaque chargement complet de page** — Le `beforeEach` de `e2e/planning.spec.ts` purge `planning_courant` via `addInitScript` : un `page.goto()` en cours de test re-purge donc le planning généré (liste de courses vide, symptôme déroutant). Dans ces tests, naviguer entre pages par les **liens de l'app** (navigation SPA Next, l'init script ne rejoue pas), pas par `page.goto()`.

**`getByLabel` est un match par sous-chaîne → ambigu si un bouton voisin reprend le libellé** — Sur le formulaire d'auth, le bouton œil porte l'aria-label « Afficher le mot de passe », qui contient « mot de passe » : `getByLabel("Mot de passe")` matche alors l'input ET le bouton (échec strict-mode). Utiliser `getByLabel("Mot de passe", { exact: true })` (cf. `e2e/auth.setup.ts`, `e2e/auth.spec.ts`). Vaut pour tout champ doté d'un contrôle adjacent dont le label se chevauche.

**`npm run test` en CI ne reste pas en watch** — Le script lance `vitest` (mode watch en local), mais Vitest détecte `CI=true` et passe en single-run. En local, préférer `npm run test:run` pour un run unique.

**Branch protection : dette connue, et bloquée par le plan GitHub** — Le workflow CI (`.github/workflows/ci.yml`) tourne sur chaque PR et push vers `main`, mais aucun check n'est *obligatoire* pour merger : rien n'empêche techniquement de merger une PR rouge. Vérifié le 2026-06-06 : la protection de branche (classique et rulesets) est **indisponible sur un repo privé en plan Free** — l'API répond 403 « Upgrade to GitHub Pro or make this repository public ». Décision : on reste comme ça (discipline). Si la situation change (repo public ou GitHub Pro), configurer : require PR before merging + required status check `test` (nom du job CI).

### Environnement de dev (poste Windows + Avast)

**Avast intercepte le TLS → Node ne reconnaît pas sa CA** — Symptôme : le login Supabase échoue en dev local (erreur TLS). Remède : `NODE_OPTIONS=--use-system-ca` (déjà posé en variable d'environnement machine via `setx`). C'est aussi la raison du `ignoreHTTPSErrors: true` dans `playwright.config.ts`. Si l'auth e2e échoue localement avec une erreur certificat, vérifier cette variable avant de chercher ailleurs.

**Avast bloque aussi les binaires Go (Supabase CLI) — sans remède env** — Le certificat MITM d'Avast échoue au contrôle de révocation (`CRYPT_E_NO_REVOCATION_CHECK`) : `npx supabase link/db pull` échouent en local avec un message quasi vide (« Try rerunning with --debug », qui n'affiche rien de plus). `--use-system-ca` ne s'applique qu'à Node. Contournement : `scripts/query-supabase.mjs` (Node + API de management) pour tout ce qui est lecture/SQL distant ; les commandes CLI réseau ne tournent qu'en CI.

### Conventions de code observées

**Tout est en français** — Noms de variables, fonctions (`genererPlanning`, `choisirAleatoire`, `sAbonner`), commentaires, messages d'erreur et textes UI. Les commentaires citent les règles métier (`RG-xx`) et user stories (`US-xx`) de `SPECS_FONCTIONNELLES.md`. Du code en anglais détonnerait — suivre l'existant.
