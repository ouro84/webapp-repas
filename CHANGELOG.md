# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Monitoring d'erreurs Sentry (`@sentry/nextjs`) : erreurs client, serveur (RSC/route handlers via `onRequestError`) et edge ; sans tracing ni session replay pour préserver le quota gratuit. DSN via `NEXT_PUBLIC_SENTRY_DSN`
- Migrations Supabase CLI : `supabase` en devDependency, `supabase/config.toml`, baseline `20260606225900_init.sql` vérifiée contre le schéma prod ; historique de migrations marqué sur prod et staging
- `scripts/query-supabase.mjs` : exécution de SQL distant via l'API de management (contourne le blocage Avast du CLI Go en local)
- CI : application automatique des migrations — staging avant les e2e de chaque PR, prod via le job `migrate-prod` sur push `main` (après tests verts)
- Workflow keep-alive Supabase (`.github/workflows/supabase-keepalive.yml`) : ping REST de la prod et du staging lundi et jeudi 8h UTC pour éviter la mise en pause automatique du tier gratuit ; secrets `SUPABASE_URL` / `SUPABASE_ANON_KEY` ajoutés au coffre Actions (#15)
- Liste de courses cochable en magasin (US-05, RG-10 à RG-14, #19) : cocher/décocher un article (rayé + fin de catégorie, animation View Transitions avec repli `prefers-reduced-motion`), persistance locale des coches avec invalidation par quantité au remplacement d'un slot et réinitialisation à la regénération, compteur de progression « n/N » (fond de placard cochable mais hors compteur), bouton « Tout décocher », sections repliables
- Mini-stores localStorage partagés dans `lib/stockage.ts` (`storePlanning`, `storeCoches`) — le pattern `useSyncExternalStore` de la page planning est extrait et réutilisé par la page courses
- Sélection manuelle d'une recette pour un slot du planning (US-06, RG-15, #14) : sélecteur `<dialog>` natif (bottom sheet mobile / modale desktop) avec recherche insensible à la casse et aux accents, badge « déjà au planning », by-pass des contraintes de temps et d'unicité (choix éclairé) ; coches de la liste de courses conservées
- Nombre de personnes par repas (US-07, RG-16/17, #34) : stepper − / + sur chaque card du planning (défaut 2, borné [1;12]), la liste de courses met les quantités à l'échelle ×N/2 avec arrondi par type d'unité ; le réglage est conservé au changement de recette et réinitialisé à la regénération ; les plannings persistés antérieurs se relisent sans migration (champ `personnes` absent = 2)

### Modifié

- Les tests e2e en CI utilisent l'instance Supabase staging (secrets `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`) au lieu de la prod
- Pages login/signup alignées sur le design system (#57) et formulaire d'auth accessible (#60) : composant partagé `FormulaireAuth` aux couleurs brand (boutons `rounded-full bg-brand-600`, inputs `border-brand-200`, focus `outline-brand-600`), autocomplete email + mot de passe, toggle afficher/masquer le mot de passe, erreur en `role="alert"` avec retour du focus, bouton en chargement avec spinner + `aria-busy`, `<main id="contenu">` pour le skip link

## [1.0.1] - 2026-06-06

### Modifié

- Remplacement du jeu de démonstration par 74 vraies recettes dans `data/recettes.json` ; ancien jeu conservé en référence dans `data/recettes_25random.json` (#43)
- Découplage des tests du dataset réel : fixtures figées (`tests/fixtures/recettes.ts`) pour Vitest et Playwright, le dataset peut évoluer sans casser de test (#43)
- Mises à jour de dépendances (Dependabot) : `actions/checkout` v6, `actions/setup-node` v6, `actions/upload-artifact` v7, `react`/`react-dom` 19.2.7, `typescript` 6.0.3, `@types/node` 25 (#36–#42)

### Ajouté

- Configuration Dependabot : surveillance hebdomadaire npm + GitHub Actions, groupage des mises à jour non-majeures (#35)
- Validation structurelle du dataset de recettes (`tests/recettes-dataset.test.ts`) : ids uniques, énumérations valides, vivier générable (#43)
- Étape ESLint dans le workflow CI — le lint n'était couvert ni par le build ni par les tests (#44)
- Règle de mise à jour de `CLAUDE.md` : le fichier est un critère de merge (#47)

### Corrigé

- Retour à ESLint 9 : ESLint 10 est incompatible avec `eslint-plugin-react` 7.x embarqué par `eslint-config-next` ; les majeures d'eslint sont ignorées par Dependabot jusqu'au support de la v10 (#44)

## [1.0.0] - 2026-06-05

### Ajouté

- Génération automatique d'un planning de 7 repas
- Algorithme avec contraintes de temps (RG-01 à RG-04, slots contraints en premier)
- Remplacement individuel d'un repas (régénération partielle)
- Liste de courses agrégée depuis le planning (RG-05, fond de placard)
- Authentification Supabase (email/password)
- Design system Tailwind v4 (palette brand/accent/canvas)
- CI GitHub Actions (Vitest + Playwright)
- Déploiement Vercel avec preview deployments

[Unreleased]: https://github.com/ouro84/webapp-repas/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ouro84/webapp-repas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ouro84/webapp-repas/releases/tag/v1.0.0
