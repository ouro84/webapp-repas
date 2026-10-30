# Webapp Repas — « On mange quoi ? »

Webapp de génération automatique de plannings de repas hebdomadaires, avec liste de courses agrégée. Mobile-first, partagée au sein d'un foyer, déployée sur Vercel. Stack : Next.js 16 (App Router) + Supabase + Tailwind CSS v4 (versions : `package.json`).

## Documents de référence

| Fichier | Quand le lire |
|---------|---------------|
| `SPECS_FONCTIONNELLES.md` | Avant toute session de code : périmètre, user stories `US-xx`, règles métier `RG-xx`, modèle de données. Source de vérité produit. |
| `ADR.md` | Avant toute session de code : décisions de stack, **structure de dossiers à jour**, environnements, ADR-10 (sécurité). |
| `PRODUCT.md` / `DESIGN.md` | Pour toute tâche UI : ton, tokens visuels (synchro avec `app/globals.css`). Cf. `/impeccable`. |
| `RAPPORT_AUDIT_SECURITE.md` | Ponctuellement : constats F-01→F-08 et dettes pré-ouverture publique. |

Suivre les choix déjà tranchés par ces documents plutôt que d'en improviser d'autres.

## Pièges par sous-système : `.claude/rules/`

Les pièges et décisions non évidentes vivent dans `.claude/rules/*.md`, chargés automatiquement quand on touche les fichiers correspondants (frontmatter `paths:`). Un agent qui ne lit pas ce dossier automatiquement doit ouvrir la règle de la zone qu'il modifie :

| Règle | Zone |
|-------|------|
| `ui.md` | Design system, dark mode, nav, animations, composants partagés |
| `next-react.md` | Stores `useSyncExternalStore`, proxy Next 16, Sentry, CSP, rate-limit, clients Supabase |
| `generation-recettes.md` | Générateur, réglages, biais (végé/mix/saison/variété/préférences), catalogue, recettes |
| `sync-planning.md` | Synchro multi-appareil, temps réel, historique de semaines, undo |
| `courses-cycle.md` | Liste de courses, cycle de courses, vue Cycle, articles manuels, View Transitions |
| `foyer-compte.md` | Foyer (rejoindre/quitter), profil, onboarding, invitation, RGPD, suppression de compte |
| `supabase.md` | Migrations, RLS `mon_foyer()`, RPC `SECURITY DEFINER`, PostgREST |
| `e2e.md` | Playwright, comptes de test, helpers de nettoyage |
| `ci.md` | GitHub Actions, budget de minutes, keep-alive Supabase, secrets |
| `aide-notion.md` | Doc utilisateur `/aide` tirée de Notion |
| `mcp.md` | Serveur MCP `/api/mcp`, OAuth 2.1 (Supabase OAuth Server), consentement, outils |
| `chronodrive.md` | Exécuteur panier Chronodrive (`integrations/chronodrive-mcp/`), API privée, NAS, webhook |

## Maintenance de ces fichiers — critère de merge

`CLAUDE.md` et `.claude/rules/` sont un critère de merge. Dans le même commit que le changement de code :

- un nouveau piège ou une nouvelle convention va dans la règle du sous-système concerné (la racine ne garde que ce qui vaut pour toute session) ; créer une nouvelle règle avec ses `paths:` si aucune ne couvre la zone ;
- un piège rendu faux par la PR (dette soldée, comportement changé, fichier renommé) est corrigé ou supprimé ;
- format d'une entrée : la règle, puis une ligne de « pourquoi ». Les récits, dates et numéros de PR restent dans git.

## Conventions

**Langue.** Tout est en français : identifiants (`genererPlanning`, `sAbonner`), commentaires, messages d'erreur, UI. Les commentaires citent les `RG-xx` / `US-xx`. En JSX texte, utiliser l'apostrophe typographique `’` (la droite casse `react/no-unescaped-entities`).

**Commits.** `type: description courte`, types `feat` / `fix` / `chore` / `refactor` / `test` / `docs`.

**Changelog.** `CHANGELOG.md` au format Keep a Changelog : tout changement notable entre dans `[Unreleased]` dans la PR qui l'introduit. À chaque release GitHub, transformer `[Unreleased]` en section datée et mettre à jour les liens de comparaison.

**Secrets.** `.env.local` reste hors de Git ; `.env.example` liste les noms de variables sans valeurs. Tout secret lu par la CI existe dans les deux coffres GitHub (Actions **et** Dependabot) — cf. `ci.md`.

**Code.**
1. TypeScript strict : corriger les erreurs de typage plutôt que les contourner.
2. `app/` pour l'UI, `lib/` pour la logique pure, testable sans navigateur.
3. Tout écran gère trois états : loading, error, empty.
4. Toute erreur capturée est loggée ou affichée.
5. Mobile-first : styles pour mobile, ajustés via `md:` / `lg:`.

## Workflow Git

- `main` = production, toujours déployable. Une branche par feature (`feat/…`, `fix/…`, `docs/…`), jamais de commit direct sur `main`.
- **E2E sur staging avant d'ouvrir ou pousser une PR** qui touche l'UI, la synchro, la persistance, les RLS/RPC/migrations ou un parcours e2e : `npm run test:e2e:staging -- <spec ciblée>`, puis les specs impactées avec `--retries=2`. Pourquoi : Vitest ne voit pas les bugs d'intégration (boucle de rendu, rejet PostgREST, RLS, course de débounce, hydratation, décalage calendaire) ; une PR (#257) a enchaîné 4 rounds de CI rouge pour des bugs qu'une passe e2e locale aurait tous attrapés. Prérequis : migration de la branche appliquée sur staging (cf. `supabase.md`).
- **Changement d'un mécanisme partagé = audit par invariant.** `grep` tous les consommateurs et tous les tests du mécanisme changé, et les traiter d'un bloc, plutôt que de migrer fichier par fichier. Corollaire **jumeau** : un correctif appliqué à une instance d'une paire (deux stores, fonction JS + miroir SQL, helper e2e + fonction app, script Node + miroir bash) se vérifie sur les deux.
- **Merge seulement sur CI verte**, même si le merge est demandé : attendre la fin des checks (`gh pr checks <n> --watch`). Si un check échoue, ne pas merger ; remonter à l'humain le check, le lien du run, l'extrait de log, la cause probable, et si l'échec vient de la PR ou est pré-existant/flaky, puis proposer correction ou by-pass justifié et le laisser trancher. Pourquoi : la protection de branche est indisponible (repo privé, plan Free), la règle tient par discipline.

## Commandes et outils

| Commande | Usage |
|----------|-------|
| `npm run test:run` | Vitest en un passage (`npm run test` reste en watch en local). |
| `npm run test:e2e:staging -- [specs] [--retries=2]` | E2E Playwright contre **staging**. Swappe `.env.local`↔staging avec restauration garantie, récupère les clés staging à la volée, réveille le projet s'il est en pause, refuse si le port 3000 est occupé. |
| `npm run test:e2e` | **Jamais en local** : `.env.local` pointe la **prod**. Réservé à la CI. |
| `node scripts/query-supabase.mjs <ref> "<sql>"` | SQL distant via l'API de management (requiert `SUPABASE_ACCESS_TOKEN`). Refs : prod `gabyhlcwahzquolwxmgd`, staging `upxoxrjumxpzumakawiv`. |
| `npm run pull:aide` | Re-tire la doc `/aide` depuis Notion (cf. `aide-notion.md`). |
| `gh` | Authentifié `ouro84` ; gère aussi le backlog GitHub Projects. |

Scripts de génération (`scripts/*.mjs`) :

| Script | Rôle |
|--------|------|
| `generer-seed-recettes.mjs` | Migration d'amorçage du catalogue global depuis `data/recettes.json`. `--fragment` n'émet que le corps d'insert, pour l'insérer dans un bloc `do $$` plus large. |
| `generer-saisons-recettes.mjs` | `UPDATE … set saisons` du catalogue. Miroir JS de `PRODUITS_SAISON` (`lib/saisons.ts`) : régénérer si la table évolue. |
| `generer-icones-pwa.mjs` | Icônes PWA depuis `app/icon.svg` (sharp). Relancer si le mark change ; les PNG ne s'éditent pas à la main. |
| `supabase-projet.mjs` | Statut/réveil d'un projet Supabase en pause (importé par `e2e-staging.mjs`). |

## Environnement de dev (Windows + Avast)

- **Avast intercepte le TLS.** Node a besoin de `NODE_OPTIONS=--use-system-ca` (posé en variable machine) ; c'est aussi la raison du `ignoreHTTPSErrors: true` de Playwright. Une erreur de certificat au login Supabase ou en e2e local pointe d'abord vers cette variable.
- **Le CLI Supabase (binaire Go) est bloqué** (`CRYPT_E_NO_REVOCATION_CHECK`, message quasi vide), et `db pull`/`db dump` exigent Docker, absent. Inspecter un schéma distant via `scripts/query-supabase.mjs` ; les commandes CLI réseau (`db push`) tournent en CI.
- **`npm install` peut laisser des paquets creux** (Avast + virtualisation OneDrive de `Documents\`). Si un binaire (`next`, `eslint`) disparaît après une install, vérifier `node_modules/<paquet>/package.json` avant de chercher un bug de code. La CI (`npm ci` sous Linux) reste le validateur fiable.

## graphify

Le projet a un graphe de connaissances dans `graphify-out/` (nœuds centraux, communautés, liens entre fichiers). Ce dossier est généré localement et reste hors de Git.

- **Question sur le code : d'abord `graphify query "<question>"`** si `graphify-out/graph.json` existe ; `graphify path "<A>" "<B>"` pour un lien entre deux notions, `graphify explain "<notion>"` pour une notion précise. Pourquoi : ces commandes renvoient un sous-graphe ciblé, bien plus court que `GRAPH_REPORT.md` ou un `grep` brut.
- Si `graphify-out/wiki/index.md` existe, s'en servir pour naviguer plutôt que parcourir les sources.
- Lire `graphify-out/GRAPH_REPORT.md` seulement pour une revue d'architecture large, ou quand query/path/explain ne suffisent pas.
- **Après une modification de code, lancer `graphify update .`** pour garder le graphe à jour (AST seul, sans coût d'API).
