# Contexte projet — Webapp Repas de la semaine

> Dernière mise à jour : 2026-06-03
> Stack : Next.js 16 (App Router) + Supabase + Vercel + Tailwind CSS v4

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
