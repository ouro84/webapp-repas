# Garde d'ajout Chronodrive (#361) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir la garde d'ajout au panier (jetons + « proposé pour ce terme ») de la fermeture `creerServeur` de `src/outils.ts` vers un module testable sans transport MCP, à comportement strictement identique.

**Architecture:** `jetonsValides` (pure) rejoint `src/jetons.ts`. Un nouveau module `src/garde-ajout.ts` porte la mémoire des propositions (par client, par terme normalisé, 30 min, `premierAppel`) et le verdict produit d'une ligne. `outils.ts` garde schémas zod, `enSerie`, l'ordre jeton → création du client → verdict produit, et le mapping des résultats.

**Tech Stack:** TypeScript exécuté par Node 24 (`node --test`, pas de build), `integrations/chronodrive-mcp/`.

**Spec:** issue #361 ; revue d'architecture 2026-11-06 (candidat 04) ; `.claude/rules/chronodrive.md` (lignes 42-46, 58, 76).

## Global Constraints

- Identifiants, commentaires et messages en français ; les commentaires citent RG-82 / RG-83 comme l'existant.
- Comportement iso : les 213 tests existants (`npm test` dans `integrations/chronodrive-mcp`) passent **sans modification** de `test/outils.test.ts`.
- Messages de refus inchangés au caractère près : `JETON_INVALIDE` (reste dans `src/outils.ts`), `PRODUIT_NON_PROPOSE` (déménage dans `src/garde-ajout.ts`, sans ré-export : mettre à jour les imports qui le lisent depuis `outils.ts`), `PRODUIT_INCONNU` (reste dans `src/panier.ts`).
- Imports avec extension `.ts` (style du paquet). `npm run typecheck` doit passer.
- Durée de vie : `DUREE_FAVORIS_MS` (30 min) de `src/catalogue.ts`, pas de nouvelle constante.

## Review Focus

- Reformulation (`terme_recherche`) cherchée dans le MÊME appel que le terme, ou avant : refus (`premierAppel` strictement postérieur exigé).
- Terme re-cherché après 30 min : `premierAppel` repart d'un nouveau numéro (entrée élaguée), pas de l'ancien.
- Client remplacé (nouvel objet) : aucune proposition héritée → refus.
- Produit vu (favoris/recherche) mais proposé pour un AUTRE terme : `PRODUIT_NON_PROPOSE`, jamais vu : `PRODUIT_INCONNU`.
- Co-jetons de deux demandes différentes : refus même si le jeton de `terme` est valide.

---

### Task 1: `jetonsValides` pure dans `src/jetons.ts`

**Files:**
- Modify: `integrations/chronodrive-mcp/src/jetons.ts`, `integrations/chronodrive-mcp/src/outils.ts` (supprimer la fonction locale, importer)
- Test: `integrations/chronodrive-mcp/test/jetons.test.ts`

**Interfaces:**
- Produces: `export function jetonsValides(secret: string, jetons: string[], terme: string, maintenant: number): boolean` (corps et commentaire repris tels quels de `outils.ts`).

- [ ] **Step 1: Tests qui échouent** dans `test/jetons.test.ts` (via `signerJeton` existant) : `jetonsValides` vrai pour un jeton de `terme` valide ; faux si un co-jeton vient d'une autre demande ; faux si un jeton est expiré ; vrai si un co-jeton de la même demande signe un autre libellé ; faux si aucun jeton ne signe `terme`.
- [ ] **Step 2:** `npm test` → échec (export absent).
- [ ] **Step 3:** Déplacer la fonction, importer dans `outils.ts`.
- [ ] **Step 4:** `npm test` (213 + nouveaux, tous verts) et `npm run typecheck`.
- [ ] **Step 5: Commit** `refactor: jetonsValides rejoint jetons.ts (#361)`

### Task 2: module `src/garde-ajout.ts`

**Files:**
- Create: `integrations/chronodrive-mcp/src/garde-ajout.ts`
- Modify: `integrations/chronodrive-mcp/src/outils.ts` (supprimer `propositions`, `frais`, `noterPropositions`, `termeCherche`, `propose` et le bloc de commentaires associé ; utiliser la garde)
- Test: `integrations/chronodrive-mcp/test/garde-ajout.test.ts`
- Doc: `.claude/rules/chronodrive.md` ligne 58 (« gardées par client et par terme dans `src/garde-ajout.ts` ») et ligne 42 (`jetonsValides`, `src/jetons.ts`)

**Interfaces:**
- Consumes: `normaliserTerme` (`correspondances.ts`), `produitVu`, `DUREE_FAVORIS_MS`, `OptionsHorloge`, `Produit` (`catalogue.ts`), `PRODUIT_INCONNU` (`panier.ts`). `PRODUIT_NON_PROPOSE` est défini dans `garde-ajout.ts` (cf. Global Constraints).
- Produces:
  ```ts
  export type GardeAjout = {
    // Un appel de chercher_produits = un numéro ; note les produits montrés par terme.
    noterRecherche(client: object, lot: [string, Produit[]][]): void
    // Verdict produit d'une ligne dont les jetons sont déjà valides.
    verdictProduit(client: object, ligne: { terme: string; terme_recherche?: string; productId: string }): "ok" | typeof PRODUIT_NON_PROPOSE | typeof PRODUIT_INCONNU
  }
  export function creerGardeAjout(horloge?: OptionsHorloge): GardeAjout
  ```
  `verdictProduit` = `propose(...)` ? `"ok"` : (`produitVu(client, productId, horloge)` ? `PRODUIT_NON_PROPOSE` : `PRODUIT_INCONNU`) — logique reprise à l'identique de `outils.ts`. Une garde par `creerServeur` (`creerGardeAjout(horloge)`), mémoire `WeakMap` par client interne au module.

- [ ] **Step 1: Tests qui échouent** dans `test/garde-ajout.test.ts`, horloge factice `let t = 0; const garde = creerGardeAjout({ maintenant: () => t })`, client = `{}` ; pour `PRODUIT_INCONNU` vs `NON_PROPOSE`, appeler `noterProduits(client, [...], { maintenant: () => t })` de `catalogue.ts` comme le fait `chercher_produits` :
  - `id lasagnes proposé pour « œufs », ligne « lait »` → `PRODUIT_NON_PROPOSE`.
  - produit proposé pour le terme (casse/accents différents : « Œufs » vs « oeufs ») → `"ok"`.
  - jamais noté nulle part → `PRODUIT_INCONNU`.
  - reformulation cherchée dans un appel postérieur au terme → `"ok"` ; dans le même appel → `PRODUIT_NON_PROPOSE` ; avant le terme → `PRODUIT_NON_PROPOSE` ; terme jamais cherché → `PRODUIT_NON_PROPOSE`.
  - proposition à t=0, verdict à t = 30 min + 1 ms → refus ; re-recherche à 29 min prolonge (verdict à 31 min → `"ok"`).
  - terme élagué (> 30 min) puis re-cherché : son `premierAppel` est le nouvel appel (une reformulation cherchée entre-temps ne passe plus).
  - autre objet client → refus.
- [ ] **Step 2:** `npm test` → échec (module absent).
- [ ] **Step 3:** Créer le module (code déplacé de `outils.ts`, commentaires « Pourquoi » conservés), brancher `outils.ts` : `noterPropositions(client, montresParTerme)` → `garde.noterRecherche(...)` ; dans `ajouter_au_panier`, la ligne `if (propose(...)) … return { …, refus: produitVu(...) ? … }` devient l'appel à `garde.verdictProduit`.
- [ ] **Step 4:** `npm test` (tous verts, `outils.test.ts` intact) et `npm run typecheck`.
- [ ] **Step 5:** Mettre à jour `.claude/rules/chronodrive.md` (emplacements), commit `refactor: garde d'ajout Chronodrive en module testable (#361)`.
