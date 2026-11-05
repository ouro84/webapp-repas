# Ordre de la nav desktop aligné sur le mobile (#351) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La barre du haut (`NavBar`, ≥ `md:`) affiche les sections dans le même ordre que les onglets du bas : Ce soir · Planning · Courses · Recettes.

**Architecture:** L'ordre devient une donnée unique de `components/ui/nav.tsx` : `sections()` renvoie un tableau ordonné, consommé tel quel par `NavBar` et `OngletsBas`. Plus aucune barre ne réordonne localement, donc les deux ne peuvent plus diverger. Un e2e verrouille l'ordre desktop.

**Tech Stack:** Next.js 16 (App Router), React, Tailwind v4, Playwright (e2e contre staging).

**Spec:** issue GitHub #351 (`gh issue view 351`), décisions de la session de grilling du 2026-11-05.

## Global Constraints

- Ordre unique des sections : **Ce soir · Planning · Courses · Recettes** (le premier libellé est dynamique : « Ce soir » ou « Ce midi », via `libelleMomentActuel`).
- Barre du haut : libellés texte seuls, aucune icône ajoutée.
- Ordre mobile inchangé.
- Tout en français (identifiants, commentaires) ; commit `fix: …` ; entrée `CHANGELOG.md` dans `[Unreleased]`.
- `.claude/rules/ui.md` mis à jour dans le même commit que le code (critère de merge).
- E2E sur staging avant la PR : `npm run test:e2e:staging -- e2e/nav-mobile.spec.ts`. Jamais `npm run test:e2e` en local (`.env.local` = prod).

## Review Focus

1. **Libellé « Ce midi »** : avant le seuil de `libelleMomentActuel`, le premier lien s'appelle « Ce midi ». L'assertion d'ordre doit accepter les deux (`/^Ce (midi|soir)$/`), sinon l'e2e devient flaky selon l'heure du run.
2. **Liens hors sections dans la barre du haut** : logo (« On mange quoi ? — accueil »), Aide (icône), avatar. L'assertion d'ordre ne doit viser que les 4 liens de section, sinon elle casse au moindre ajout dans la barre.
3. **Barre masquée** : sous `md:` la rangée desktop est en `display:none`. L'e2e d'ordre desktop se joue à 1280 px, sinon les liens sont hors de l'arbre d'accessibilité.
4. **État actif** : réordonner ne doit pas déplacer `aria-current="page"` (toujours sur la section de la route courante).
5. **Commentaires périmés** : `nav.tsx` dit « Ordre desktop inchangé » (l. ~145) et la règle `ui.md` l. 50 dit « l'ordre diffère ». Les deux deviennent faux.

---

### Task 1: Ordre unique des sections + verrou e2e

**Files:**
- Modify: `components/ui/nav.tsx` (`sections()` l. 68-80, `NavBar` l. 107 et 144-150, `OngletsBas` l. 206-216 et 227)
- Modify: `e2e/nav-mobile.spec.ts` (test « desktop : pas d'onglets en bas, sections libellées en haut (#335) »)
- Modify: `.claude/rules/ui.md` (l. 50)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:**
- Produces: `function sections(): Section[]` dans `components/ui/nav.tsx` — renvoie les 4 sections **dans l'ordre d'affichage** `[ceSoir, planning, courses, recettes]`. Remplace la version actuelle qui renvoie un `Record<"ceSoir" | "planning" | "courses" | "recettes", Section>`.
- `NavBar` garde un accès direct à la section « Ce soir » pour le lien du logo (`href={navApp ? … : "/"}`) : la lire via `sections()[0].href`, ou mieux une constante `HREF_CE_SOIR = "/ce-soir"` réutilisée par `sections()` ; choisir la constante (pas d'indice magique).

- [ ] **Step 1: Créer la branche**

```bash
git checkout main && git pull && git checkout -b fix/351-ordre-nav-desktop
```

- [ ] **Step 2: Écrire l'assertion d'ordre dans l'e2e desktop (qui doit échouer)**

Dans `e2e/nav-mobile.spec.ts`, renommer le test desktop en « desktop : pas d'onglets en bas, sections libellées en haut dans l'ordre mobile (#335, #351) » et remplacer la boucle `for (const nom of [...])` par :

```ts
const sectionsHaut = haut.getByRole("link", {
  name: /^(Ce (midi|soir)|Planning|Courses|Recettes)$/,
});
await expect(sectionsHaut).toHaveText([
  /^Ce (midi|soir)$/,
  "Planning",
  "Courses",
  "Recettes",
]);
await expect(haut.getByRole("link", { name: "Planning" })).toHaveAttribute(
  "aria-current",
  "page"
);
```

Garder `await expect(onglets(page)).toBeHidden();` et le viewport 1280×800.

- [ ] **Step 3: Lancer l'e2e et constater l'échec**

Run: `npm run test:e2e:staging -- e2e/nav-mobile.spec.ts -g "desktop"`
Expected: FAIL — `toHaveText` reçoit `["Planning", "Courses", "Recettes", "Ce soir"]` (ou « Ce midi » en dernier).

- [ ] **Step 4: Faire de `sections()` la source unique de l'ordre**

Dans `components/ui/nav.tsx` :
- `sections(): Section[]` renvoie `[ceSoir, planning, courses, recettes]` (mêmes `href`, `label`, `Icone` qu'aujourd'hui).
- `NavBar` : `sections().map(...)` dans la rangée `hidden md:flex`, sans réordonner ; lien du logo vers `HREF_CE_SOIR`.
- `OngletsBas` : `sections().map(...)`, sans réordonner.
- Commentaires : remplacer « Ordre desktop inchangé » (NavBar) par une phrase disant que l'ordre vient de `sections()`, identique aux deux barres (#351) ; dans l'en-tête de `OngletsBas`, garder la justification « Ordre = fréquence d'usage » en précisant qu'elle vaut pour les deux barres.

- [ ] **Step 5: Relancer l'e2e de la nav**

Run: `npm run test:e2e:staging -- e2e/nav-mobile.spec.ts --retries=2`
Expected: PASS des 4+ tests du fichier (ordre desktop, ordre mobile, 320 px, redirection `/`).

- [ ] **Step 6: Lint, types, unitaires**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: aucune erreur, tous les tests Vitest verts.

- [ ] **Step 7: Mettre à jour la règle et le changelog**

- `.claude/rules/ui.md` l. 50 : remplacer « l'ordre diffère (desktop inchangé, mobile par fréquence d'usage) » par : « `sections()` renvoie le tableau ordonné (Ce soir · Planning · Courses · Recettes, ordre de fréquence d'usage) consommé tel quel par les deux barres ; ne jamais réordonner localement. » puis, ligne suivante, « Pourquoi : deux ordres différents déroutaient en passant d'un appareil à l'autre (#351). »
- `CHANGELOG.md`, `[Unreleased]` › `### Modifié` : « Navigation : sur ordinateur, la barre du haut présente les sections dans le même ordre que sur mobile — Ce soir, Planning, Courses, Recettes (#351). »

- [ ] **Step 8: Commit**

```bash
git add components/ui/nav.tsx e2e/nav-mobile.spec.ts .claude/rules/ui.md CHANGELOG.md docs/superpowers/plans/2026-11-05-351-ordre-nav-desktop.md
git commit -m "fix: ordre de la nav desktop aligné sur le mobile (#351)"
```

- [ ] **Step 9: Graphe à jour**

Run: `graphify update .`
Expected: mise à jour AST sans erreur (dossier hors Git, rien à committer).

---

### Task 2: PR et merge

- [ ] **Step 1: Pousser et ouvrir la PR**

```bash
git push -u origin fix/351-ordre-nav-desktop
gh pr create --title "fix: ordre de la nav desktop aligné sur le mobile (#351)" --body "<résumé, Closes #351, e2e staging passés>"
```

- [ ] **Step 2: Attendre la CI**

Run: `gh pr checks <n> --watch`
Expected: tous les checks verts. Échec : ne pas merger, remonter check + lien du run + extrait de log + cause probable (PR ou flaky pré-existant).

- [ ] **Step 3: Merge (sur CI verte seulement, après accord)**

```bash
gh pr merge <n> --squash --delete-branch
```
