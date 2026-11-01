# PR-A (#320) — Vider le panier Chronodrive hors run : implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un script `src/vider-panier.ts`, lancé sur le NAS, vide le panier Chronodrive courant ligne par ligne, relit le panier pour confirmer qu'il est vide et affiche un récapitulatif. Avec `--simulation`, il liste sans rien retirer.

**Architecture:** `ClientChronodrive.appeler` accepte `DELETE`. Une fonction pure de domaine, `viderPanier(client, { simulation })`, dans `src/panier.ts`, sera réutilisée telle quelle par l'outil MCP `vider_panier` de PR-B. Le script n'est qu'une coquille : arguments, client, appel, mise en forme, code de sortie. Rien n'est exposé à un LLM.

**Tech Stack:** TypeScript à syntaxe effaçable exécuté par Node (24 en local, 26 sur le NAS), sans build ; tests `node:test` ; client simulé `test/simulation.ts`.

**Spec:** `SPECS_FONCTIONNELLES.md` RG-82 (sous-point « Aucun outil de retrait dans le run »), `ADR.md` ADR-12 (« Précisions du grilling de #320 »), issue #320 (« Ajout (2026-11-01) : vider le panier Chronodrive hors run »), `docs/etudes/chronodrive.md` (ligne « Retirer » du protocole).

## Global Constraints

- Code hors outillage de l'app : vérifier dans `integrations/chronodrive-mcp/` avec `npm test` et `npm run typecheck` (la CI ne le voit pas).
- Imports en `.ts`, syntaxe effaçable (`erasableSyntaxOnly`), aucune dépendance nouvelle.
- Identifiants en français, commentaires qui citent RG-82 / #320.
- Retrait : `DELETE /v1/carts/{id}/items/{productId}`, clé de service `CARTS`, réponse 2xx (corps possiblement vide).
- Panier courant relu à chaque exécution (`lirePanierCourant`), jamais d'identifiant en cache.
- **Jamais de commande, de créneau ni de paiement.** Le script n'appelle que `GET` panier et `DELETE` ligne.
- Aucun secret dans une sortie : un message d'erreur passe par `messagePourLeLlm` (`src/outils.ts`), qui ne garde que le `name` d'une erreur étrangère.
- Ne jamais lire ni afficher `/opt/data/chronodrive.env` sur le NAS.

## Review Focus

1. **Une ligne qu'un DELETE n'a pas retirée** (2xx renvoyé, mais produit toujours là à la relecture) doit être signalée comme non retirée, jamais comme « retirée » : le statut se juge à la relecture, pas au code de retour (même principe que RG-83). → test « DELETE 2xx sans effet » (Task 2).
2. **Session expirée ou compte refusé en cours de vidage** : on ne retente pas un login à chaque ligne (règle « tempête de connexions » de `chronodrive.md`), les lignes restantes reviennent « non tenté ». → test « erreur de connexion interrompt la boucle » (Task 2).
3. **Panier déjà vide** : sortie claire « panier déjà vide », code 0, aucun DELETE. → test (Task 2) + test de mise en forme (Task 3).
4. **Relecture finale impossible** (deux échecs) : on ne peut pas dire le panier vide, donc code de sortie non nul et consigne « vérifie dans l'appli ». → test (Task 2).
5. **Argument inconnu ou faute de frappe** (`--simulaton`) : refus avant tout appel réseau, code 2. Sinon, une faute de frappe sur le drapeau viderait le panier pour de vrai. → test (Task 3).

---

### Task 1 : `DELETE` dans le client, et détection d'erreur de connexion partagée

**Files:**
- Modify: `integrations/chronodrive-mcp/src/client.ts` (signature d'`appeler`, ~l.184 ; ajout de `erreurDeConnexion`)
- Modify: `integrations/chronodrive-mcp/src/outils.ts:134-140` (supprimer `ETAPES_CONNEXION` / `erreurDeConnexion` locaux, importer depuis `client.ts`)
- Modify: `integrations/chronodrive-mcp/test/simulation.ts` (type de `methode` de `clientSimule` ; route DELETE dans `panierSimule`)
- Test: `integrations/chronodrive-mcp/test/client.test.ts`

**Interfaces:**
- Produces:
  - `ClientChronodrive.appeler<T>(methode: "GET" | "POST" | "DELETE", chemin: string, options: OptionsAppel): Promise<T>` (corps vide → `null`, comme aujourd'hui)
  - `export function erreurDeConnexion(e: unknown): boolean` dans `src/client.ts`, même définition qu'aujourd'hui dans `outils.ts` (étapes `config`, `config-front`, `login`, `authorize`, `token`, `GET /v1/customers/me`, ou `statut === 401`)
  - `panierSimule(...)` route en plus `DELETE /v1/carts/${id}/items/${productId}` pour chaque produit de `quantites` ; par défaut elle retire la ligne de l'état et renvoie `null`. Un 3ᵉ paramètre optionnel `retrait?: (productId: string) => "retire" | "sans_effet" | Error` règle son comportement (`Error` → levée telle quelle).

- [ ] **Step 1 : tests qui échouent** dans `test/client.test.ts`, sur le modèle des tests existants (`fetch` simulé) :
  - `"DELETE : méthode transmise, corps vide accepté (null)"` : `fetch` simulé répond 204 sans corps ; `await client.appeler("DELETE", "/v1/carts/C1/items/42", { service: "CARTS" })` vaut `null`, et la requête reçue a `method === "DELETE"` avec l'URL `…/v1/carts/C1/items/42`.
  - `"DELETE : 401 de jeton → un seul login puis un seul rejeu"` : même logique que le test GET existant, appliquée à DELETE (2 appels DELETE au total).
- [ ] **Step 2 : lancer et constater l'échec**. Run : `cd integrations/chronodrive-mcp && npm run typecheck` → erreur de type sur `"DELETE"`.
- [ ] **Step 3 : implémenter**. Élargir l'union de méthodes d'`appeler` (et de `clientSimule`). Déplacer `ETAPES_CONNEXION` + `erreurDeConnexion` dans `client.ts`, exportés, et les importer dans `outils.ts`. Ajouter la route DELETE à `panierSimule`.
- [ ] **Step 4 : vérifier**. Run : `npm test && npm run typecheck` → tout passe, y compris les tests existants d'`outils.test.ts` qui couvrent `erreurDeConnexion`.
- [ ] **Step 5 : commit**. `git commit -m "feat: méthode DELETE du client Chronodrive (#320)"`

### Task 2 : `viderPanier` dans `src/panier.ts`

**Files:**
- Modify: `integrations/chronodrive-mcp/src/panier.ts`
- Test: `integrations/chronodrive-mcp/test/panier.test.ts`

**Interfaces:**
- Consumes: `lirePanierCourant`, `erreurDeConnexion`, `panierSimule(id, quantites, ajout?, retrait?)` (Task 1)
- Produces (réutilisé par PR-B) :

```ts
export type StatutRetrait = "simulee" | "retiree" | "toujours_au_panier" | "non_tente" | "non_verifie";
export type LigneRetrait = {
  productId: string;
  libelle: string;      // Produit.libelle de la fiche du panier
  marque: string | null; // Produit.marque
  quantite: number;     // quantité au panier avant retrait
  statut: StatutRetrait;
  erreur: string | null; // messageErreur(e) (déjà dans panier.ts) de l'erreur du DELETE ; pas messagePourLeLlm : outils.ts importe panier.ts
};
export type BilanVidage = {
  panierId: string;
  simulation: boolean;
  lignes: LigneRetrait[];
  vide: boolean; // true seulement si la relecture finale a été faite et ne montre aucune ligne
  relu: boolean; // false si la relecture finale a échoué deux fois
};
export async function viderPanier(client: Appelant, options: { simulation: boolean }): Promise<BilanVidage>;
```

Comportement (RG-82) :
- lire le panier ; en simulation, renvoyer toutes les lignes `simulee` avec `vide: lignes.length === 0` et `relu: true`, sans aucun DELETE ;
- sinon, DELETE ligne par ligne, **en série** ; une erreur sur une ligne n'arrête pas les autres, sauf `erreurDeConnexion(e)`, qui arrête la boucle (lignes suivantes `non_tente`) ;
- relecture finale retentée une fois (comme `ajouterLignes`). Statut de chaque ligne tentée : absente → `retiree`, présente → `toujours_au_panier`. Sans relecture : `non_verifie`, `relu: false`, `vide: false` ;

- [ ] **Step 1 : tests qui échouent** dans `test/panier.test.ts` (`panierSimule("C1", {"1": 2, "2": 1})`) :
  - `"vider : simulation → aucune requête DELETE, lignes « simulee », quantités du panier"` : `compter("DELETE /v1/carts/C1/items/1") === 0` ; `bilan.lignes.map(l => [l.productId, l.quantite, l.statut])` deep-equal `[["1", 2, "simulee"], ["2", 1, "simulee"]]` ; `bilan.vide === false`.
  - `"vider : toutes les lignes retirées puis panier relu vide"` : statuts `retiree`, `vide === true`, `relu === true`, un DELETE par produit.
  - `"vider : panier déjà vide → aucun DELETE, vide"` : `panierSimule("C1", {})` → `lignes` vide, `vide === true`.
  - `"vider : DELETE 2xx sans effet → toujours_au_panier, pas vide"` : `retrait` renvoie `"sans_effet"` pour `"2"` → ligne 2 `toujours_au_panier`, `vide === false`.
  - `"vider : échec d'une ligne n'arrête pas les autres"` : `retrait` lève `new ErreurChronodrive("DELETE /v1/carts/C1/items/1", "réponse HTTP 500")` pour `"1"` → ligne 1 `toujours_au_panier` avec `erreur` non nulle, ligne 2 `retiree`.
  - `"vider : erreur de connexion interrompt la boucle"` : `retrait` lève une `ErreurChronodrive` d'étape `"login"` pour `"1"` → ligne 2 `non_tente`, et `compter("DELETE /v1/carts/C1/items/2") === 0`.
  - `"vider : relecture finale en échec deux fois → non_verifie, relu false, vide false"` (la route `GET /v1/carts/C1` lève au 2ᵉ et au 3ᵉ appel).
- [ ] **Step 2 : lancer et constater l'échec**. Run : `npm test` → `viderPanier` non exporté.
- [ ] **Step 3 : implémenter `viderPanier`** dans `src/panier.ts`, avec le comportement ci-dessus.
- [ ] **Step 4 : vérifier**. Run : `npm test && npm run typecheck` → PASS.
- [ ] **Step 5 : commit**. `git commit -m "feat: viderPanier, retrait ligne à ligne confirmé par relecture (#320, RG-82)"`

### Task 3 : script `src/vider-panier.ts`, docs et changelog

**Files:**
- Create: `integrations/chronodrive-mcp/src/vider-panier.ts`
- Test: `integrations/chronodrive-mcp/test/vider-panier.test.ts`
- Modify: `integrations/chronodrive-mcp/README.md` (nouvelle section « Vider le panier (hors run) » après « Enregistrer l'exécuteur dans OMQ »), `.claude/rules/chronodrive.md`, `CHANGELOG.md` (`[Unreleased]` → « Ajouté »)

**Interfaces:**
- Consumes: `viderPanier`, `BilanVidage` (Task 2) ; `fabriqueClient` (`src/client.ts`) ; `messagePourLeLlm` (`src/outils.ts`)
- Produces (exports testables, le reste n'est que le `main`) :
  - `export function lireArguments(argv: string[]): { simulation: boolean } | { erreur: string }` : `[]` → `{simulation: false}` ; `["--simulation"]` → `{simulation: true}` ; tout autre argument → `{erreur: "argument inconnu : <arg> (seul --simulation est accepté)"}`.
  - `export function formaterBilan(b: BilanVidage): string` : texte français, une ligne par produit « `{quantite} × {libelle} · {marque}` — {statut lisible} », puis une conclusion.
  - `export function codeSortie(b: BilanVidage): 0 | 1` : 0 si `simulation` ou `vide` ; 1 sinon.
- `main` (exécuté seulement quand le fichier est le point d'entrée : `import.meta.url === pathToFileURL(process.argv[1]).href`) : `lireArguments(process.argv.slice(2))`, erreur → stderr + code 2 **avant** de créer le client ; puis `viderPanier(fabriqueClient()(), …)`, `formaterBilan` sur stdout, `process.exitCode = codeSortie(…)` ; une exception → `messagePourLeLlm(e)` sur stderr et code 1.

Textes (fixés) :
- statuts : `simulee` « serait retiré », `retiree` « retiré », `toujours_au_panier` « toujours au panier », `non_tente` « non tenté (connexion interrompue) », `non_verifie` « retrait non vérifié » ; avec `erreur`, ajouter ` : {erreur}` ;
- conclusions : panier vide d'emblée → « Panier déjà vide. » ; simulation → « Simulation : {n} ligne(s) seraient retirées, rien n'a été modifié. » ; `vide` → « Panier vidé : {n} ligne(s) retirée(s), panier relu vide. » ; `!relu` → « Panier non relu : vérifie dans l'appli Chronodrive. » ; sinon → « Panier pas entièrement vidé : {k} ligne(s) restent, vérifie dans l'appli Chronodrive. »

- [ ] **Step 1 : tests qui échouent** dans `test/vider-panier.test.ts` :
  - `"arguments : aucun → vidage ; --simulation → simulation ; faute de frappe refusée"` : `lireArguments(["--simulaton"])` a une `erreur` qui contient `--simulaton`.
  - `"formaterBilan : simulation, vidé, partiel, non relu, déjà vide"` : un bilan construit à la main par cas ; chaque sortie contient la conclusion attendue ci-dessus, et la ligne `"2 × Produit 1 · Marque"`.
  - `"codeSortie : 0 en simulation ou vidé, 1 sinon"`.
  - `"script : argument inconnu → code 2 sans réseau"` : `spawn(process.execPath, [SCRIPT, "--simulaton"], { env: { …sans identifiants, CHRONODRIVE_ENV: <fichier vide temporaire> } })` → code 2, stderr contient « argument inconnu », stdout vide (même montage que `test/demarrage.test.ts`).
- [ ] **Step 2 : lancer et constater l'échec**. Run : `npm test` → module introuvable.
- [ ] **Step 3 : implémenter** `src/vider-panier.ts`, avec un en-tête de commentaire : usage, RG-82, « hors run, jamais exposé à un LLM, jamais de commande ».
- [ ] **Step 4 : vérifier**. Run : `npm test && npm run typecheck` → PASS.
- [ ] **Step 5 : docs.**
  - README, nouvelle section : la commande NAS `$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes node src/vider-panier.ts --simulation`, puis sans `--simulation` ; les codes de sortie 0/1/2 ; la copie du code (étape 2). Le script lit le nouveau code à chaque lancement, donc **pas de redémarrage de la gateway** pour lui. Le MCP en cours garde l'ancien code jusqu'au prochain redémarrage, et c'est compatible.
  - `chronodrive.md` : `DELETE v1/carts/{id}/items/{productId}` (clé `CARTS`) retire la ligne entière ; un retrait se confirme à la relecture, jamais au code de retour ; `erreurDeConnexion` vit dans `client.ts` ; le vidage n'existe que hors run (script, puis `chronodrive-admin` en PR-B). Pour chaque entrée, la règle puis le « Pourquoi ».
  - `CHANGELOG.md` `[Unreleased]` / « Ajouté » : « Exécuteur Chronodrive : script pour vider le panier hors run, avec un mode simulation (#320). »
- [ ] **Step 6 : commit**. `git commit -m "feat: script vider-panier de l'exécuteur Chronodrive (#320)"`

### Task 4 : recette sur le NAS (avec Arnaud)

Aucun code. Le contrôleur la fait lui-même, ce n'est pas une tâche de sous-agent.

- [ ] **Step 1** : copier le code sur le NAS (README, étape 2 : `tar` sans `node_modules`, `test`, `mesures`). Pas de `npm ci` : aucune dépendance nouvelle. Pas de redémarrage.
- [ ] **Step 2** : `node src/vider-panier.ts --simulation` dans le conteneur → la liste correspond au panier vu dans l'appli Chronodrive, code 0, aucune ligne retirée.
- [ ] **Step 3** : **demander à Arnaud son accord explicite**, puis lancer `node src/vider-panier.ts` → « Panier vidé … panier relu vide », code 0 ; Arnaud constate le panier vide dans l'appli.
- [ ] **Step 4** : consigner la recette (commande, nombre de lignes, durée, constat) dans `integrations/chronodrive-mcp/mesures/vidage-2026-11-<jj>.md` ; commit `docs: recette du vidage de panier sur le NAS (#320)`.

---

## Après le plan

Revue finale de la branche, puis correction de **tous** les mineurs. Ensuite `graphify update .`, push, PR avec `Refs #320` et la mise à jour de la case « PR-A » de l'issue. Aucune e2e : le code est hors app (règle `chronodrive.md`), la CI de l'app ignore ce dossier. Merge sur CI verte.
