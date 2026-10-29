<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Guide agent — webapp-repas

> Ce fichier est le point d'entrée pour tout agent (Claude Code, etc.) travaillant sur ce dépôt. Il ne duplique pas la doc : il **pointe** vers la source de vérité.

## À lire en début de session (dans l'ordre)

1. **`CLAUDE.md`** — instructions projet, conventions non négociables, workflow Git, commandes, environnement.
   **`.claude/rules/*.md`** — pièges et décisions non évidentes, un fichier par sous-système (UI, Next/React, génération, sync, courses/cycle, foyer/compte, Supabase, e2e, CI, aide). Claude Code les charge automatiquement selon les fichiers touchés ; tout autre agent ouvre la règle de la zone qu'il modifie (index dans `CLAUDE.md`). C'est la mémoire de tout ce qui a déjà mordu.
2. **`SPECS_FONCTIONNELLES.md`** — périmètre, user stories (US-xx), modèle de données, règles métier (RG-xx). Source de vérité produit.
3. **`ADR.md`** — stack, structure de dossiers réelle, conventions de commits/Git, stratégie d'environnements.

## Règles cardinales

- **Tout est en français** : code, noms, commentaires, UI. Les commentaires citent les `RG-xx` / `US-xx`.
- **`CLAUDE.md` et `.claude/rules/` sont un critère de merge** : toute PR qui introduit un piège, change une convention ou rend un piège faux les met à jour dans le même commit (cf. « Maintenance de ces fichiers » dans `CLAUDE.md`).
- **Jamais de merge avant la CI verte** (discipline — la branch protection est indisponible en plan Free).
- **`app/` = UI, `lib/` = logique pure** (testable sans navigateur). TypeScript strict, trois états UI (loading/error/empty), pas de `try/catch` vide, mobile-first.

## Particularités d'environnement

- Poste Windows + Avast : TLS intercepté (`NODE_OPTIONS=--use-system-ca` déjà posé), binaire Go du CLI Supabase bloqué → passer par `scripts/query-supabase.mjs` pour le SQL distant.
- Migrations `db push` : **en CI** uniquement. e2e Playwright : contre **staging**, en CI ou en local via `npm run test:e2e:staging` (obligatoire avant PR) ; `.env.local` pointe la **prod**, donc jamais `npm run test:e2e` brut en local.
