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
