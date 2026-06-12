# Architecture Decision Record — Webapp Repas de la semaine

> Version : 1.1
> Date : 2026-06-03
> Statut : **Validé** (Phase 2 — Architecture & Stack)
> Auteur : Arnaud Solente

---

## Contexte général

Projet personnel : webapp de génération automatique de plannings de repas hebdomadaires.
Usage solo (1 utilisateur), mobile-first, déployée sur internet.
Profil de développement : vibe coding (pilotage par LLM, pas de compétences techniques propres).

Les décisions ci-dessous ont été prises en tenant compte de ce profil : popularité des technos auprès des LLMs, simplicité de déploiement, conventions fortes, communauté large.

---

## ADR-01 — Framework full-stack : Next.js 14 (App Router)

### Contexte
Il faut un framework capable de gérer à la fois les pages (frontend) et la logique serveur (backend léger). Le projet est une webapp classique — pas une SPA pure, pas une app mobile native.

### Décision
**Next.js 16 avec l'App Router.**

> [RÉVISION - ADR-01 — 2026-06-03] La planification visait Next.js 14. `create-next-app@latest` a installé Next.js 16.2.7 (version courante). Les concepts, l'App Router et les conventions sont identiques. Pas de migration nécessaire.

### Justification
- React est la librairie frontend la plus connue au monde — Next.js est son framework de référence. Claude (et tous les LLMs majeurs) le connaît mieux que n'importe quel concurrent.
- L'App Router (architecture introduite en Next.js 13) est le standard actuel : toutes les ressources récentes l'utilisent, ce qui réduit le risque d'hallucination du LLM.
- Next.js est "full-stack" : il gère les pages et les API dans un seul projet, sans avoir à configurer deux dépôts séparés.
- Déploiement natif et optimisé sur Vercel (même équipe à l'origine des deux).
- TypeScript activé par défaut — ajoute de la fiabilité au code généré par LLM.

### Alternatives écartées
- **Remix** : excellent, mais communauté plus petite = moins bien couvert par les LLMs.
- **Nuxt (Vue.js)** : bon choix, mais React a une avance significative sur la connaissance des LLMs.
- **SvelteKit** : montant, mais trop peu représenté dans les données d'entraînement des LLMs actuels.

---

## ADR-02 — Base de données & Auth : Supabase

### Contexte
Il faut stocker les données utilisateur (recettes personnalisées, plannings) et gérer l'authentification à terme. Écrire un backend complet from scratch dépasse le périmètre d'un projet vibe coding solo.

### Décision
**Supabase comme BaaS (Backend-as-a-Service).**

### Justification
- PostgreSQL managé : une vraie base de données relationnelle, pas un NoSQL bricolé. Les données du projet (recettes, ingrédients, planning) sont relationnelles par nature.
- Auth intégrée : inscription, connexion, gestion de session — sans écrire une ligne de code d'auth.
- Row Level Security (RLS) : isolation des données par utilisateur gérée côté base de données, pas côté application. Plus sûr, moins de surface d'erreur.
- SDK JavaScript simple et bien documenté — compatible avec l'approche vibe coding.
- Dashboard visuel pour inspecter les données sans écrire du SQL.
- Tier gratuit généreux pour un usage personnel.

### Note d'implémentation
Pour le MVP (Phase 3–5), les recettes sont stockées dans `/data/recettes.json` et le planning en `localStorage`. Supabase entre en jeu à la Phase 4 pour l'auth et la persistance multi-device. Ce choix est anticipé dès maintenant pour ne pas avoir à refactoriser l'architecture plus tard.

> [RÉVISION - ADR-02 — 2026-06-03] Le client Supabase est scindé en deux fichiers plutôt qu'un seul `lib/supabase.ts` :
> - `lib/supabase/client.ts` — client navigateur (Client Components), utilise `createBrowserClient`
> - `lib/supabase/server.ts` — client serveur (Server Components, API Routes), utilise `createServerClient` avec gestion des cookies
> Cette séparation est imposée par l'App Router de Next.js : les deux contextes d'exécution (navigateur / serveur) nécessitent des clients différents pour la gestion des sessions.

> [NOTE PRODUCTION - 2026-06-03] La confirmation email Supabase Auth est désactivée en développement pour accélérer les tests. À réactiver dans Supabase → Authentication → Providers → Email → "Confirm email" avant tout déploiement en production.

> [RÉVISION - ADR-02 — 2026-06-07] Bascule de la source de vérité des recettes du JSON statique vers Supabase (#2), avec un modèle **hybride** : un **catalogue global** (recettes `user_id IS NULL`, visibles de tous, en lecture seule) sert de base commune, et chaque utilisateur ajoute ses **recettes personnelles** (`user_id = auth.uid()`, modifiables par lui seul). Les policies SELECT de `recette` et `recette_ingredient` autorisent donc `user_id IS NULL OR user_id = auth.uid()` ; insert/update/delete restent « propriétaire » (les globales ne sont pas éditables — on les personnalise par duplication). Les 74 recettes de `data/recettes.json` ont été amorcées en globales via migration ; le JSON ne sert plus qu'd'**asset d'amorçage**. La **génération du planning se fait côté serveur** (route `/api/planning/generer`, RLS par session) et renvoie le planning, toujours **persisté en localStorage** (la persistance du planning en base reste hors périmètre). Le **sélecteur** (#14) et le **remplacement aléatoire** lisent la liste côté client (`lib/recettes.ts`).

> [RÉVISION - ADR-02 — 2026-06-11] **Horodatage 100 % serveur (#104)** — solde le caveat « horodatage client » des deux révisions sync ci-dessous. L'`updated_at` de `planning` et `etat_courses` (horloge de référence du last-write-wins) n'est plus posé par le client (`new Date().toISOString()`, soumis aux horloges désynchronisées entre appareils) mais par un **trigger SQL `BEFORE INSERT OR UPDATE`** qui l'écrase avec `now()` (migration `20260611120000_horodatage_serveur.sql`). Contrairement à `default now()`, le trigger couvre aussi les UPDATE/upsert et ignore toute valeur client. `lib/persistance.ts` ne fixe plus `updated_at` mais **récupère et renvoie** la valeur posée par le trigger (via le RETURNING `.select()`, qui reflète les triggers BEFORE) ; `lib/sync.ts` est **inchangé** (il consommait déjà la valeur renvoyée). Comportement observable identique, robustesse accrue dès un usage multi-appareils simultané (ou multi-utilisateurs, #P24).

> [RÉVISION - ADR-02 — 2026-06-08b] **Historique multi-semaines (#5)** — lève le « mono-actif » de la révision sync ci-dessous. La base conserve désormais un planning ET un état de coches **par semaine** (`etat_courses` clé-vé par `(user, semaine)`) ; la sauvegarde devient un **upsert par semaine** (les semaines s'accumulent), borné par une **purge de rétention** (12 semaines glissantes). ~~Le caveat d'horodatage client (#104) demeure.~~ (Soldé par la révision 2026-06-11 ci-dessus.) Navigation/affichage par semaine livrés en PR2.

> [RÉVISION - ADR-02 — 2026-06-12] **Foyer partagé : propriété par foyer + temps réel (#56, P24, US-19/20/21)** — généralise l'app du mono-utilisateur au **partage entre plusieurs comptes d'un même foyer**. (a) **Modèle de propriété par foyer** : les données partagées passent de `user_id` à **`foyer_id`** (tables `foyers`/`profiles` ; modèle « foyer de 1 systématique » : tout compte naît dans son propre foyer via un trigger d'inscription, ce qui évite un double-chemin solo/foyer). Le catalogue global reste `foyer_id IS NULL` ; **`reglages` reste par-utilisateur**. Isolation par **RLS** via un helper SQL **`mon_foyer()`** (`SECURITY DEFINER`) réutilisé par toutes les policies. (b) **Écritures partagées sensibles via RPC `SECURITY DEFINER` transactionnelles** (le foyer est dérivé de `mon_foyer()`, jamais fourni par le client) : `sauvegarder_planning`/`sauvegarder_coches` (atomiques, anti-concurrence cross-device), `generer_code_invitation`/`rejoindre_foyer`/`quitter_foyer` (onboarding/offboarding, RG-29/33/34 — le clonage de sortie est multi-tables tout-ou-rien). **Piège** (#56 PR3) : une fonction `SECURITY DEFINER` à `search_path` figé doit inclure `extensions` pour voir pgcrypto. (c) **Temps réel (Supabase Realtime)** : pour les coches, l'ancien blob JSONB `etat_courses` est remplacé par **une ligne par article** (`etat_courses_article`, RG-32 anti-écrasement) publiée en temps réel ; le `planning` est aussi publié pour l'**alerte intrusive** (US-21). La cohabitation avec le cache « dirty-first » de `lib/sync.ts` distingue un changement distant de l'écho de sa propre écriture par l'horodatage serveur. **Présence** anonyme « en magasin » via Realtime Presence (RG-31). Lève la limite « pas de temps réel » de la révision sync 2026-06-08 ci-dessous (qui demeure vraie pour le **planning**, en last-write-wins, hors alerte).

> [RÉVISION - ADR-02 — 2026-06-08] **Persistance du planning et des coches en base, pour la synchronisation multi-device (#6, US-13)** — lève la dette « persistance hors périmètre » ci-dessus. La **base Supabase devient la source de vérité** du planning actif et de l'état des coches ; **localStorage devient un cache** (lecture/hydratation au chargement, écriture en base à chaque changement). Résolution des écarts entre devices par **last-write-wins horodaté** (`updated_at`), sans temps réel (suffisant pour un usage mono-utilisateur séquentiel). Schéma : `planning_slot` gagne `personnes` (US-07) et `restes` (US-12) ; `planning` gagne `updated_at` ; nouvelle table `etat_courses` (coches en JSONB par utilisateur, RLS propriétaire). **Mono-actif conservé** : un seul planning persisté par utilisateur (delete→insert) ; l'historique multi-semaines reste une feature distincte (#P08). Le **snapshot d'annulation** (`planning_snapshot`, undo #62) reste **local** (transitoire, non synchronisé). Livraison en 3 PR : (1) migration + couche `lib/persistance.ts`, (2) sync du planning, (3) sync des coches.

### Alternatives écartées
- **Firebase (Google)** : NoSQL — moins adapté aux données relationnelles. Vendor lock-in fort.
- **PlanetScale / Neon** : bases de données seules, sans auth intégrée — implique de gérer l'auth séparément.
- **Backend custom (Node/Express)** : trop de code à écrire et à maintenir pour un projet solo en vibe coding.

---

## ADR-03 — Hébergement : Vercel

### Contexte
L'app doit être accessible depuis internet, idéalement avec un déploiement automatique à chaque modification du code.

### Décision
**Vercel.**

### Justification
- Créé par l'équipe qui a créé Next.js — l'intégration est parfaite et sans configuration.
- CI/CD automatique : chaque push sur GitHub déclenche un déploiement en production ou en preview.
- Preview deployments : chaque branche Git a sa propre URL de test. Permet de valider une feature avant de la merger sur `main`.
- Tier gratuit suffisant pour un usage personnel (bandwidth, serverless functions, builds).
- Zero configuration pour Next.js : Vercel détecte le framework et configure tout automatiquement.

### Alternatives écartées
- **Netlify** : très bon, mais moins intégré avec Next.js (certaines features Next.js nécessitent des adaptateurs).
- **Render / Railway** : bien pour du backend Node custom, surdimensionné pour un Next.js simple.
- **VPS (DigitalOcean, OVH)** : contrôle total, mais implique de gérer le serveur soi-même — hors scope vibe coding.

---

## ADR-04 — CSS : Tailwind CSS

### Contexte
Il faut un système de styling cohérent, maintenable sur la durée, et compatible avec du code généré par LLM.

### Décision
**Tailwind CSS v4.**

> [RÉVISION - ADR-04 — 2026-06-03] La planification visait Tailwind v3. `create-next-app@latest` a installé Tailwind v4. Différence principale : plus de `tailwind.config.js` — la configuration (palette, espacements custom) se fait dans `app/globals.css` via la directive `@theme`. Les classes utilitaires (`flex`, `p-4`, `text-lg`…) sont identiques.

### Justification
- Classes atomiques (une classe = une propriété) : pas d'effets de cascade incontrôlés entre composants. Modifier le style d'un élément n'a aucun impact sur le reste.
- Design system intégré : palette de couleurs, espacements, typographie — tout est standardisé. Évite l'incohérence visuelle au fil des features.
- Framework CSS le plus téléchargé sur npm. Claude le connaît très bien — le code généré est fiable et idiomatique.
- Pas de fichiers CSS séparés à gérer : les styles sont dans les composants, ce qui réduit la fragmentation du code.
- Build optimisé : en production, seules les classes réellement utilisées sont incluses — fichier CSS minimal.

### Alternatives écartées
- **CSS Modules** : bonne séparation des concerns, mais verbeux et moins bien couvert par les LLMs.
- **Styled Components / Emotion** : CSS-in-JS — ajoute de la complexité de configuration et des problèmes de performance potentiels avec le Server Side Rendering de Next.js.
- **Bootstrap** : trop opinioné visuellement, personnalisation difficile.

---

## ADR-05 — Tests : Vitest (unit) + Playwright (e2e)

### Contexte
Le projet contient de la logique métier significative (algorithme de génération de planning, agrégation de liste de courses) qui doit être testée. Les parcours utilisateurs critiques doivent aussi être couverts.

### Décision
**Vitest pour les tests unitaires, Playwright pour les tests end-to-end.**

### Justification

**Vitest :**
- Rapide et léger — démarre en millisecondes, pas en secondes.
- Syntaxe identique à Jest (le standard historique) — toute la documentation Jest est transposable.
- Compatible natif avec l'écosystème Vite/Next.js sans configuration complexe.

**Playwright :**
- Standard de l'industrie pour les tests e2e en 2024–2026.
- Intégration VS Code native : on peut voir les tests s'exécuter visuellement.
- Multi-navigateurs (Chromium, Firefox, WebKit) dans une seule suite de tests.
- Générateur de tests : Playwright peut enregistrer des interactions et générer le code de test automatiquement.

### Stratégie de test (pour ce projet)
- **Tests unitaires (Vitest)** : 100% de couverture sur la logique métier — générateur de planning, agrégateur de courses.
- **Tests e2e (Playwright)** : parcours critiques uniquement — génération d'un planning, remplacement d'un repas, affichage de la liste de courses.
- **Tests manuels** : checklist QA avant chaque déploiement.

> [RÉVISION - ADR-05 — 2026-06-12] **Multi-device, multi-comptes & RPC sensibles (#56, P24)** — trois ajouts à la stratégie de test pour le foyer partagé : (a) les comportements **temps réel** (US-20/US-21) se testent en e2e avec **deux contextes navigateur** = deux appareils du même foyer (`coches-realtime.spec`, `alerte-planning.spec`) ; (b) les parcours qui **changent le foyer** (jonction/sortie/clonage, RG-33/RG-34) sont destructifs pour le **compte de test partagé** (un vrai quit changerait son `foyer_id` et casserait les autres specs) → on les teste avec des **comptes JETABLES dédiés**, créés à la volée (signup REST + login UI, emails uniques par run), totalement disjoints du compte partagé (`foyer-clonage.spec`). Ces comptes **ne sont pas supprimés** (la clé anon ne le permet pas — il faudrait la service_role) : accumulation **assumée** sur staging, foyers isolés sans impact. (c) En complément, la logique fine d'une RPC serveur peut être validée par un **test SQL en transaction `rollback`** (impersonation JWT via `set local request.jwt.claims`) sur staging/prod — utilisé pendant le dev de `quitter_foyer` pour asserter chaque table clonée. **Leçon** (#56 PR3) : une fonction définie par migration mais jamais exécutée peut cacher un bug jusqu'au premier appel — d'où l'intérêt d'un e2e qui l'exerce (ou, à défaut, de la vérification SQL ciblée).

---

## ADR-06 — Versioning : Git + GitHub

### Contexte
Le code doit être versionné, sauvegardé hors de la machine locale, et permettre de revenir en arrière en cas d'erreur.

### Décision
**Git en local, dépôt distant sur GitHub.**

### Justification
- Git est l'outil de versioning universel — pas d'alternative crédible.
- GitHub est la plateforme de référence : intégration Vercel native, GitHub Actions pour CI/CD futur, GitHub Projects pour le backlog.
- Permet le workflow branches → PR → merge qui sera pratiqué dès la Phase 3.

---

## Structure de dossiers cible

```
webapp-repas/
│
├── app/                        # Pages (App Router Next.js)
│   ├── layout.tsx              # Layout global
│   ├── page.tsx                # Accueil (route "/")
│   ├── planning/
│   │   └── page.tsx            # Planning (route "/planning")
│   └── courses/
│       └── page.tsx            # Liste de courses (route "/courses")
│
├── components/
│   ├── ui/                     # Composants génériques (bouton, badge, carte...)
│   └── planning/               # Composants spécifiques au planning
│
├── lib/                        # Logique métier pure (sans UI)
│   ├── generateur.ts           # Algorithme de génération du planning
│   ├── courses.ts              # Agrégation de la liste de courses
│   └── supabase.ts             # Client Supabase (Phase 4)
│
├── data/
│   └── recettes.json           # Source de vérité des recettes (MVP)
│
├── types/
│   └── index.ts                # Types TypeScript partagés
│
├── public/                     # Assets statiques
│
├── .env.local                  # Secrets — JAMAIS dans Git
├── .env.example                # Template des variables d'env — dans Git
├── .gitignore                  # Fichiers ignorés par Git
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── CLAUDE.md
```

---

## ADR-07 — Typage statique : TypeScript strict

### Contexte
Next.js active TypeScript par défaut. La question est de savoir si on l'utilise en mode permissif ou en mode strict.

### Décision
**TypeScript en mode strict activé sur tout le projet.**

### Justification
Le code de ce projet est généré en majorité par un LLM. TypeScript strict force le LLM à typer explicitement chaque variable, chaque paramètre, chaque retour de fonction — ce qui réduit les erreurs silencieuses (une variable qui peut être `undefined` sans que le code le gère, par exemple). Sans strict, TypeScript laisse passer des approximations que le LLM produit naturellement.

Les types métier du projet sont déjà définis dans `SPECS_FONCTIONNELLES.md` (`Recette`, `Ingredient`, `Planning`...) et centralisés dans `types/index.ts`. TypeScript strict garantit que le code généré les respecte sans dérive.

### Conséquence pratique
`tsconfig.json` doit contenir `"strict": true`. Ne pas le désactiver même si le compilateur remonte des erreurs — corriger les erreurs plutôt que de désactiver la règle.

---

## ADR-08 — Stratégie d'environnements

### Contexte
Le code s'exécute dans des contextes différents selon le moment : en local pendant le développement, sur une URL de preview pour valider une feature, en production pour l'usage réel. Ces contextes ne doivent pas partager les mêmes données ni les mêmes configurations.

### Décision
**Trois environnements distincts : local, preview, production.**

| Environnement | Où | Variables d'env | Base Supabase |
|--------------|-----|----------------|---------------|
| Local | Machine de dev | `.env.local` | Instance de dev (Phase 4) |
| Preview | Vercel (par branche) | Dashboard Vercel — Preview | Instance de dev (Phase 4) |
| Production | Vercel (branche `main`) | Dashboard Vercel — Production | Instance de prod (Phase 4) |

### Justification
Tester directement en production est la principale source d'incidents sur les projets solo. Les preview deployments de Vercel (une URL par branche Git) permettent de valider une feature dans un environnement identique à la prod, sans toucher aux données réelles.

La séparation des bases Supabase (dev/prod) n'est pas mise en place dès le MVP (les données sont en JSON et localStorage), mais l'architecture doit l'anticiper pour ne pas avoir à tout reconfigurer en Phase 8.

### Conséquence pratique
- Jamais de test directement sur `main` / l'URL de production
- Chaque feature se valide sur sa branche → preview deployment → merge si OK
- Les variables d'environnement sont configurées séparément dans le dashboard Vercel pour Preview et Production

---

## ADR-09 — Identité & onboarding (#22)

### Contexte
Après l'auth brute (email/mdp → app), il manquait une page « mon compte », une boucle d'activation pour les nouveaux inscrits, et la gestion du cycle de vie du compte (déconnexion, mot de passe). L'épopée Foyer (#56) avait déjà introduit `profiles`/`foyers`.

### Décision
- **Séparation `/profil` (identité) vs `/reglages` (génération)** : `/profil` regroupe prénom, **avatar**, **foyer** (panneau déplacé depuis `/reglages`), sécurité (mot de passe) et déconnexion ; `/reglages` ne garde que la configuration de génération. La nav mène à `/profil` par l'avatar (l'engrenage disparaît).
- **Avatar « zéro upload »** : disque à initiale + couleur dérivée de l'email (déterministe), modifiable parmi une palette fixe. Aucune dépendance externe ni stockage d'image.
- **Tunnel d'onboarding `/bienvenue`** (2 écrans) terminé par la **génération du premier planning**. **Garde dans le `proxy`** : lecture de `profiles.onboarding_complete` (une requête par navigation connectée — coût assumé en usage perso) qui redirige vers le tunnel tant qu'il n'est pas terminé. `/api/*` et `/auth/*` exemptés ; **fail-open** sur erreur (jamais de boucle).
- **Pas de nouveau champ « taille du foyer »** : l'onboarding initialise `reglages.personnes_defaut` (la base de mise à l'échelle reste figée à 2, RG-16).
- **Écriture du profil par le client = GRANT au niveau colonne** (`prenom`, `couleur_avatar`, `onboarding_complete`) plutôt qu'une simple policy RLS : empêche le client de réécrire `foyer_id` (contournement de RG-29) tout en laissant les RPC `SECURITY DEFINER` libres.
- **Deep-link d'acquisition** : le lien d'invitation pointe vers `/signup?code=` ; le code survit au flux d'auth via `sessionStorage` (le `proxy` préserve le paramètre à travers ses redirections).
- **Mot de passe** : « oublié » via email Supabase (`resetPasswordForEmail` → `/auth/reinitialiser`) ; changement gardé par ré-authentification. **Config templates email = action manuelle dashboard** (cf. issue dédiée).

### Justification
Aligne le modèle mental utilisateur (« qui je suis » vs « comment l'app génère »), supprime l'écran vide post-inscription (activation), et boucle l'acquisition (un invité sans compte atterrit dans le bon foyer). Le coût d'une requête proxy par navigation est négligeable pour un usage personnel et garde une source de vérité unique (pas de duplication du drapeau dans le JWT).

### Alternatives écartées
- **Avatars abstraits (DiceBear) avec choix de forme** : dépendance externe pour une valeur d'identité équivalente aux initiales.
- **Drapeau `onboarding_complete` dans le JWT** (au lieu d'une requête proxy) : double source de vérité à synchroniser, pour un gain négligeable en usage perso.
- **`taille_foyer` sur `foyers`** : redondant avec `personnes_defaut`, en conflit avec la base figée de mise à l'échelle (RG-16).

---

## Règles transversales

### Gestion des secrets
- `.env.local` contient les vraies valeurs — toujours dans `.gitignore`
- `.env.example` contient les noms des variables sans valeur — commité dans Git
- `.gitignore` configuré **avant** le premier `git add` — sans exception
- En production (Vercel) : variables d'environnement configurées dans le dashboard Vercel, jamais dans le code

### Convention de commits
Format : `type: description courte`

| Type | Usage |
|------|-------|
| `feat:` | Nouvelle fonctionnalité |
| `fix:` | Correction de bug |
| `chore:` | Tâche de maintenance (dépendances, config) |
| `refactor:` | Réécriture sans changement de comportement |
| `test:` | Ajout ou modification de tests |
| `docs:` | Documentation uniquement |

### Workflow Git
- `main` = branche de production, toujours déployable
- Une branche par feature : `feat/generation-planning`, `feat/liste-courses`
- Jamais de commit direct sur `main`

---

*Ce document est la référence d'architecture pour toute la durée du projet. Toute modification de stack doit être documentée ici avec la mention `[RÉVISION - ADR-XX]` et la date.*
