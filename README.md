# On mange quoi ?

[![CI](https://github.com/ouro84/webapp-repas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ouro84/webapp-repas/actions/workflows/ci.yml)

**La question du soir a enfin sa réponse.** Webapp mobile-first qui génère le planning de repas de la semaine et en déduit la liste de courses, partagée en temps réel au sein du foyer.

Application : <https://webapp-repas.vercel.app>

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19, TypeScript strict
- [Supabase](https://supabase.com) : Postgres, Auth, Realtime, RLS
- Tailwind CSS v4
- Vercel (hébergement), Sentry (erreurs), Upstash Redis (rate-limit)
- Vitest (unitaires) et Playwright (e2e)

Versions exactes : `package.json`. Décisions d'architecture et structure des dossiers : `ADR.md`.

## Démarrer en local

Prérequis : Node 22.

1. Installer les dépendances : `npm ci`
2. Copier `.env.example` en `.env.local`.
3. Renseigner au minimum `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` (dashboard Supabase → Settings → API). Les autres variables, commentées dans `.env.example`, ne servent qu'aux fonctions qu'elles nomment (monitoring, doc `/aide`, suppression de compte, rate-limit).
4. Lancer le serveur : `npm run dev`, puis ouvrir <http://localhost:3000>.

> **⚠ `.env.local` pointe la base de production.** Ne jamais lancer `npm run test:e2e` en local : il écrirait en prod. Les e2e locaux passent par `npm run test:e2e:staging`.

Sous Windows avec un antivirus qui intercepte le TLS (Avast), voir la section « Environnement de dev » de `CLAUDE.md`.

## Commandes essentielles

| Commande | Usage |
|----------|-------|
| `npm run dev` | Serveur de développement |
| `npm run test:run` | Tests unitaires Vitest en un passage |
| `npm run test:e2e:staging -- [specs]` | Tests e2e Playwright contre l'environnement de staging |

Les autres commandes et scripts (lint, requêtes SQL distantes, doc `/aide`, génération du catalogue) sont listés dans `CLAUDE.md`.

## Intégrations

- **Serveur MCP** (`/api/mcp`, OAuth 2.1) : expose le planning et la liste de courses à un assistant IA. Voir `.claude/rules/mcp.md`.
- **Exécuteur de panier Chronodrive** (`integrations/chronodrive-mcp/`) : remplit un panier drive à partir de la liste de courses. Voir `.claude/rules/chronodrive.md`.

## Documentation

| Fichier | Contenu |
|---------|---------|
| `SPECS_FONCTIONNELLES.md` | Périmètre, user stories `US-xx`, règles métier `RG-xx`, modèle de données. Source de vérité produit. |
| `ADR.md` | Décisions de stack, structure de dossiers, environnements, sécurité. |
| `PRODUCT.md` / `DESIGN.md` | Ton, principes produit, tokens visuels. |
| `CHANGELOG.md` | Historique des versions (Keep a Changelog). |
| `CLAUDE.md` / `AGENTS.md` | Conventions, workflow Git, commandes, environnement. Point d'entrée des agents IA. |
| `.claude/rules/` | Pièges et décisions non évidentes, un fichier par sous-système. |

## Licence

Propriétaire, tous droits réservés. Le code est consultable mais aucune réutilisation, copie ou redistribution n'est autorisée sans accord écrit de l'auteur.
