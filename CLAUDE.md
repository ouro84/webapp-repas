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

**Polices : pairing rond Fredoka + Nunito, pas Geist (#66 P14)** — Trois familles chargées via `next/font/google` dans `app/layout.tsx`, exposées en tokens `@theme` de `globals.css` : **Nunito** = corps (`--font-sans`, appliqué par `body`), **Fredoka** = display (`--font-display` → classe utilitaire `font-display`), **Geist_Mono** = mono (`--font-mono`), **conservé uniquement** pour le digest d'erreur (`app/error.tsx`). `Geist` (sans) a été **retiré**. La display ne s'applique **délibérément** qu'au niveau marque + titres de page : wordmark de la nav, hero d'accueil et **`h1`** (planning, courses, recettes, réglages, formulaires auth/recette) — **pas** les `h2` de section/dialog, qui restent en corps pour la scannabilité. Ces titres display sont en **`font-semibold`** (les rondes paraissent lourdes en 700). Ajouter une display sur un `h2` fonctionnel = dévier de cette convention.

**Design system maison, pas la palette Tailwind** — Trois palettes custom : `brand-*` (vert), `accent-*` (terracotta, échelle `50/100/500/600/700/800`), `canvas` (fond crème). Les boutons principaux sont `rounded-full bg-brand-600 hover:bg-brand-700`. Utiliser `green-600` ou `bg-white` pour du brand casse la cohérence visuelle. **Sémantique des couleurs (#67 P15)** : l'**accent terracotta** est l'épice de marque — réservé à des touches précises : badges temps « normal »/« long » (`badge-temps.tsx`), badge accompagnement féculents, et la section **« Fond de placard »** de la liste de courses (catégorie « placard/épice », `app/courses/page.tsx`). Le **vert reste la couleur interactive** (hovers, liens, boutons) — ne pas teinter les hovers génériques en accent. Les **états sémantiques** utilisent les palettes Tailwind standard : `red-*` = erreur (cf. `app/error.tsx`), `amber-*` = avertissement/prudence (confirmation de suppression, réglages infaisables, vivier insuffisant). Ne pas repeindre ces `amber` en accent : `amber = prudence` est distinct de `accent = marque`.

**Logo + icônes : SVG, pas d'emoji (#59)** — L'app s'appelle **« On mange quoi ? »** (baseline « La question du soir a enfin sa réponse »). Le logo est `components/ui/logo.tsx` (mark assiette+fourchette en négatif, `fill="currentColor"`, décoratif `aria-hidden` — le nom est en texte à côté) ; sa couleur se pilote par `text-brand-*`. Favicon = `app/icon.svg` (palette brand-600, sans `currentColor` car hors contexte CSS) ; image OG = `app/opengraph-image.png`. Source vectorielle d'archive : `revueDesign/` (non versionné). **Règle no-emoji-icons** : pas d'emoji ni de glyphe Unicode comme icône — utiliser un SVG inline ou **`lucide-react`** (ex. `RefreshCw` pour « changer », tree-shakable).
**Dark mode : override de tokens + tokens sémantiques, pas un flip (#72 P19)** — Les utilitaires Tailwind v4 compilent en `var(--color-*)` (vérifié) → le dark mode **redéfinit les valeurs** des tokens dans `:root[data-theme="dark"]` de `globals.css`, sans toucher aux composants. **Piège central** : l'échelle brand/accent est **surchargée** — un même step sert de **texte** (`text-brand-700/900`) ET de **fond de bouton/scrim** (`bg-brand-600`, `hover:bg-brand-700`, `backdrop:bg-brand-900/50`). Flipper la rampe casserait les boutons (texte blanc sur vert clair). On a donc extrait des **tokens sémantiques** : **`--color-surface`** (remplace `bg-white` partout — ne pas réintroduire `bg-white`, utiliser `bg-surface`), **`--color-primary`/`--color-primary-hover`** (boutons d'action : `bg-primary`/`hover:bg-primary-hover`, pas `bg-brand-600`), **`--color-danger`/`-hover`** (bouton destructif, libère `red-*` pour le texte d'erreur). Les backdrops de dialog sont en `backdrop:bg-black/50`. Le **thème** vit dans `lib/theme.ts` (store `useSyncExternalStore`, clé localStorage `theme` ∈ clair/sombre/système) + `components/ui/bascule-theme.tsx` (nav) ; un **script anti-FOUC** dans `app/layout.tsx` (premier enfant du `<body>`, `<html suppressHydrationWarning>`) résout la préférence et pose `data-theme` **avant le paint** (« système » → `prefers-color-scheme`). Encadrés d'état : `red-*`/`amber-*` ont des **variantes sombres dédiées** dans le bloc dark. Pour ajouter une couleur, penser aux **deux modes** et vérifier le contraste (≥ 4.5:1).

**PWA : manifest Next + jeu d'icônes généré, pas de service worker (#71 P18)** — `app/manifest.ts` (convention App Router → servi en `/manifest.webmanifest`, `<link rel="manifest">` **auto-injecté** par Next, ne pas l'ajouter à la main dans `layout.tsx`). `theme_color` est posé via `viewport.themeColor` (pas dans le manifest seul). Les **icônes PNG** (`public/icons/*` + `app/apple-icon.png`) sont **générées** par `scripts/generer-icones-pwa.mjs` (sharp) — **miroir** de `app/icon.svg` (lit ses paths) : si le mark change, **relancer le script** (ne pas éditer les PNG à la main). Trois `purpose` distincts dans le manifest : `any` (mark blanc sur vert), `maskable` (zone de sécurité, icône adaptative Android) et **`monochrome`** (mark blanc sur **transparent** — l'alpha sert de masque, le launcher Android applique sa propre teinte ; couleur du PNG ignorée). **iOS ignore le manifest** pour l'écran d'accueil → c'est `app/apple-icon.png` (auto-lié en `apple-touch-icon`) + `metadata.appleWebApp` qui font foi. **Pas de service worker** (volontaire) : `next start` fige le listing de `public/` au boot (un fichier ajouté après démarrage renvoie 404 en local jusqu'au redémarrage — pas un bug de prod). L'offline complet = chantier séparé.

**État actif de nav : helper `estActif`, accueil en égalité STRICTE (#73 P20)** — `components/ui/nav.tsx` centralise l'activité dans `estActif(pathname, href)` : **`/` se teste en égalité stricte** (`pathname === "/"`), les sections (`/planning`, `/courses`, `/reglages`…) en `startsWith`. **Piège** : utiliser `startsWith` pour l'accueil matcherait **toutes** les routes → le logo paraîtrait toujours actif. Le logo actif porte une **pastille `bg-brand-50`** (cohérente avec les liens actifs) + `aria-current="page"` ; la pilule entoure le mark **et** le wordmark pour rester perceptible sur mobile (wordmark masqué sous `sm:`). Ne pas retomber sur `startsWith("/")` ni dupliquer la logique d'activité ailleurs — passer par `estActif`.

**Micro-interactions : tokens `@theme` + reset reduced-motion global (#69 P17)** — Les animations sont des **tokens** `--animate-apparition` / `--animate-crossfade` / `--animate-spin-once` (+ `@keyframes` dans `globals.css`), exposés en utilitaires `animate-*` par Tailwind v4 — **transform/opacity only** (pas de width/height → pas de reflow). Un **reset global** `@media (prefers-reduced-motion: reduce)` dans `globals.css` réduit toutes les animations/transitions à l'instantané (filet de sécurité couvrant aussi `animate-pulse`/spinner/View Transitions) ; les composants ajoutent en plus les variantes `motion-safe:` / `motion-reduce:`. **Piège du stagger** : la génération **ne vide pas l'écran** (#63) → les `<li key={jour}>` ne se re-montent pas seuls, donc une animation de montage **ne se rejoue pas** sur regénération. Parade : un **nonce `genNonce`** (state) bumpé uniquement dans `genererNouveauPlanning`, utilisé comme `key` des deux grilles (mobile + desktop) pour forcer le remontage et rejouer l'apparition — **pas** bumpé sur un remplacement de slot / changement de personnes (sinon toute la grille re-animerait à chaque édition). Le **feedback `active:scale`** des boutons utilise l'utilitaire **`transition`** (pas `transition-colors`) car il anime couleur **et** transform ensemble ; appliqué aux boutons d'action (CTAs, actions de slot, steppers, modales, submit), **pas** aux switches (déjà animés par le glissement du knob) ni aux liens de nav / lignes de liste.

**Hero d'accueil = aperçu décoratif, pas de vraies données (#68 P16)** — `app/page.tsx` insère `components/ui/apercu-planning.tsx` entre la tagline et le CTA : une mini-grille de 3 cartes repas **factices**. Le composant est `aria-hidden` (les lecteurs d'écran s'appuient sur le `h1` + tagline, pas sur ces faux plats) et **non interactif** (le nom est un simple texte, contrairement aux vraies cartes du planning où c'est un bouton vers la fiche). Il **réutilise** `BadgeTemps` / `BadgeVegetarien` pour rester fidèle au rendu réel — ne pas réinventer un style de carte ici. Pas d'animation : le stagger/entrée est le périmètre de #69 (P17).

**Bottom sheet + clavier mobile : double parade (#98)** — Un `<dialog>` ancré en bas (`mb-0` + `max-h-[Ndvh]`, cf. `SelecteurRecette`) glisse **derrière le clavier** sur mobile : `dvh` suit la chrome du navigateur, **pas** le clavier. Deux correctifs **complémentaires** (l'un sans l'autre laisse une plateforme cassée) : (1) **Android/Chrome** → `export const viewport: Viewport = { interactiveWidget: "resizes-content" }` dans `app/layout.tsx` (le clavier réduit le viewport de layout) ; (2) **iOS/Safari** (n'implémente pas `interactive-widget`) → `useClavierVirtuel()` de `lib/clavier.ts` (store `useSyncExternalStore` sur `window.visualViewport`) renvoie `{ hauteurClavier, hauteurVisible }` ; le sélecteur applique alors un `style` inline (`marginBottom` + `maxHeight`) qui soulève et borne le sheet au-dessus du clavier. Clavier fermé / desktop / SSR → `{0,0}`, aucun style, comportement par défaut inchangé. Cœur de calcul pur testable : `hauteurOccultee()` (jsdom n'a pas `visualViewport`).

**Saisonnalité = filtre DUR à dégradation gracieuse, pas un simple biais (#23 P12)** — `Recette.saisons?: Saison[]` (**optionnel**, absent/vide = **toute l'année** — pas de contrainte ; DB `saisons text[]` nullable + CHECK `<@`). Cœur pur `lib/saisons.ts` : `saisonDuMois` (RG-02), `estDeSaison`, table **produit→saisons** (~26 produits) + `suggererSaisons` (= **intersection** des saisons des produits saisonniers ; aromates/produits de garde absents de la table = toute l'année ; intersection vide ⇒ toute l'année). `saisonDeSemaine(semaine)` vit dans `lib/semaines.ts` (saison du **jeudi**). **Tagging du catalogue global** : migration `..._recette_saisons.sql` avec UPDATEs **par nom** (noms uniques, vérifié) **générés par `scripts/generer-saisons-recettes.mjs`** — ce script est un **miroir JS** de la table `PRODUITS_SAISON` de `lib/saisons.ts` : toute évolution de la table doit être faite des deux côtés puis régénérée (même esprit que le jumeau SQL de #49). **Génération (PR2)** : à la différence des biais souples végé/mix, la saison est un **filtre dur** — mais implémenté comme un biais **avec repli** (`biaiserSaison`, repli sur tout si le vivier de saison ne suffit pas), ce qui réalise la **dégradation gracieuse** et préserve l'invariant « la génération n'échoue jamais ». **Inversion de défaut à noter** : le réglage `saisonnalite` sera **ON par défaut** (`saisonnalite !== false`, DB `default true`), à l'inverse de `vegetarienPrefere`/`mixAccompagnementJour` (absent = OFF). **RG-03 #23** : la sélection manuelle (`remplacerSlotManuel`) n'est **pas** filtrée. Badge `components/ui/badge-saison.tsx` (style outline pour se distinguer des badges pleins végé/accompagnement). **PR2 (livré)** : `biaiserSaison` composé **en premier** (avant végé/mix) dans `genererPlanning` (saison ← `semaine`) et `remplacerSlot` (saison ← `planning.semaine`) ; avertissement dérivé `reposNonSaison(planning, reglages)` → route renvoie `saisonNonHonore`, toast (génération + « ↺ changer »). Interrupteur `role="switch"` « Ne proposer que des recettes de saison » sur `/reglages`, **ON par défaut**.

**Mix « ≥1 légume/jour » = contrainte JOINTE par jour, pas un biais par slot (#49 PR2)** — `ReglagesGeneration.mixAccompagnementJour?` (**un seul** booléen pour toute la semaine, ≠ les 4 booléens végé par créneau ; DB `mix_accompagnement_jour not null default false`, migration `..._reglages_mix_accompagnement.sql` ; **absent de `REGLAGES_DEFAUT`** = désactivé). Contrairement à `biaiserVege` (par slot, indépendant), le mix **couple les deux slots d'une journée**. `biaiserMixLegume(candidats, jour, attributions, reglages)` dans `lib/generateur.ts` est en **deux temps** : jour pas encore pourvu d'un légume → biais **vers** légume (repli souple) ; jour déjà pourvu → **anti-biais** (préférence **non**-légume) pour **préserver le vivier légume aux jours non encore servis** — sans cet anti-biais, le 2ᵉ slot d'un jour déjà honoré peut « voler » le dernier légume d'un autre jour (vu en test : samedi affamait dimanche). Composé **après** `biaiserVege` dans `genererPlanning` (végé prioritaire en cas de conflit) ; même biais dans `remplacerSlot` (regarde le repas **frère** du jour). Les deux branches replient toujours et restent dans le même palier de temps → **faisabilité (`analyserVivier`/Hall) inchangée**, la génération n'échoue jamais à cause du mix. Avertissement **dérivé du planning final** par `joursSansLegume(planning, reglages)` (pur, découplé de l'aléatoire) : la route renvoie `mixNonHonore` (nb de jours), le client toast ; le « ↺ changer » toast aussi si le jour reste sans légume. Réglage : un `role="switch"` « Au moins un repas légumes par jour » sur `/reglages` + aperçu « N recettes légumes ».

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

**Flag végétarien (#86 PR1)** — `recette.vegetarien` (colonne DB, **`Recette.vegetarien?` optionnel** côté domaine — absent = false, comme `personnes?`/`restes?`). Le **catalogue global** (non éditable) est tagué par **heuristique** dans la migration `..._recette_vegetarien.sql` : végé = aucun ingrédient en catégorie `viandes-poissons` (l'`UPDATE` couvre aussi un rejeu sur base neuve, après le seed). Le formulaire **pré-coche** par la même heuristique à la création (`vegeTouche` distingue suggestion auto vs choix manuel). Affichage via `components/ui/badge-vegetarien.tsx` (lucide `Leaf` ; `compact` = icône seule + `aria-label` pour la card, sinon pastille texte).

**Flag accompagnement = heuristique de NOM, double implémentation JS/SQL à garder synchro (#49 PR1)** — `recette.accompagnement?: "feculents" | "legumes"` (colonne DB nullable, **`Recette.accompagnement?` optionnel** côté domaine — absent = non caractérisé, comme `vegetarien?`/`personnes?`). Tagging **impossible par catégorie d'ingrédient** (contrairement au végé : il n'existe **pas** de catégorie `féculents` — riz/pâtes sont en `epicerie` — et `legumes-fruits` mêle légumes, aromates et fruits, et y range pommes de terre qui sont des féculents ; les légumes surgelés vivent en `surgeles`). On tague donc par **nom d'ingrédient** : cœur pur `lib/accompagnement.ts` (`suggererAccompagnement`, deux regex `FECULENTS_RX`/`LEGUMES_RX`, **priorité au féculent** : « riz + tomates » → féculent). **Piège** : la migration `..._recette_accompagnement.sql` ré-implémente la **même règle en SQL** (regex `~` + `translate()` pour désaccentuer comme `normalize`, `\b`→`\y`) pour auto-taguer le catalogue global — **toute évolution des motifs doit être faite des deux côtés** (même contrat que le végé). Heuristique volontairement imparfaite et « à compléter ». Le formulaire **pré-suggère** par la même fonction (`accompTouche` distingue suggestion auto vs choix manuel). Badge `components/ui/badge-accompagnement.tsx` (lucide `Wheat`=féculent terracotta `accent`, `Carrot`=légume vert `brand` ; `compact` = icône seule + `aria-label`). **Le réglage « ≥1 légume/jour » et le biais de génération sont #49 PR2** — ne pas les inventer ici.

**Préférence végé par créneau = biais souple, jamais une contrainte (#86 PR2)** — `ReglagesGeneration.vegetarienPrefere?` (4 booléens par créneau, **optionnel** : absent = aucune préférence, comme `vegetarien?` lui-même ; côté DB 4 colonnes `vege_*` requises `not null default false`, migration `..._reglages_vegetarien.sql`). La génération biaise le tirage : `biaiserVege(eligibles, …)` restreint aux éligibles végé **si le créneau le demande ET qu'il en reste**, sinon repli sur tous les éligibles. **Point clé de non-régression** : le biais choisit dans le **même palier de temps**, donc la faisabilité (Hall) et `analyserVivier` sont **inchangées** — `genererPlanning` n'échoue jamais à cause de la préférence. À palier de contrainte égal, les slots végé-préférés sont triés **en premier** (meilleur honoring). Même biais appliqué à `remplacerSlot` (Q4). L'avertissement est **dérivé du planning final** par `slotsVegeNonHonores(planning, reglages)` (pur, découplé de l'aléatoire) : la route renvoie `vegeNonHonore` (nb), le client toast ; le « ↺ changer » toast aussi si le créneau végé reçoit du non-végé. Réglages : 4 interrupteurs (`role="switch"`) dans `app/reglages/page.tsx` + aperçu B2 « N recettes végé éligibles ». `REGLAGES_DEFAUT` **n'inclut pas** `vegetarienPrefere` (= pas de préférence) — ne pas l'y ajouter, ça changerait le défaut.

**Génération côté serveur, liste côté client** — La génération passe par `POST /api/planning/generer` (lit les recettes sous RLS, applique `lib/generateur`, renvoie le planning ; le client le persiste en localStorage). Mais le sélecteur (#14) et le « ↺ changer » ont besoin de la liste : ils la chargent via `lib/recettes.ts` (client). Deux accès distincts, c'est voulu.

**La fiche de recette lit le slot, pas Supabase (US-10)** — La recette complète (avec ses ingrédients) est déjà dans le planning persisté : `FicheRecette` s'affiche directement depuis l'objet du slot, sans appel réseau ni état loading. Déclencheur = le **nom du plat** (un `<button>`), pas la card entière — elle porte déjà changer/sélectionner/stepper (pas d'imbrication d'interactifs). Les quantités sont mises à l'échelle via les mêmes helpers que la liste de courses (`facteurEchelle`/`arrondirQuantite` de `lib/personnes`, formatage `lib/unites.ts`) → ne pas réimplémenter, sous peine de diverger. Le raccourci « Modifier » n'apparaît que pour une recette **perso** : l'éditabilité vient de `chargerRecettesGerees()` (la page planning charge cette variante, pas `chargerRecettes`, pour disposer du flag `editable`). **Pas de champ saisonnalité dans le modèle** : c'est le backlog #P12 — ne pas inventer le champ.

**`useSearchParams` exige une frontière `<Suspense>` (Next 16)** — Le deep-link d'édition `/recettes?edition=<id>` (depuis la fiche) lit le query param via `useSearchParams` ; sans `<Suspense>` parent, le build casse. `app/recettes/page.tsx` isole donc le contenu dans `ContenuRecettes`, l'export par défaut l'enveloppe. L'ouverture du formulaire se fait dans le `.then()` du chargement (pas en synchrone dans l'effet → règle `set-state-in-effect`).

**Les e2e de génération ne valident qu'en CI** — En local, les e2e tapent l'instance de `.env.local` (prod), qui n'a le catalogue global que si la migration y a été appliquée (au merge). Le catalogue est seedé sur **staging** par la CI (migration avant e2e), donc les parcours de génération sont fiables en CI mais peuvent échouer en local si la base pointée n'est pas seedée.

**Les e2e CRUD recettes écrivent en base** — `e2e/recettes.spec.ts` crée de vraies recettes (nom suffixé par le `Date.now` du run, pour l'identification et éviter les collisions strict-mode). Un `afterAll` les supprime toutes (recherche par suffixe + suppression via l'UI) → pas d'accumulation sur le compte de test. **Ne pas lancer `recettes.spec` en local** : `.env.local` pointe la prod, ça y créerait (transitoirement) des recettes ; si le teardown échoue, elles y resteraient. Validation en CI (staging).

### Logique métier (`lib/generateur.ts`)

**14 repas, éligibilité par slot (jour × type de repas), paramétrée (#45)** — Depuis #3, la génération produit un déjeuner ET un dîner chaque jour (14 slots). L'éligibilité (RG-01) dépend du jour **et** du type de repas. Depuis #45, elle est **pilotée par les réglages utilisateur** : `tempsEligibles(jour, typeRepas, reglages)` = `tempsAuPlafond(plafondSlot(...))`, càd toutes les recettes dont le temps est **≤ plafond** du créneau (ordre `rapide < normal < long`, cf. `lib/reglages.ts`). `estEligible` prend donc `(recette, jour, typeRepas, reglages)`, et `genererPlanning`/`remplacerSlot`/`analyserVivier` acceptent `reglages` en **dernier param optionnel** (défaut `REGLAGES_DEFAUT` = ancien comportement : dîner semaine `rapide`, déjeuner semaine `normal`, week-end `long`). Ne pas retomber sur les anciennes signatures.

**Réglages de génération : modèle « plafond », deux accès, personnes découplé (#45)** — Cœur **pur** dans `lib/reglages.ts` (importable par le générateur, sans Supabase) ; **accès données** dans `lib/reglages-data.ts` (client, RLS) **et** lecture serveur **inline** dans `app/api/planning/generer/route.ts` — même dichotomie que les recettes (#2). Trois pièges : (1) « durée max » = **catégorie plafond** (`rapide/normal/long`), **pas des minutes** (le modèle de recette n'a pas de durée numérique). (2) Le **nombre de personnes par défaut** est estampillé sur les slots **à la génération** ; il ne touche **pas** `facteurEchelle` (base recette **figée à 2**, RG-16) — ne pas rendre `PERSONNES_DEFAUT` configurable, ce qui casserait la mise à l'échelle. (3) `analyserVivier(recettes, reglages)` est **généralisé** (condition de Hall sur l'ordre des temps) ; avec `REGLAGES_DEFAUT` il retrouve exactement les seuils 14/10/5.

**Page `/reglages` (#45 PR2)** — Route protégée (ajoutée aux `protectedRoutes` du `middleware.ts`), accès par l'**engrenage** (`Settings` lucide) de `components/ui/nav.tsx`. Formulaire à **enregistrement explicite** : `initiaux` (dernier état sauvé) vs `form` (éditable) → bouton « Enregistrer » actif seulement si `modifie` (et si `faisable`). Garde de faisabilité **B3** : `analyserVivier(recettes, form)` désactive l'enregistrement + affiche le message si la config ne permet pas de remplir 14 slots. La page charge **aussi** les recettes (`chargerRecettes`) pour l'aperçu d'éligibilité (B2) et B3. Le « ↺ changer » de la page planning charge `chargerReglages()` et le passe à `remplacerSlot` (la génération complète, elle, lit côté serveur). Apostrophes en **JSX texte** : utiliser l'apostrophe typographique `’` (la droite `'` casse `react/no-unescaped-entities`).

**Les e2e de réglages écrivent en base (#45)** — `e2e/reglages.spec.ts` modifie la table `reglages` du compte de test. `beforeEach` **et** `afterAll` la nettoient (`nettoyerReglagesDistants`, DELETE REST) : le compte étant partagé, un réglage résiduel ferait diverger les specs supposant le défaut (« génération = 2 personnes »). reglages.spec passe **en dernier** (ordre alphabétique) ; ne pas le lancer en local (`.env.local` = prod).

**Ordre de remplissage : slots contraints d'abord** — `poidsContrainte(slot, reglages)` = taille du vivier de temps éligibles (selon le plafond du créneau) : avec les réglages par défaut, dîners de semaine (1, « rapide ») servis avant les déjeuners de semaine (2), eux-mêmes avant le week-end (3, tout). L'ordre s'adapte aux plafonds configurés (#45). Remplir dans l'ordre chronologique pourrait épuiser un vivier restreint et faire échouer un slot alors qu'une solution existe.

**`dejeuner` reste optionnel dans le type, mais peuplé chaque jour** — Le générateur remplit les 14 slots ; `JourPlanning.dejeuner` est néanmoins gardé `?:` optionnel pour relire sans casse les plannings persistés à 9 repas (antérieurs à #3). `remplacerSlot`/`remplacerSlotManuel`/`modifierPersonnes` renvoient donc encore `null` si le slot demandé est absent d'un vieux planning — ne pas supposer qu'un déjeuner existe toujours.

**Repas en « restes » : flag par slot, exclu des courses (US-12, RG-22)** — `JourPlanning.restes?.{dejeuner|diner}` marque un repas non cuisiné. `lib/restes.ts` : `estRestes(jp, type)` + `marquerRestes(planning, jour, type, valeur)` (setter immuable). `genererListeCourses` **saute** les slots en restes — un repas en restes ne produit aucun article. La recette sous-jacente est **conservée** (démarquer la restitue), mais `remplacerSlot`/`remplacerSlotManuel` **effacent** le flag (on recuisine) ; la génération repart sans restes. Côté UI, un slot restes n'affiche ni `BadgeTemps`, ni stepper, ni fiche. Marquage déclenché depuis la card (bouton) et le `SelecteurRecette` (prop `onRestes`), via snapshot d'annulation (#62).

**Semaine au format ISO 8601 (`"2026-W23"`)** — L'année ISO est celle du jeudi de la semaine : elle peut différer de l'année civile autour du 1er janvier. Tous les calculs de date sont en UTC pour neutraliser les fuseaux. Ne pas remplacer par `getFullYear()` + un compteur naïf. **Toute la logique calendaire vit dans `lib/semaines.ts`** (depuis #55) : `semaineISO` (calcul), `formaterSemaine` (affichage), `semainesSelectionnables`/`semaineParDefaut`/`libelleRelatif` (sélecteur US-11). `generateur.ts` et la page planning l'importent — ne pas redéfinir ces fonctions en local.

**Semaine cible : plage validée côté serveur (US-11, RG-21)** — `genererPlanning(recettes, semaine?)` accepte une semaine cible ; `POST /api/planning/generer` lit `{ semaine }` dans le corps et **rejette (400) toute semaine hors de `semainesSelectionnables()`** (courante → +6). Le client n'est pas l'autorité. Le sélecteur de semaine (page planning) est rendu **après hydratation** (`useHydratation`) car son défaut dépend de la date du client (week-end → semaine prochaine) — sinon mismatch SSR. Mono-actif : une seule semaine en `planning_courant` (l'historique multi-semaines = #P08).

### Migrations Supabase

**Tout changement de schéma passe par un fichier de migration** — `supabase/migrations/<timestamp 14 chiffres>_<nom>.sql`, appliqué par la CI via `supabase db push` (staging sur chaque PR, prod sur push `main`). Ne plus jamais modifier le schéma à la main dans le SQL editor : la base divergerait des migrations et le `db push` suivant pourrait casser.

**La baseline `20260606225900_init.sql` remplace les migrations manuelles** — Les fichiers `20260603_001/_002` (format de nommage incompatible CLI) ont été fusionnés dedans, contenu vérifié contre le schéma réel de la prod via l'API de management. L'historique distant (`supabase_migrations.schema_migrations`) a été marqué manuellement sur prod **et** staging le 2026-06-06 : la baseline y figure comme appliquée, `db push` ne la rejouera pas. Une base neuve, elle, la rejouera entièrement — c'est voulu.

**`db pull` / `db dump` ne marchent pas sur ce poste** — Double blocage : ces commandes exigent Docker (non installé), et le binaire Go du CLI est bloqué par Avast (cf. piège Avast ci-dessous). Pour inspecter un schéma distant : `node scripts/query-supabase.mjs <ref> "<sql>"` (API de management, requiert `SUPABASE_ACCESS_TOKEN`). Refs : prod `gabyhlcwahzquolwxmgd`, staging `upxoxrjumxpzumakawiv`.

**Sync multi-device (#6) — base = source de vérité, planning + coches (livré)** — `planning_slot` porte `personnes`/`restes`, table `etat_courses` (coches JSONB), couche d'accès `lib/persistance.ts` + adaptateurs `dbPlanningToDomain`. Tout vit dans `lib/sync.ts` : un gestionnaire **abonné à `storePlanning` ET `storeCoches`** pousse en base (débounce 800 ms) à chaque écriture — aucun handler à modifier — et **`useSync()`** (pages planning **et** courses) hydrate au montage planning puis coches. **Logique dirty-first / horloge serveur** (corrige le clobber dû au décalage d'horloges) : `planning_courant_maj` / `courses_cochees_maj` valent l'`updated_at` **renvoyé par la base** (jamais l'horloge client) ; une édition pose seulement le drapeau `planning_dirty` / `courses_dirty`, et **le local fait foi tant que dirty** (jamais écrasé). Pull seulement si cache **vide** ou `updated_at` serveur **strictement** plus récent ; un cache **non horodaté** (legacy/injecté en test) est aussi considéré le plus frais. `pousser*()` est **sérialisé** (garde anti-concurrence) → pas de `duplicate key`/RLS. **Conséquence e2e** : les specs partant d'un état vide (planning.spec, courses.spec) **nettoient l'état distant** du compte de test en `beforeEach` (`e2e/helpers.ts` → `nettoyerEtatDistant`, DELETE REST sous RLS) — sinon un planning/des coches persistés réapparaîtraient. Mono-actif (delete→insert) ; le snapshot d'undo reste **local** (non synchronisé). **Caveat** : l'`updated_at` est posé par le client à l'écriture (pas un trigger SQL `now()`) — suffisant pour l'usage mono-utilisateur séquentiel (amélioration : #104).

**Historique multi-semaines (#5) — la persistance n'est plus mono-actif** — `sauvegarderPlanningDistant` fait un **upsert par (user, semaine)** → les semaines **s'accumulent**. **Purge de rétention** : `lib/sync` appelle `purgerSemainesAvant(semaineDecalee(courante, -12))` **une fois par session** (dans `hydrater`, fire-and-forget, garde `dejaPurge`) → seules les ~12 dernières semaines survivent en base, aligné sur la borne du navigateur. `etat_courses` clé-vé **par (user, semaine)** ; coches propres à chaque semaine, attachées à la **semaine affichée** dans `lib/sync` (`semaineActive()`).

**Navigation entre semaines (#5 PR2)** — La page planning affiche une **semaine affichée** (clé localStorage `semaine_affichee`, store `useSemaineAffichee`), partagée avec `/courses`. Le **navigateur** ‹ ← / → › appelle **`naviguerVers(semaine)`** : il **flushe d'abord les écritures en attente** (`attendreSync`, sinon perte de données) puis charge la semaine cible dans le cache (gardes d'hydratation, pas de re-push) ; une semaine sans planning vide le cache → état vide. **`planning_courant`/`courses_cochees` = cache de la semaine affichée** (swappés à la navigation). La génération vise la semaine affichée ; le sélecteur de génération #55 est **remplacé** par le navigateur (plage serveur élargie à **−12 → +6**). Au rechargement complet (`hydrater`, hydrate-once), on revient à la **semaine par défaut** (courante, ou prochaine le week-end) ; un planning local non poussé/non horodaté (offline/e2e injecté) fait foi.

**Confirmation avant de toucher une semaine passée (#5 PR3, RG-24)** — Régénérer ou modifier un slot (changer / sélectionner / restes) d'une semaine **passée** (`offsetAffiche < 0`) **avec un planning** ouvre une `ConfirmationModale` (`components/ui/confirmation.tsx`) avant d'écraser. Mécanique : chaque action mutante prend un param **`force = false`** + une garde `confirmerSiPassee(reprise)` en tête qui diffère l'action (stockée dans l'état `confirmation`) puis la rejoue avec `force = true` à la confirmation — pas de re-déclenchement de la garde, pas de boucle. Exceptions : `selectionnerRecette` **capture le slot** avant la garde (le sélecteur se ferme → `slotEnSelection` repasse à null) ; le **stepper personnes** n'est **pas** gardé (mineur). Générer une semaine passée **vide** ne demande rien (`planning === null`).

### Tests & CI

**Playwright lit `.env.local` directement, pas `process.env`** — `e2e/auth.setup.ts` parse le fichier avec `readFileSync` (Playwright ne charge pas les env Next). Conséquence en CI : le workflow génère un `.env.local` depuis les secrets GitHub Actions `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`, mappés vers les noms `NEXT_PUBLIC_*` attendus par l'app. Supprimer cette étape du workflow = e2e cassés en CI uniquement. Les secrets staging doivent exister dans les deux coffres (Actions **et** Dependabot, cf. piège Dependabot ci-dessous).

**Les e2e tapent une vraie instance Supabase — staging en CI, celle de `.env.local` en local** — Depuis 2026-06-06, la CI pointe vers l'instance Supabase staging (séparée de la prod) ; en local, les e2e utilisent l'instance configurée dans `.env.local`. Compte de test `claude-e2e-test@example.com`, signup idempotent à chaque run. `workers: 1` obligatoire (les tests partagent serveur dev et localStorage), viewport mobile 390×844 (la grille desktop est en `display:none`), session réutilisée via `e2e/.auth/user.json`. La confirmation email doit être désactivée sur le staging aussi, sinon `auth.setup.ts` casse.

**Flakiness e2e = latence backend distant, traitée par retries (#45 PR2)** — Taper une vraie instance Supabase rend certaines assertions sensibles à la latence (lecture après écriture, rendu après génération). Symptôme historique : **un test différent tombe à chaque run** (`toHaveCount 7→0`, `innerText` timeout…), ~1/44, sur des tests sans lien. Ce **n'est pas un bug produit**. Correctif : `playwright.config.ts` pose `retries: process.env.CI ? 2 : 0` (rejeu sûr — chaque test repart d'un état propre en `beforeEach`) et `expect.timeout: 10 s`. **Toujours attendre l'état attendu** (`await expect(locator).toHaveCount(...)` / `toBeVisible()`) **avant** de lire (`innerText`, etc.) — ne pas lire juste après un clic qui déclenche un aller-retour réseau. En **local**, `retries: 0` pour voir les vrais échecs. (La racine horloge inter-device est un autre sujet : #104.)

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
