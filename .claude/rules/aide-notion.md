---
paths:
  - "app/aide/**"
  - "components/aide/**"
  - "lib/aide.ts"
  - "scripts/pull-aide.mjs"
  - "content/aide/**"
  - "public/aide/**"
---

# Doc utilisateur `/aide` : source Notion, contenu committé

- **La source de vérité est la base Notion « Guide OMQ »** (un article par ligne : `Titre` / `Slug` / `Section` / `Ordre` / `Statut` / `Résumé` / `Mots-clés`). Pour modifier un article, éditer Notion puis lancer `npm run pull:aide` ; un `.md` de `content/aide/` modifié à la main serait écrasé au pull suivant.
- `scripts/pull-aide.mjs` (`NOTION_TOKEN`, lu depuis `.env.local`) tire **seulement les articles `Publié`** et écrit `content/aide/<slug>.md`, `content/aide/index.json` et les images dans `public/aide/<slug>/` (les URLs Notion expirent en ~1 h). L'écriture n'a lieu qu'après un fetch complet réussi.
- **Hook `prebuild`** (`--prebuild`, mode tolérant) : à chaque build, le pull a lieu si `NOTION_TOKEN` est présent (défini sur Vercel). Sans token ou sur erreur, le contenu committé est conservé et le build réussit. Le pull manuel, lui, échoue dans ces cas.
- `app/aide/page.tsx` (sommaire) et `app/aide/[slug]/page.tsx` (SSG) lisent ce contenu via `lib/aide.ts`. Rendu `react-markdown` + `remark-gfm` sans `rehype-raw` : le script ne produit que du Markdown pur.
- **`ORDRE_SECTIONS` est dupliqué** dans `lib/aide.ts` et `scripts/pull-aide.mjs` : les faire évoluer ensemble.
- **Un slug publié est immuable et jamais réutilisé** (il sert de route `/aide/<slug>`) ; un article abandonné passe en `Archivé`.
- `/aide` est publique (hors `protectedRoutes`).
