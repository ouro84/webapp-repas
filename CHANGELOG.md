# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Monitoring d'erreurs Sentry (`@sentry/nextjs`) : erreurs client, serveur (RSC/route handlers via `onRequestError`) et edge ; sans tracing ni session replay pour préserver le quota gratuit. DSN via `NEXT_PUBLIC_SENTRY_DSN`

### Modifié

- Les tests e2e en CI utilisent l'instance Supabase staging (secrets `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`) au lieu de la prod

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
