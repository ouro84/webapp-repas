<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Guide agent — webapp-repas

> Ce fichier est le point d'entrée pour tout agent (Claude Code, etc.) travaillant sur ce dépôt. Il ne duplique pas la doc : il **pointe** vers la source de vérité.

## À lire en début de session (dans l'ordre)

1. **`CLAUDE.md`** — instructions projet, conventions non négociables, et surtout la section **« Pièges et décisions non-évidentes »** (Tailwind v4, stores `useSyncExternalStore`, proxy Next 16, scope foyer, sync/temps réel, migrations Supabase, environnement Avast…). C'est la mémoire de tout ce qui a déjà mordu.
2. **`SPECS_FONCTIONNELLES.md`** — périmètre, user stories (US-xx), modèle de données, règles métier (RG-xx). Source de vérité produit.
3. **`ADR.md`** — stack, structure de dossiers réelle, conventions de commits/Git, stratégie d'environnements.

## Règles cardinales

- **Tout est en français** : code, noms, commentaires, UI. Les commentaires citent les `RG-xx` / `US-xx`.
- **`CLAUDE.md` est un critère de merge** : toute PR qui introduit un piège, change une convention ou solde une dette doit le mettre à jour dans le même commit (cf. sa « Règle de mise à jour »).
- **Jamais de merge avant la CI verte** (discipline — la branch protection est indisponible en plan Free).
- **`app/` = UI, `lib/` = logique pure** (testable sans navigateur). TypeScript strict, trois états UI (loading/error/empty), pas de `try/catch` vide, mobile-first.

## Particularités d'environnement

- Poste Windows + Avast : TLS intercepté (`NODE_OPTIONS=--use-system-ca` déjà posé), binaire Go du CLI Supabase bloqué → passer par `scripts/query-supabase.mjs` pour le SQL distant.
- e2e Playwright et migrations `db push` tournent **en CI** (staging) ; en local `.env.local` pointe la **prod** — ne pas y lancer les specs qui écrivent en base (recettes/reglages).
