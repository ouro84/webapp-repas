# Serveur MCP `chronodrive-admin` (PR-B de #320) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vider le panier Chronodrive depuis Telegram, hors run, par l’outil `vider_panier` d’un serveur MCP séparé `chronodrive-admin`, en deux temps (aperçu + jeton, puis confirmation refusée si le panier a changé).

**Architecture:** Le vidage existe déjà (`viderPanier`, `src/panier.ts`, PR-A). On lui ajoute un jeton d’état du panier (`jetonPanier`) et une option `jetonAttendu` vérifiée dans la même lecture que le vidage. Un nouveau module `src/admin.ts` (`creerServeurAdmin`) n’enregistre que `vider_panier` ; un point d’entrée distinct `src/mcp-admin.ts` le lance en stdio. `src/mcp.ts` et ses outils ne changent pas : le run webhook ne voit toujours aucun outil de retrait.

**Tech Stack:** Node ≥ 24 (TypeScript à syntaxe effaçable, sans build), `@modelcontextprotocol/sdk` 1.32.2, zod 4, `node --test`.

**Spec:** `SPECS_FONCTIONNELLES.md` RG-82 (sous-puce « Aucun outil de retrait dans le run »), `ADR.md` ADR-12 (« Vider le panier hors run »). Décisions du grilling #320 (2026-11-01) : Q4 point d’entrée séparé `src/mcp-admin.ts` + test `tools/list` ; Q5 `vider_panier` en deux temps ; Q13 `chronodrive-admin` sur Telegram seul.

## Global Constraints

- Code dans `integrations/chronodrive-mcp/` : hors outillage de l’app (pas de Vitest, pas de CI). Vérifier par `npm test` et `npm run typecheck` **dans ce dossier**. Imports en `.ts`, `erasableSyntaxOnly`.
- Serveur séparé : nom MCP `chronodrive-admin`, **un seul outil** `vider_panier`. `src/mcp.ts` / `NOMS_OUTILS` (serveur `chronodrive`) restent sans aucun outil de retrait.
- `vider_panier` sans `confirmation` : ne retire rien, renvoie les lignes et un `jeton` lié à l’état du panier (id du panier + lignes `productId` × quantité). Avec `confirmation` égale au jeton du panier relu : vide, puis relit (bilan de `viderPanier`). Jeton différent : **aucun DELETE**, refus « Le panier a changé depuis l’aperçu : relance vider_panier sans confirmation pour un nouvel aperçu. »
- Écriture seulement si `CHRONODRIVE_LECTURE_SEULE === '0'` (même règle que `chronodrive`) : sinon l’aperçu marche, la confirmation est refusée sans appel API (« Lecture seule : CHRONODRIVE_LECTURE_SEULE ne vaut pas '0', rien n’est retiré. »).
- stdout = canal JSON-RPC (aucun `console.log`) ; client créé au premier appel d’outil (`initialize`/`tools/list` sans identifiants ni réseau) ; toute erreur renvoyée au LLM passe par `messagePourLeLlm`.
- Aucune commande, aucun créneau, aucun paiement. Description de l’outil : réservé à une demande explicite de l’utilisateur sur Telegram, jamais pendant un run de panier, montrer l’aperçu et attendre un « oui » avant la confirmation.
- Langue : identifiants, messages, commentaires en français ; commentaires citent RG-82 / #320.
- `CHANGELOG.md` et `.claude/rules/chronodrive.md` mis à jour dans la PR (critère de merge).

## Rulings (décisions prises au plan)

- **Jeton sans état serveur** : `sha256(panierId + lignes triées "productId:quantite")`, 16 premiers caractères hex. Pourquoi : le processus MCP peut redémarrer entre l’aperçu et la confirmation ; un jeton calculé reste valable tant que le panier n’a pas bougé. Coût si faux : un LLM pourrait enchaîner aperçu et confirmation sans montrer l’aperçu ; la garde humaine reste la consigne de la description (Telegram seul, réponse de l’utilisateur).
- **Le contrôle du jeton se fait dans `viderPanier`, sur sa propre lecture du panier**, avant tout DELETE. Pourquoi : un contrôle dans une lecture séparée laisserait une fenêtre où le panier change entre le contrôle et le vidage.
- **`chronodrive-admin` respecte aussi `CHRONODRIVE_LECTURE_SEULE`**. Pourquoi : un oubli de variable dans `config.yaml` ne doit jamais vider un panier. Coût si faux : une ligne `env` de plus dans `config.yaml`.

## Review Focus

1. Panier modifié entre l’aperçu et la confirmation (ajout à la main dans l’appli) : refus, aucun DELETE, message qui dit de relancer l’aperçu. → test Task 1 + Task 2.
2. Panier déjà vide : l’aperçu le dit, la confirmation ne fait aucun appel d’écriture et répond « Panier déjà vide. ». → test Task 2.
3. Commande validée entre l’aperçu et la confirmation (nouvel id de panier) : le jeton ne correspond plus → refus. → test Task 1.
4. Lecture seule (variable absente) : l’aperçu marche, la confirmation est refusée sans DELETE. → test Task 2 + démarrage Task 2.
5. Le serveur `chronodrive` (run webhook) ne liste toujours pas `vider_panier`, et `chronodrive-admin` ne liste que lui. → tests de démarrage Task 2.

---

### Task 1 : jeton d’état du panier et vidage conditionnel

**Files:**
- Modify: `integrations/chronodrive-mcp/src/panier.ts` (`viderPanier`, `BilanVidage`, ~l. 246-308)
- Test: `integrations/chronodrive-mcp/test/panier.test.ts`

**Interfaces:**
- Produces:
  - `export function jetonPanier(panier: { id: string; lignes: Map<string, number> }): string` — 16 caractères hex, indépendant de l’ordre d’insertion des lignes.
  - `export const PANIER_CHANGE = "Le panier a changé depuis l’aperçu : relance vider_panier sans confirmation pour un nouvel aperçu."`
  - `export class ErreurPanierChange extends Error` (message `PANIER_CHANGE`).
  - `viderPanier(client, options: { simulation: boolean; jetonAttendu?: string }): Promise<BilanVidage>` ; `BilanVidage` gagne `jeton: string` (jeton du panier lu **avant** tout retrait).

- [ ] **Step 1 : tests qui échouent** (`test/panier.test.ts`, client simulé `test/simulation.ts`)
  - `jetonPanier` : même jeton pour les mêmes lignes insérées dans un autre ordre ; jeton différent si une quantité change, si une ligne s’ajoute, si l’id du panier change ; longueur 16, `/^[0-9a-f]{16}$/`.
  - `viderPanier(…, { simulation: true })` renvoie `jeton === jetonPanier(panier lu)`.
  - `viderPanier(…, { simulation: false, jetonAttendu: <jeton de l’aperçu> })` sur un panier inchangé → vidage normal (DELETE envoyés, `vide: true`).
  - `jetonAttendu` différent (panier où une quantité a changé) → rejette `ErreurPanierChange`, **aucune** requête `DELETE` dans le journal du client simulé.
  - `jetonAttendu` d’un autre id de panier (commande validée) → `ErreurPanierChange`, aucun DELETE.
  - Sans `jetonAttendu` : comportement inchangé (tests PR-A existants verts, `vider-panier.ts` inchangé).
- [ ] **Step 2 :** `npm test` (dans `integrations/chronodrive-mcp`) → les nouveaux tests échouent.
- [ ] **Step 3 :** implémenter (`node:crypto` `createHash("sha256")` ; lignes triées par `productId`). Le contrôle du jeton suit la lecture `avant` et précède toute requête d’écriture.
- [ ] **Step 4 :** `npm test` et `npm run typecheck` → PASS.
- [ ] **Step 5 : commit** `feat: jeton d’état du panier et vidage conditionnel (#320, RG-82)`

### Task 2 : serveur MCP `chronodrive-admin` et son outil `vider_panier`

**Files:**
- Create: `integrations/chronodrive-mcp/src/admin.ts`, `integrations/chronodrive-mcp/src/mcp-admin.ts`, `integrations/chronodrive-mcp/test/admin.test.ts`
- Modify: `integrations/chronodrive-mcp/test/demarrage.test.ts`, `integrations/chronodrive-mcp/README.md` (section « Vider le panier (hors run) », étape 4 `config.yaml`, étape 8 toolsets), `.claude/rules/chronodrive.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `jetonPanier`, `viderPanier({ simulation, jetonAttendu })`, `ErreurPanierChange`, `BilanVidage` (Task 1) ; `formaterBilan(b: BilanVidage): string` (`src/vider-panier.ts`, existant) ; `messagePourLeLlm`, `ErreurOutil` (`src/outils.ts`) ; `fabriqueClient()` (`src/client.ts`).
- Produces:
  - `export const NOMS_OUTILS_ADMIN = ["vider_panier"] as const`
  - `export const LECTURE_SEULE_ADMIN = "Lecture seule : CHRONODRIVE_LECTURE_SEULE ne vaut pas '0', rien n’est retiré."`
  - `export function creerServeurAdmin(deps: { client: () => Appelant; lectureSeule: boolean }): McpServer` — nom MCP `chronodrive-admin` (`Appelant` vient de `src/catalogue.ts`).
  - Outil `vider_panier`, entrée `{ confirmation?: string }`, `annotations: { destructiveHint: true, readOnlyHint: false }`. Sortie `structuredContent` : aperçu → `{ etape: "apercu", jeton, lignes: [{ libelle, marque, quantite }], message }` ; confirmation → `{ etape: "vidage", vide, relu, restantes, message }` où `message = formaterBilan(bilan)`.

- [ ] **Step 1 : tests unitaires qui échouent** (`test/admin.test.ts`, serveur branché par `InMemoryTransport` comme `test/outils.test.ts`)
  - `tools/list` du serveur admin → exactement `["vider_panier"]`.
  - aperçu (sans `confirmation`) : aucun DELETE, `etape: "apercu"`, `jeton` = `jetonPanier` du panier simulé, lignes avec libellé, marque, quantité ; panier vide → message « Panier déjà vide. ».
  - confirmation avec le bon jeton, `lectureSeule: false` → DELETE envoyés, `etape: "vidage"`, `vide: true`, message « Panier vidé : … ».
  - confirmation avec un jeton périmé → `isError`, texte `PANIER_CHANGE`, aucun DELETE.
  - confirmation avec `lectureSeule: true` → `isError`, texte `LECTURE_SEULE_ADMIN`, aucune requête réseau d’écriture.
  - erreur de connexion simulée → `isError` avec le message de `messagePourLeLlm` (aucun secret).
- [ ] **Step 2 : tests de démarrage** (`test/demarrage.test.ts`) : `node src/mcp-admin.ts` (env vide, comme le test existant) répond à `initialize` et `tools/list` = `["vider_panier"]`, stdout en JSON-RPC seulement ; le test existant de `src/mcp.ts` vérifie aussi que `vider_panier` n’est **pas** listé.
- [ ] **Step 3 :** `npm test` → échecs attendus.
- [ ] **Step 4 :** implémenter `src/admin.ts` (description de l’outil : réservé à une demande explicite sur Telegram, hors run de panier ; d’abord sans `confirmation`, montrer les lignes, ne passer `confirmation` = jeton qu’après un « oui » explicite ; ne passe ni commande ni créneau) et `src/mcp-admin.ts` (même forme que `src/mcp.ts` : `creerServeurAdmin({ client: fabriqueClient(), lectureSeule: process.env.CHRONODRIVE_LECTURE_SEULE !== "0" })`, `StdioServerTransport`, rien sur stdout).
- [ ] **Step 5 :** `npm test` et `npm run typecheck` → PASS.
- [ ] **Step 6 : doc et règles.**
  - README : « Vider le panier (hors run) » présente le script (inchangé) puis l’outil Telegram `vider_panier` en deux temps ; étape 4 ajoute l’entrée `config.yaml` :
    ```yaml
      chronodrive-admin:
        command: node
        args:
          - /opt/data/chronodrive-mcp/src/mcp-admin.ts
        env: {CHRONODRIVE_LECTURE_SEULE: '0'}
        enabled: true
    ```
    étape 8 : `chronodrive-admin` ajouté à `platform_toolsets.telegram` (par son NOM), jamais à `whatsapp` ni aux `toolsets` de la route `panier-omq`.
  - `chronodrive.md` : remplacer « Aucun outil MCP de retrait » par la règle du serveur séparé (`chronodrive-admin`, `vider_panier` seul, deux temps, jeton contrôlé dans la lecture du vidage, Telegram seul) + Pourquoi ; ajouter à la règle `platform_toolsets` que `telegram` nomme `chronodrive-admin`.
  - `CHANGELOG.md` `[Unreleased]` / « Ajouté » : « Exécuteur Chronodrive : vider le panier depuis Telegram (`vider_panier`, serveur `chronodrive-admin`), avec aperçu puis confirmation, refusée si le panier a changé (#320). »
- [ ] **Step 7 : commit** `feat: serveur MCP chronodrive-admin, vider_panier en deux temps (#320, RG-82)`

## Après le plan (contrôleur, avec Arnaud)

1. Revue finale de la branche, puis correction de **tous** les constats, mineurs compris.
2. `graphify update .`, push, PR `Refs #320`, merge sur CI verte (seul Vercel tourne : code hors CI ; les tests de l’exécuteur sont ceux lancés à la main).
3. NAS (toute étape : sauvegarde d’abord) :
   - sauvegarder le code (`/opt/data/chronodrive-mcp.bak-avant-320-prb.tgz`) et `config.yaml` (`config.yaml.bak-avant-320-prb`) ;
   - copier le code (README étape 2) ;
   - `config.yaml` : entrée `chronodrive-admin` sous `mcp_servers`, nom ajouté à `platform_toolsets.telegram` ; vérifier que `whatsapp` et la route `panier-omq` (`webhook_subscriptions.json`) ne le nomment pas ;
   - redémarrer la gateway **seulement sur accord explicite d’Arnaud** (le serveur `chronodrive` doit charger le nouveau `panier.ts`).
4. Recette sur Telegram avec Arnaud, panier non vide (premier `DELETE` réel) : aperçu ; confirmation après un ajout à la main dans l’appli → refus ; nouvel aperçu, confirmation → panier vidé et relu vide ; vérifier dans l’appli. Vérifier sur WhatsApp qu’aucun `mcp__chronodrive-admin__*` n’apparaît. Mesures : `integrations/chronodrive-mcp/mesures/vidage-admin-<date>.md`.
