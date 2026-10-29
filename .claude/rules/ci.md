---
paths:
  - ".github/**"
  - "scripts/supabase-projet.mjs"
  - "scripts/e2e-staging.mjs"
---

# CI GitHub Actions

## Topologie (`.github/workflows/ci.yml`)

- **Sur PR** : `unit` (lint + Vitest, en parallèle) ; `migrate-staging` (un seul `db push`, pour éviter deux push concurrents sur l'historique) ; `playwright-cache` ; puis `e2e` (matrice de 2 jobs : `jetable`, `--workers=4`, et `partage`, `workers: 1`, compte `claude-e2e-p1`). Le serveur e2e est `next build && next start` en CI, `next dev` en local.
- **Sur push `main`** (et `workflow_dispatch`) : seulement `migrate-prod`. `migrate-prod` n'a pas de `needs` vers les jobs de PR, car un `needs` sur un job skipped le rendrait skipped.
- Vercel déploie via son propre webhook, indépendamment d'Actions.

## Budget de minutes (plan Free, 2000 min/mois)

Les minutes facturées sont la **somme des durées de chaque job** (arrondie à la minute par job), pas le mur-horloge. On optimise donc les minutes :
- `concurrency` par `github.ref`, avec `cancel-in-progress` **sauf sur `main`** (ne jamais couper un `migrate-prod`) ;
- **tout job de test porte `if: github.event_name == 'pull_request'`** : le tree mergé a déjà passé la CI pendant la PR ;
- e2e consolidés en 2 jobs. Le découpage en 6 jobs (5 comptes `p1…p5`, désormais dormants) a été abandonné, car le coût fixe par job (~1 min 30) brûlait les minutes. Le restaurer suppose de ré-arbitrer minutes contre horloge ;
- `paths-ignore` sur `pull_request` : `**/*.md`, `content/aide/**`, `revueDesign/**` (une PR doc-only ne lance aucune CI). Toute nouvelle origine de doc pure peut y être ajoutée. `push: main` reste sans filtre.

## Cache du navigateur Playwright

Le job `playwright-cache` peuple le cache **une fois** ; `e2e` fait `actions/cache/restore` (restore-only, jamais de save, donc aucune course de sauvegarde entre jobs). La clé de cache est dérivée de la **version de `@playwright/test`**. Un filet `playwright install chromium`, gardé par `cache-hit != 'true'`, est borné à `timeout-minutes: 5`.
- Pas de `playwright install-deps` : son `apt-get update` (non cachable) montait à 10-15 min, et les runners `ubuntu-latest` ont déjà les libs de Chromium.
- Pas d'image Docker Playwright : ~2 Go tirés par job, plus lent que le restore de cache.

## Supabase en pause (tier gratuit)

- Un projet inactif ~1 semaine passe `INACTIVE` et **perd la résolution DNS** de `<ref>.supabase.co` : le ping du keep-alive (`supabase-keepalive.yml`) ne peut plus le réveiller seul.
- **Symptôme piégeur** : sur un projet en pause, `GET /v1/projects/<ref>/api-keys` répond **200 avec un tableau vide** (« Clé anon staging introuvable »), ce qui oriente à tort vers le token. Diagnostic : `GET /v1/projects`, champ `status`.
- **Parade jumelle** : `scripts/supabase-projet.mjs` (`statutProjet` / `assurerProjetActif`, utilisé par `e2e-staging.mjs`) et son **miroir bash** dans le workflow keep-alive. `POST /v1/projects/<ref>/restore` n'est déclenché **que si** le statut vaut exactement `INACTIVE`, puis on sonde jusqu'à `ACTIVE_HEALTHY` (~2 min). Toute évolution se fait dans les deux fichiers. Couverture : `tests/e2e-staging-reveil.test.ts`.

## Secrets

- **Les PR Dependabot lisent un coffre séparé** (Settings → Secrets → Dependabot). Tout secret lu par un workflow déclenché sur `pull_request` existe dans **les deux coffres**, et une rotation met à jour les deux. Sinon, seules les PR Dependabot échouent.
- Exception : `SUPABASE_ACCESS_TOKEN` (portée compte entier) est **dans le coffre Actions uniquement**, car le keep-alive ne tourne que sur `schedule` / `workflow_dispatch`.
- Les secrets Upstash ne sont pas en CI (rate-limit volontairement NO-OP, cf. `next-react.md`).

## Incidents connus

- **GitHub peut ne pas créer le run `push` d'un merge**, donc `migrate-prod` ne tourne pas et la prod reste en retard sur un code déjà déployé par Vercel. Relancer `gh workflow run CI --ref main`, puis vérifier le schéma prod via `scripts/query-supabase.mjs`.
- **Pas de protection de branche** (repo privé, plan Free : l'API répond 403). Si cela change (repo public ou GitHub Pro) : exiger une PR et les checks `unit` + `e2e`.
