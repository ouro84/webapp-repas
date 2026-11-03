# Gardes serveur du run de panier (#330) — plan d'implémentation

> **Pour les agents :** sous-skill requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** un run de panier qui saute `prendre_demande_panier` ou invente une `ancre` ne peut ni cocher dans OMQ ni ajouter au panier Chronodrive, et s'arrête sur une erreur lisible.

**Architecture :**
- Un endpoint MCP dédié, `/api/mcp/executeur`, n'expose que les trois outils du run :
  - `prendre_demande_panier` : renvoie la liste et un jeton signé par article ;
  - `cocher_article_demande` : sans `ancre`, il lit l'ancre dans la demande `en_cours` ;
  - `rapporter_panier`.
- Postgres signe les jetons avec une sous-clé dérivée du secret Vault de l'exécuteur. `chronodrive` vérifie ces jetons dans `ajouter_au_panier`, avec le même secret (`OMQ_WEBHOOK_SECRET`).
- La route Hermes `panier-omq` ne voit plus que `chronodrive` et « OMQ exécuteur ».

**Stack :** Next.js 16 (App Router), `mcp-handler` v2, Supabase (pgcrypto, Vault), Vitest, Playwright. Côté `chronodrive` : Node `--test` et zod 4.

**Spec :** issue #330, avec les décisions du grilling : https://github.com/ouro84/webapp-repas/issues/330#issuecomment-6598594505. Lire aussi RG-81→85 (`SPECS_FONCTIONNELLES.md`), ADR-12 (`ADR.md`), `.claude/rules/chronodrive.md`, `mcp.md` et `supabase.md`.

## Contraintes globales

- **Format du jeton :** `<demande_id>.<exp>.<mac>`.
  - `exp` : epoch en secondes, égal à `pris_le + 30 min` (RG-83).
  - `mac` : 32 premiers caractères hex de `HMAC-SHA256(sous_cle, "<demande_id>|<cle>|<exp>")`.
  - `sous_cle` : `HMAC-SHA256(cle_secret, "jetons-panier")`.
  - `cle_secret` : `base64decode(secret sans "whsec_")` si le secret commence par `whsec_`, sinon les octets UTF-8 du secret. C'est exactement la règle de `creer_demande_panier`.
- **`cle` d'un libellé :** `cleJeton(s) = s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr")`.
  - Cette fonction a un jumeau, `lib/jeton-panier.ts` côté OMQ et `integrations/chronodrive-mcp/src/jetons.ts` côté chronodrive. Les deux sont testés sur le même fichier de vecteurs.
- **Le jeton ne lie pas les quantités.** La garde `quantite` de 1 à 20 reste inchangée.
- **Pas de contrôle du `client_id`.** Pas de plugin Hermes. Le modèle `glm-5.3-flash` est conservé.
- **Endpoint général `/api/mcp` :** il perd `prendre_demande_panier` et `rapporter_panier`. `cocher_article(ancre)` et `lire_liste_courses(ancre)` restent inchangés.
- **Refus par défaut dans `chronodrive` :** écriture armée (`CHRONODRIVE_LECTURE_SEULE='0'`) sans `OMQ_WEBHOOK_SECRET` → tout ajout est refusé.
- **Livraison :** une seule PR. Tout est en français : identifiants, messages, commentaires qui citent RG/US. Commits `type: …`.
- **E2E :** sur staging seulement (`npm run test:e2e:staging`), après avoir appliqué la migration sur staging (`supabase.md`). Port 3000 pris → `E2E_PORT=3001`.
- **Tests de `chronodrive` :** hors CI (paths-ignore). Les lancer en local : `cd integrations/chronodrive-mcp && npm test && npm run typecheck`.

## Points de vigilance de la revue

1. **Libellé recopié avec une autre casse ou d'autres espaces** (« Tomates  cerises » au lieu de « tomates cerises ») : la ligne doit être acceptée, grâce à `cleJeton`. Test en tâche 1.
2. **Ligne fusionnée dont un jeton est expiré, ou dont aucun jeton ne couvre `terme`** : la ligne entière est refusée et n'est pas envoyée. Test en tâche 5.
3. **Jeton d'une demande précédente, encore dans le contexte du modèle** : refusé dès qu'il est expiré. Il ne peut pas couvrir un terme qu'il ne signe pas. Test en tâche 5.
4. **Cycle modifié entre la demande et la prise** (jour de courses changé) : `prendre` rapporte lui-même l'échec et ne renvoie aucune liste. Test en tâche 3.
5. **Homonymes** (même libellé en deux unités) : ils partagent le même jeton. `cocher_article_demande` renvoie les `candidats` sans rien cocher, comme `cocher_article`. Test en tâche 3.

---

### Tâche 1 : jumeau `cleJeton` et vérification du jeton

**Fichiers :**
- Créer : `lib/jeton-panier.ts`, `lib/jeton-panier.test.ts`
- Créer : `integrations/chronodrive-mcp/src/jetons.ts`, `integrations/chronodrive-mcp/test/jetons.test.ts`
- Créer : `integrations/chronodrive-mcp/test/vecteurs-jetons.json`

**Interfaces :**
- Produit, dans `lib/jeton-panier.ts` : `cleJeton(libelle: string): string`.
- Produit, dans `src/jetons.ts` :
  - `cleJeton(libelle: string): string`, jumeau de celui d'OMQ ;
  - `signerJeton(secret: string, demandeId: string, libelle: string, exp: number): string`, réservé aux tests et aux vecteurs ;
  - `verifierJeton(secret: string, jeton: string, terme: string, maintenantMs: number): { ok: true; demandeId: string } | { ok: false; raison: "format" | "signature" | "expire" }`.

- [ ] **Étape 1 : écrire `vecteurs-jetons.json`.** Il contient environ 6 entrées `{ secret, demande_id, libelle, cle, exp, jeton }` :
  - un secret `whsec_…` et un secret brut ;
  - des libellés avec accents, majuscules et espaces multiples (« Crème  fraîche », « Œufs ») ;
  - les valeurs `jeton` sont calculées une fois avec `signerJeton` et figées dans le fichier.
- [ ] **Étape 2 : tests qui échouent.**
  - `lib/jeton-panier.test.ts` : pour chaque vecteur, `cleJeton(libelle) === cle`. Import JSON par le chemin relatif `../integrations/chronodrive-mcp/test/vecteurs-jetons.json`.
  - `test/jetons.test.ts` :
    - `cleJeton(libelle) === cle` ;
    - `signerJeton(...) === jeton` ;
    - `verifierJeton(secret, jeton, libelle, (exp - 1) * 1000)` → `{ ok: true, demandeId }` ;
    - même appel avec le terme en MAJUSCULES et des espaces doublés → `ok` ;
    - `maintenantMs = exp * 1000 + 1` → `raison: "expire"` ;
    - autre terme → `"signature"` ;
    - mac altéré d'un caractère → `"signature"` ;
    - `"abc"` → `"format"` ;
    - mauvais secret → `"signature"`.
- [ ] **Étape 3 : vérifier l'échec.** Commandes : `npx vitest run lib/jeton-panier.test.ts`, puis `cd integrations/chronodrive-mcp && node --test test/jetons.test.ts`. Attendu : FAIL (module absent).
- [ ] **Étape 4 : implémenter.** Dans `src/jetons.ts`, utiliser `node:crypto` `createHmac`. La comparaison du mac se fait en temps constant (`timingSafeEqual` sur des buffers de même longueur). Les deux `cleJeton` sont identiques à la contrainte globale. Chaque fichier porte un commentaire « jumeau de … ».
- [ ] **Étape 5 : vérifier le succès.** Mêmes commandes, attendu : PASS.
- [ ] **Étape 6 : commit.** `feat: jetons signés du run de panier, jumeau OMQ/chronodrive (#330)`

---

### Tâche 2 : migration — demande en cours et signature des jetons

**Fichiers :**
- Créer : `supabase/migrations/20261103120000_jetons_panier.sql`
- Modifier : `lib/panier.ts`, dictionnaire `MESSAGES_PANIER`, pour ajouter `OMQ05`

**Interfaces :**
- Produit, la RPC `demande_panier_en_cours() returns jsonb` :
  - foyer = `mon_foyer()` ;
  - appelle `expirer_demandes_panier(foyer)`, puis renvoie `{id, ancre, pris_le}` de la demande `en_cours` du foyer, ou `null`.
- Produit, la RPC `signer_jetons_panier(p_demande uuid, p_cles text[]) returns jsonb` :
  - même verrou consultatif `hashtext('panier:'||foyer)` que les RPC du cycle de vie, puis expiration ;
  - si la demande n'est pas une demande `en_cours` du foyer : `raise … using errcode = 'OMQ05'` ;
  - si `cardinality(p_cles) > 500` : `22023` ;
  - lit le secret comme `creer_demande_panier` (même message si Vault est vide) ;
  - renvoie `{ "expire_le": <exp>, "jetons": [<jeton par clé, même ordre>] }` au format des contraintes globales.
- Les deux fonctions sont `security definer` avec `set search_path = public, extensions` (comme les RPC existantes de `20261031120000_demande_panier.sql`). Elles ont `grant execute … to authenticated`, et `revoke … from public, anon`.
- `MESSAGES_PANIER.OMQ05` = « Aucune demande de panier prise : appelle d'abord prendre_demande_panier. Sans demande prise, n'ajoute rien au panier, ne coche rien et arrête-toi. »

- [ ] **Étape 1 : écrire la migration.** Calquer l'en-tête, les droits et la lecture du secret sur `20261101120000_panier_multi_cycle.sql:86-187`. Commentaire de tête : #330, RG-83 et RG-85, la clé ne quitte jamais Postgres, et la rotation du secret webhook est couplée à `chronodrive`.
- [ ] **Étape 2 : appliquer sur staging.** Commande : `node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "$(cat supabase/migrations/20261103120000_jetons_panier.sql)"`, puis inscrire la version dans `supabase_migrations.schema_migrations`, comme décrit dans `supabase.md`. Attendu : aucune erreur.
- [ ] **Étape 3 : vérification rapide.** `select signer_jetons_panier(gen_random_uuid(), array['x'])`, exécuté via l'API de management sous le rôle `postgres`, sans foyer. Attendu : une erreur, sans aucun jeton renvoyé. La vérification complète se fait en e2e (tâche 6).
- [ ] **Étape 4 : commit.** `feat: RPC demande_panier_en_cours et signer_jetons_panier (#330)`

---

### Tâche 3 : outils du run — `prendre` enrichi et `cocher_article_demande`

**Fichiers :**
- Créer : `lib/mcp/executeur.ts`, `lib/mcp/executeur.test.ts`
- Modifier : `lib/mcp/panier.ts`. Retirer `prendreDemandePanier` et le type `DemandePrise`. Garder `rapporterPanier` et `lancerDemandePanierMcp`.
- Modifier : `lib/mcp/panier.test.ts`. Déplacer les tests de `prendre` vers `executeur.test.ts`.

**Interfaces :**
- Consomme :
  - `cleJeton` (tâche 1) ;
  - les RPC de la tâche 2 et `MESSAGES_PANIER.OMQ05` ;
  - `rapporterPanier(supabase, args)` (`lib/mcp/panier.ts`) ;
  - `resoudreAncreCycle` (`lib/ancre-cycle.ts`) ;
  - `chargerListeCoursesCycle` et `retirerArticlesCoches` (comme `lireListeCourses`) ;
  - `versArticle` et `libelleCycle` (`lib/mcp/lecture.ts`) ;
  - `cocherArticle(supabase, { libelle, quantite, ancre }, aujourdhui)` (`lib/mcp/ecriture-courses.ts`).
- Produit, les types :
  ```ts
  export type ArticleDemande = { libelle: string; quantite: string; rayon: string; placard: boolean; manuel: boolean; jeton: string }
  export type PriseDemande =
    | { demande: { id: string; ancre: string; cycle: { du: string; au: string; libelle: string }; expire_le: string; articles: ArticleDemande[] } }
    | { demande: null; raison: string }
  ```
- Produit, les fonctions :
  - `prendreDemandeExecuteur(supabase: ClientSupabase, aujourdhui: Date): Promise<PriseDemande>` ;
  - `cocherArticleDemande(supabase: ClientSupabase, args: { libelle: string; quantite?: string }, aujourdhui: Date): Promise<CochageMcp>`.

Comportement de `prendreDemandeExecuteur` :
- RPC `prendre_demande_panier` → `null` : renvoyer `{ demande: null, raison: "Aucune demande en attente : arrête-toi sans rien faire d'autre." }`.
- Cycle changé (`resoudreAncreCycle` échoue, ou son ancre ≠ `demande.ancre`) : appeler `rapporterPanier` avec `statut "echec"`, des listes vides et le motif « Le cycle de courses a changé depuis la demande : relance le panier depuis /courses. », puis renvoyer `demande: null` avec ce motif.
- Liste vide : appeler `rapporterPanier` avec `statut "terminee"` et des listes vides, puis renvoyer `demande: null` avec la raison « Liste de courses vide : rien à ajouter, compte-rendu envoyé. ».
- Sinon :
  - `libelle` = `versArticle(i, null).nom` et `rayon` = libellé de la catégorie ;
  - jetons obtenus par `signer_jetons_panier(id, articles.map(a => cleJeton(a.libelle)))` ;
  - `expire_le` = ISO de `expire_le`.

Comportement de `cocherArticleDemande` :
- RPC `demande_panier_en_cours` → `null` : `ErreurOutil(MESSAGES_PANIER.OMQ05)`.
- Sinon : `cocherArticle(supabase, { libelle, quantite, ancre: demande.ancre }, aujourdhui)`. Jamais de décochage.

- [ ] **Étape 1 : tests qui échouent** (`executeur.test.ts`, Supabase simulé, même style que `panier.test.ts`) :
  - `prendre sans demande → demande null, aucun appel à signer_jetons_panier`
  - `prendre → articles non cochés du cycle demande.ancre, chacun avec le jeton renvoyé par signer_jetons_panier, clés passées = cleJeton(libellé)`
  - `prendre, cycle changé → rapporter_panier echec avec le motif, demande null`
  - `prendre, liste vide → rapporter_panier terminee listes vides, demande null`
  - `cocher_article_demande sans demande en cours → ErreurOutil OMQ05, aucune écriture`
  - `cocher_article_demande → cocherArticle appelé avec ancre = demande.ancre, jamais celle du jour`
  - `cocher_article_demande, homonymes → candidats, rien coché`
- [ ] **Étape 2 : vérifier l'échec.** Commande : `npx vitest run lib/mcp/executeur.test.ts lib/mcp/panier.test.ts`. Attendu : FAIL.
- [ ] **Étape 3 : implémenter `lib/mcp/executeur.ts`.** En-tête : #330, RG-83, RG-85.
- [ ] **Étape 4 : vérifier le succès.** Même commande, attendu : PASS.
- [ ] **Étape 5 : commit.** `feat: prendre_demande_panier renvoie la liste signée, cocher_article_demande (#330)`

---

### Tâche 4 : endpoint `/api/mcp/executeur` et metadata OAuth

**Fichiers :**
- Créer : `lib/mcp/route.ts`, avec la fabrique de route partagée (auth, quota et 429 sortis de `app/api/mcp/route.ts`).
- Modifier : `app/api/mcp/route.ts`, qui utilise la fabrique.
- Créer : `app/api/mcp/executeur/route.ts`, `app/api/mcp/executeur/route.test.ts`
- Modifier : `lib/mcp/serveur.ts`. Retirer `prendre_demande_panier` et `rapporter_panier` de `enregistrerOutilsEcriture`. Ajouter `enregistrerOutilsExecuteur`.
- Modifier : `app/.well-known/oauth-protected-resource/[[...ressource]]/route.ts` et son test.
- Modifier : `app/api/mcp/route.test.ts`.

**Interfaces :**
- Consomme : `prendreDemandeExecuteur` et `cocherArticleDemande` (tâche 3), `rapporterPanier`.
- Produit :
  - `creerRouteMcp(enregistrer: (server: McpServer) => void, nom: string, cheminRessource: string): (req: Request) => Promise<Response>` dans `lib/mcp/route.ts` ;
  - `enregistrerOutilsExecuteur(server: McpServer): void` dans `lib/mcp/serveur.ts`.
- Route exécuteur : `creerRouteMcp(enregistrerOutilsExecuteur, "omq-executeur", "/.well-known/oauth-protected-resource/api/mcp/executeur")`.
- Metadata : `resource` = origine + `/api/mcp/executeur` si le suffixe est `api/mcp/executeur`, sinon `/api/mcp` comme aujourd'hui. Tout autre suffixe garde le comportement actuel.

Descriptions des outils exécuteur :
- **`prendre_demande_panier`** : « À appeler en premier, avant toute autre action. Renvoie la demande et la liste à mettre au panier. Chaque article porte un `jeton` à recopier tel quel dans `jetons` de ajouter_au_panier. `demande: null` → arrête-toi. »
- **`cocher_article_demande`** :
  - schéma `{ libelle: string, quantite?: string }` ;
  - description : « Coche l'article juste après son ajout confirmé au panier. Le cycle vient de la demande prise : il n'y a pas d'`ancre`. »
- **`rapporter_panier`** : schéma inchangé. Remplacer `cocher_article` par `cocher_article_demande` dans la description.

`executer` reste privé à `serveur.ts` ; il passe `aujourdhuiParis()`.

- [ ] **Étape 1 : tests qui échouent.**
  - `executeur/route.test.ts` :
    - `tools/list` sur `/api/mcp/executeur` → exactement `["prendre_demande_panier", "cocher_article_demande", "rapporter_panier"]` ;
    - sans jeton → 401, `WWW-Authenticate` contient `oauth-protected-resource/api/mcp/executeur` ;
    - quota dépassé → 429 ;
    - `cocher_article_demande` appelle `cocherArticleDemande`.
  - `app/api/mcp/route.test.ts` : `tools/list` ne contient plus `prendre_demande_panier` ni `rapporter_panier`, et contient toujours `cocher_article` et `lancer_demande_panier`.
  - Test metadata : `/.well-known/oauth-protected-resource/api/mcp/executeur` → `resource` se termine par `/api/mcp/executeur`.
- [ ] **Étape 2 : vérifier l'échec.** Commande : `npx vitest run app/api/mcp app/.well-known`. Attendu : FAIL.
- [ ] **Étape 3 : implémenter.** La fabrique d'abord, puis les deux routes, puis les outils et la metadata. Le proxy laisse déjà passer `/api/mcp/` (`sansSession`) : aucune modification.
- [ ] **Étape 4 : vérifier le succès.** Commandes : `npm run test:run && npx tsc --noEmit && npm run lint`. Attendu : tout vert.
- [ ] **Étape 5 : commit.** `feat: endpoint MCP /api/mcp/executeur réservé au run de panier (#330)`

---

### Tâche 5 : `chronodrive`, `ajouter_au_panier` exige des jetons valides

**Fichiers :**
- Modifier : `integrations/chronodrive-mcp/src/outils.ts`. Champ `jetons` sur chaque ligne de `ajouter_au_panier`, garde avant `propose`, `Dependances.secretJetons`.
- Modifier : `integrations/chronodrive-mcp/src/client.ts`. Ajouter `lireSecretJetons(env?: Env, chemin?: string): string | null` : lit `OMQ_WEBHOOK_SECRET` (le fichier l'emporte sur l'environnement), et renvoie `null` si la variable est absente ou vide.
- Modifier : `integrations/chronodrive-mcp/src/mcp.ts`. Passer `secretJetons: () => lireSecretJetons()`, relu à chaque appel comme le client.
- Modifier : `integrations/chronodrive-mcp/test/outils.test.ts`, `test/simulation.ts` si elle construit les dépendances.

**Interfaces :**
- Consomme : `verifierJeton` et `cleJeton` (tâche 1).
- Schéma de ligne : ajouter `jetons: z.array(z.string().trim().max(120)).min(1).max(10).describe("jeton de chaque article OMQ couvert par cette ligne, recopié tel quel depuis prendre_demande_panier")`.

Garde, dans l'ordre, au début du handler :
1. `lectureSeule` → refus actuel, inchangé.
2. `secretJetons()` vaut `null` → `ErreurOutil("OMQ_WEBHOOK_SECRET absent de chronodrive.env : aucun ajout possible sans vérifier les jetons de la demande OMQ")`.
3. Pour chaque ligne :
   - chaque jeton doit être `ok` ;
   - tous les jetons doivent porter le même `demandeId` ;
   - `terme` doit avoir sa `cleJeton` égale à celle d'un des jetons, c'est-à-dire `verifierJeton(secret, j, terme, now)` `ok` pour au moins un `j`.
   Sinon : ligne `refus` sans envoi, avec le message « jeton OMQ invalide ou expiré pour cet article : reprends les jetons renvoyés par prendre_demande_panier ».

Le libellé n'est pas dans le jeton : `chronodrive` ne peut donc vérifier la signature d'un jeton que contre `terme`. Pour une ligne fusionnée, la règle retenue est la suivante :
- **au moins un** jeton vérifie `terme` (signature + expiration) ;
- les autres jetons ont un format et une expiration valides, et le même `demandeId`.

Leur signature n'est pas vérifiable. C'est sans conséquence : le jeton qui autorise l'ajout est celui de `terme`. Noter cette limite dans un commentaire du code.

Ajouter `jetons` à la description de l'outil : « Chaque ligne porte `jetons`, le `jeton` de chaque article OMQ qu'elle couvre (un seul en général, plusieurs pour des articles fusionnés). Sans jeton valide, la ligne est refusée sans envoi. »

- [ ] **Étape 1 : tests qui échouent** (`outils.test.ts`, client simulé existant, jetons signés avec `signerJeton` et une horloge injectée) :
  - `ajout avec jeton valide → envoyé`
  - `ajout sans secret, écriture armée → ErreurOutil, aucun appel API`
  - `jeton expiré → ligne refusée sans envoi, les autres lignes passent`
  - `jeton d'un autre terme seul → refusée`
  - `ligne fusionnée : aucun jeton ne vérifie terme → refusée`
  - `ligne fusionnée : jeton de terme valide, co-jeton expiré → refusée`
  - `ligne fusionnée : deux jetons valides de la même demande → envoyée`
  - `jetons de deux demandes différentes → refusée`
  - `lecture seule → refus lecture seule inchangé, même sans secret`
  - `lireSecretJetons : fichier l'emporte, absente → null`
- [ ] **Étape 2 : vérifier l'échec.** Commande : `cd integrations/chronodrive-mcp && npm test`. Attendu : FAIL sur les nouveaux tests.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : vérifier le succès.** Commandes : `npm test && npm run typecheck`. Attendu : tout vert.
- [ ] **Étape 5 : commit.** `feat: chronodrive refuse tout ajout sans jeton de demande OMQ valide (#330)`

---

### Tâche 6 : e2e staging

**Fichiers :**
- Modifier : `e2e/oauth.ts`. `postMcp` et `appelerOutilMcp` reçoivent un dernier paramètre optionnel `chemin = "/api/mcp"`.
- Modifier : `e2e/panier-demande.spec.ts`. Les appels `prendre_demande_panier` et `rapporter_panier` passent `"/api/mcp/executeur"`. Ajouter les tests ci-dessous.

**Interfaces :**
- Consomme : la tâche 4 (endpoint), la tâche 2 (migration appliquée sur staging) et la constante `SECRET` du spec.
- Vérification du jeton en Node dans le spec, comme la signature webhook (l.92) : recalcul local en 6 lignes avec `createHmac`, sur les contraintes globales.

- [ ] **Étape 1 : nouveaux tests.**
  - `executeur : prendre → articles du cycle de la demande, chaque jeton = HMAC recalculé avec SECRET, exp = pris_le + 30 min (#330)`
  - `executeur : cocher_article_demande sans demande prise → refus lisible OMQ05, aucune coche (#330)`
  - `executeur : demande sur le cycle suivant, cocher_article_demande → coche sur CE cycle, pas sur le courant (#330)`
  - `MCP général : prendre_demande_panier absent de tools/list (#330)`
- [ ] **Étape 2 : lancer.** Commande : `npm run test:e2e:staging -- e2e/panier-demande.spec.ts`, puis `npm run test:e2e:staging -- e2e/panier-demande.spec.ts e2e/oauth-mcp.spec.ts --retries=2`. Attendu : tout vert. Instables connus hors branche : `courses.spec.ts:155`, `:529`.
- [ ] **Étape 3 : commit.** `test: e2e des gardes du run de panier (#330)`

---

### Tâche 7 : skill 1.2.0, route Hermes et procédure NAS

**Fichiers :**
- Modifier : `integrations/chronodrive-mcp/hermes/skills/omq/panier-chronodrive/SKILL.md` (version 1.2.0)
- Modifier : `integrations/chronodrive-mcp/hermes/route-webhook.md`
- Modifier : `integrations/chronodrive-mcp/README.md`

Contenu :
- **Skill.**
  - Étape 1 : `prendre_demande_panier`. Elle renvoie la liste, et l'ancienne étape 2 (`lire_liste_courses`, contrôle « cycle changé », liste vide) disparaît : le serveur s'en charge.
  - `ajouter_au_panier` reçoit `jetons` (le `jeton` de chaque article couvert).
  - Coche via `cocher_article_demande(libelle, quantite)`, sans `ancre`.
  - Le tableau des outils et la liste des interdits reflètent les deux serveurs.
  - Sur une erreur « Aucune demande de panier prise » ou « jeton OMQ invalide », s'arrêter sans réessayer.
  - Le mode mesure ne change pas (`lire_liste_courses` du serveur général, en `cli`).
- **`route-webhook.md`.** `toolsets: ["chronodrive", "OMQ exécuteur"]`, avec une explication de l'isolement (#330).
- **README, nouvelle section « Durcissement #330 ».** Procédure en ordre strict, avec les sauvegardes `config.yaml.bak-avant-330` et `webhook_subscriptions.json.bak-avant-330` :
  1. Copier le code de `chronodrive-mcp` sur le NAS. Sauvegarde : `/opt/data/chronodrive-mcp.bak-avant-330.tgz`.
  2. Vérifier que `OMQ_WEBHOOK_SECRET` est dans `chronodrive.env`. Il est désormais **lu** par le MCP : mettre à jour la ligne du tableau des variables. La rotation est couplée.
  3. Déclarer sous `mcp_servers` le serveur `OMQ exécuteur` (url `https://<prod>/api/mcp/executeur`, OAuth comme « On Mange Quoi ? »), puis faire le login OAuth en collant l'URL de retour.
  4. `platform_toolsets` : ajouter `OMQ exécuteur` à `cli` seulement. Vérifier qu'il est absent de `telegram`, `whatsapp`, `cron`, `homeassistant` et `discord`.
  5. Route `panier-omq` : `toolsets: ["chronodrive", "OMQ exécuteur"]`.
  6. Installer la skill 1.2.0.
  7. Redémarrer la gateway, **seulement après le feu vert explicite d'Arnaud** (piège du classifieur, `chronodrive.md`).

- [ ] **Étape 1 : rédiger les trois fichiers.**
- [ ] **Étape 2 : contrôle croisé.** `grep -n "lire_liste_courses\|cocher_article(" integrations/chronodrive-mcp/hermes/skills/omq/panier-chronodrive/SKILL.md`. Attendu : aucune occurrence hors du mode mesure.
- [ ] **Étape 3 : commit.** `docs: skill panier-chronodrive 1.2.0 et procédure NAS du durcissement (#330)`

---

### Tâche 8 : specs, ADR, règles, changelog

**Fichiers :**
- Modifier : `SPECS_FONCTIONNELLES.md`.
  - RG-81 : prise sur l'endpoint exécuteur.
  - RG-82 : entrées renvoyées par `prendre`, jetons.
  - RG-83 : jetons expirant avec `en_cours`, refus serveur sans demande prise.
  - RG-85 : `cocher_article(ancre)` n'est plus l'outil de l'exécuteur, qui utilise `cocher_article_demande`.
  - Pas de nouvelle RG : RG-87 est la dernière. Si une RG s'avère nécessaire, re-vérifier le maximum avant de numéroter.
- Modifier : `ADR.md`, ADR-12. Ajouter les gardes serveur, l'endpoint séparé, les options écartées (`client_id`, plugin Hermes, `tools.exclude` global, bon global), la clé dérivée et sa rotation couplée.
- Modifier : `.claude/rules/chronodrive.md`.
  - Garde « jetons » dans `ajouter_au_panier`.
  - `OMQ_WEBHOOK_SECRET` lu par le MCP, refus par défaut.
  - `toolsets` de la route.
  - Corriger la ligne qui dit qu'une consigne de skill est le seul frein du run.
- Modifier : `.claude/rules/mcp.md`, section « Outils de panier ». Endpoint `/api/mcp/executeur`, outils retirés de l'endpoint général, ancre dérivée de la demande, fabrique `creerRouteMcp`.
- Modifier : `CHANGELOG.md`, section `[Unreleased]`, sous « Sécurité ».

- [ ] **Étape 1 : rédiger.** Format de règle : la règle, puis une ligne « pourquoi ».
- [ ] **Étape 2 : vérifications finales.** Commandes : `npm run test:run && npx tsc --noEmit && npm run lint`, puis `graphify update .`. Attendu : tout vert.
- [ ] **Étape 3 : commit.** `docs: RG-81/82/83/85, ADR-12 et règles du durcissement du run (#330)`

---

### Après le merge (manuel, avec Arnaud)

1. `migrate-prod` OK (CI), et Vercel prod READY.
2. Procédure NAS du README, section « Durcissement #330 ». La fenêtre de panne du bouton dure jusqu'à la fin de ce point.
3. **Run piégé en `cli`.** Les refus doivent être lisibles :
   - `cocher_article_demande` sans `prendre` → OMQ05 ;
   - `ajouter_au_panier` sans jeton → rejet du schéma ;
   - `ajouter_au_panier` avec un jeton altéré → ligne refusée sans envoi.
4. Un vrai « Remplir mon panier » depuis `/courses` : panier rempli, coches sur le bon cycle, compte-rendu.
5. Mesurer les 5 runs réels suivants. Au-delà d'1 échec sur 5, rouvrir le choix du modèle de la route (`cron_job` ou `profile`).
6. Mettre à jour l'issue #330, puis la clore.
