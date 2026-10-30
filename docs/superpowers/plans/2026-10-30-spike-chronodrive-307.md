# Spike panier Chronodrive depuis le NAS (#307) — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** rendre un **go / no-go** documenté sur le remplissage d'un panier Chronodrive par Hermes depuis le NAS, mesuré contre les critères fixés dans #307, avant tout code côté OMQ.

**Architecture :** un PoC jetable en Node (`integrations/chronodrive-mcp/spike/`) tourne **dans le conteneur `hermes` du NAS** (réseau host, donc IP résidentielle). Il contient un client HTTP de l'API front privée, une CLI de sonde et un MCP stdio minimal branché sur Hermes. Hermes lit la vraie liste via le MCP OMQ déjà branché (`dodojo`) et fait le mapping avec sa cascade LLM. Le déclenchement push passe par la plateforme webhook de Hermes, exposée par Tailscale Funnel sur un seul chemin.

**Tech Stack :** Node 26 (conteneur `hermes`, `fetch` et `crypto` natifs), `@modelcontextprotocol/sdk` + `zod` (SDK officiel MCP, seule dépendance), Hermes Agent v0.21.5 (MCP stdio, `hermes webhook`), conteneur `tailscale` (Funnel).

**Spec :** issue #307 (section « Critères go / no-go »), `docs/etudes/chronodrive.md`, ADR-12, RG-80→84 (`SPECS_FONCTIONNELLES.md`). Cadrage arbitré en grilling le 2026-10-29 : on ne rouvre pas le design.

## Global Constraints

- **Ordre d'échec rapide.** Tasks 2 et 3 sont bloquantes : un échec saute directement à la Task 7 avec un **no-go**.
- **Aucun code tiers exécuté** : les dépôts listés dans l'étude se lisent comme documentation (`WebFetch`), jamais clonés ni lancés. Le SDK MCP officiel n'est pas concerné.
- **Identifiants Chronodrive** : uniquement dans `/opt/data/chronodrive.env` sur le NAS (`CHRONODRIVE_EMAIL`, `CHRONODRIVE_MOT_DE_PASSE`, `CHRONODRIVE_SITE_ID`), saisis par Arnaud. Jamais dans Git, jamais affichés dans un log ni une sortie de commande, jamais dans `config.yaml`. Le refresh token se range dans `/opt/data/chronodrive-session.json` (mode `600`).
- **Aucun outil ni appel de commande, créneau ou paiement** (RG-82). Le PoC ne connaît que favoris, recherche, lecture du panier, ajout et retrait d'un article.
- **Le panier d'Arnaud est réel.** Avant tout ajout, relever son contenu ; le spike ne retire que ce qu'il a lui-même ajouté. Le run complet (Task 6) remplit le panier pour de vrai : il demande le feu vert d'Arnaud au moment de le lancer.
- **Le spike ne touche pas à OMQ en écriture** : pas de `cocher_article`, pas de migration, pas de route. La liste se lit par `lire_liste_courses` (non cochés par défaut).
- **Modifier Hermes = sauvegarder d'abord** : `cp config.yaml config.yaml.bak-avant-spike-307` avant toute édition, et redémarrage de la gateway annoncé à Arnaud (elle porte aussi Telegram et WhatsApp).
- Accès NAS : `ssh nas-hermes`, puis `D=/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker` et `$D exec -u 1000 hermes …`. `/opt/data` du conteneur = `/share/CACHEDEV1_DATA/Container/hermes/data` sur le NAS.
- Pas de TDD ici : code jetable, la preuve est l'appel réel. Chaque task se vérifie par une commande et une sortie attendue.
- Français partout (identifiants, messages, doc). Commits `chore:` pour le PoC, `docs:` pour les résultats.

## Review Focus

1. **Session expirée en cours de run** : le jeton d'accès expire, le client doit rafraîchir une fois puis réessayer, sinon s'arrêter avec un message clair. Pinné en Task 2 (étape « refresh »).
2. **Article OMQ avec quantité en unité libre** (« 2 gousses », « 1 pincée », sans quantité) : le mapping ne doit pas inventer une quantité en confiance haute. Pinné par la consigne du prompt et compté en Task 5.
3. **Produit trouvé mais hors stock** sur le drive : jamais classé « confiance haute ». Pinné par le champ `disponible` renvoyé en Task 4 et la consigne en Task 5.
4. **Relance après un run partiel** : `POST …/items` incrémente, donc une relance doublerait le panier (RG-83). Mesuré en Task 3 (deux ajouts du même produit → quantité 2), pour confirmer le besoin de la coche à l'ajout.
5. **Webhook forgé ou chemin voisin** : une requête mal signée ne déclenche rien, et aucun autre chemin du NAS ne répond via Funnel. Pinné en Task 6.

---

### Task 1 : Relever le protocole exact de l'API

**Files :**
- Modify : `docs/etudes/chronodrive.md` (section « Résultats du spike », sous-section « Protocole relevé »)

**Interfaces :**
- Produces : les valeurs que Tasks 2-4 codent en dur : URL de la page d'accueil qui porte la config Nuxt et clé de chaque `x-api-key` par microservice ; pour `connect.chronodrive.com`, `client_id`, `redirect_uri`, `scope` (avec `offline_access`), forme exacte du corps de `/identity/v1/password/login`, de `/oauth/authorize` et de `/oauth/token` (grant `authorization_code` et `refresh_token`) ; corps et réponse de `POST v1/carts/{id}/items` ; champs utiles d'un produit (id, libellé, marque, contenance, prix, disponibilité).

- [ ] **Step 1 :** lire via `WebFetch` les fichiers client/auth des dépôts `y-vex/chronodrive-mcp`, `arvernesmotion/Chronodrivemcp` et `ncleton/chronodrive-mcp`. Croiser les sources ; noter chaque divergence et la date du commit.
- [ ] **Step 2 :** écrire la sous-section « Protocole relevé » : un tableau endpoint → méthode → en-têtes → corps → champs lus. Les clés publiques ne s'écrivent pas en dur dans la doc : on note où les lire.
- [ ] **Step 3 :** commit.

```bash
git add docs/etudes/chronodrive.md
git commit -m "docs: protocole relevé de l'API Chronodrive (#307)"
```

### Task 2 : Login depuis le NAS (bloquant n° 1)

**Files :**
- Create : `integrations/chronodrive-mcp/spike/README.md` (PoC jetable, remplacé par #308 ; comment le lancer sur le NAS)
- Create : `integrations/chronodrive-mcp/spike/package.json` (`"type": "module"`, `"private": true`, dépendances `@modelcontextprotocol/sdk`, `zod`)
- Create : `integrations/chronodrive-mcp/spike/client.mjs`
- Create : `integrations/chronodrive-mcp/spike/sonde.mjs`
- Modify : `.gitignore` (ajouter `integrations/**/node_modules`)

**Interfaces :**
- Produces (dans `client.mjs`) :
  - `chargerEnv(chemin = "/opt/data/chronodrive.env"): void` (`process.loadEnvFile`)
  - `ouvrirSession(): Promise<Session>` : relit `/opt/data/chronodrive-session.json` si le refresh token est valide, sinon login complet (password → PKCE → token) ; réécrit le fichier en mode `600`.
  - `appeler(session: Session, methode: string, chemin: string, corps?: object): Promise<any>` : pose `Authorization`, `x-api-key` du microservice, `x-chronodrive-site-id`, `x-chronodrive-site-mode: DRIVE`, `x-device-type: WEB` ; sur 401, rafraîchit **une** fois puis réessaie ; sinon lève `ErreurChronodrive { statut, etape, message }` (corps tronqué à 300 caractères, jamais d'en-tête d'autorisation).
  - `type Session = { jetonAcces: string, jetonRafraichissement: string, expireA: number }`
- Produces (dans `sonde.mjs`) : CLI `node sonde.mjs <commande> [args]`, sortie JSON sur stdout. Commandes de cette task : `login`, `refresh`.

- [ ] **Step 1 :** demander à Arnaud de créer `/opt/data/chronodrive.env` sur le NAS (3 variables, `chmod 600`). Vérifier sans lire les valeurs :

Run : `$D exec -u 1000 hermes sh -c 'stat -c %a /opt/data/chronodrive.env; grep -c "^CHRONODRIVE_" /opt/data/chronodrive.env'`
Expected : `600` puis `3`

- [ ] **Step 2 :** écrire `client.mjs` et `sonde.mjs` (`login`, `refresh`), puis copier le dossier sur le NAS (`scp -r` vers `/share/CACHEDEV1_DATA/Container/hermes/data/chronodrive-spike/`, puis `chown -R 1000`) et lancer `npm install --omit=dev` dans le conteneur.
- [ ] **Step 3 :** lancer le login.

Run : `$D exec -u 1000 -w /opt/data/chronodrive-spike hermes node sonde.mjs login`
Expected : `{"ok":true,"expireDans":<secondes>,"offlineAccess":true}`. Toute page HTML Cloudflare, `403`, captcha ou demande de code 2FA → noter la réponse exacte (statut, en-têtes `cf-*`, 300 premiers caractères), **no-go**, aller en Task 7.

- [ ] **Step 4 :** forcer le refresh (`node sonde.mjs refresh`, qui ignore `expireA`).
Expected : `{"ok":true,"rafraichi":true}` sans nouvelle saisie.
- [ ] **Step 5 :** commit.

```bash
git add .gitignore integrations/chronodrive-mcp/spike
git commit -m "chore: spike Chronodrive, client et login depuis le NAS (#307)"
```

### Task 3 : Panier visible dans l'appli mobile (bloquant n° 2)

**Files :**
- Modify : `integrations/chronodrive-mcp/spike/client.mjs`, `integrations/chronodrive-mcp/spike/sonde.mjs`

**Interfaces :**
- Consumes : `ouvrirSession`, `appeler` (Task 2).
- Produces (dans `client.mjs`) :
  - `lirePanier(session): Promise<{ id: string, articles: { productId: string, libelle: string, quantite: number }[] }>`
  - `ajouterAuPanier(session, productId: string, quantite: number): Promise<void>` (corps `{"content":[{productId, quantity, clientOrigin}],"optimizedMode":true}`, `clientOrigin` relevé en Task 1)
  - `retirerDuPanier(session, productId: string): Promise<void>`
- Produces (sonde) : commandes `panier`, `ajouter <productId> <quantite>`, `retirer <productId>`.

- [ ] **Step 1 :** relever le panier avant tout ajout : `node sonde.mjs panier > /opt/data/chronodrive-spike/panier-avant.json`. Garder ce fichier comme référence de retour à l'état initial.
- [ ] **Step 2 :** Arnaud donne l'id d'un produit bon marché absent du panier (ou on le prend dans `panier-avant.json`, sinon dans la recherche de Task 4). Lancer `node sonde.mjs ajouter <id> 1` deux fois, puis `node sonde.mjs panier`.
Expected : le produit apparaît avec `quantite: 2` (incrément confirmé, Review Focus 4).
- [ ] **Step 3 :** Arnaud ouvre l'appli mobile Chronodrive, sur le même drive.
Expected : le produit est là, quantité 2. Absent, ou présent seulement sur le web → **no-go**, aller en Task 7.
- [ ] **Step 4 :** `node sonde.mjs retirer <id>`, puis `node sonde.mjs panier`. Expected : panier identique à `panier-avant.json`.
- [ ] **Step 5 :** commit (`chore: spike Chronodrive, lecture et écriture du panier (#307)`).

### Task 4 : Favoris, recherche et MCP stdio du spike

**Files :**
- Modify : `integrations/chronodrive-mcp/spike/client.mjs`, `integrations/chronodrive-mcp/spike/sonde.mjs`
- Create : `integrations/chronodrive-mcp/spike/mcp.mjs`

**Interfaces :**
- Consumes : Tasks 2-3.
- Produces (dans `client.mjs`) :
  - `type Produit = { id: string, libelle: string, marque: string | null, contenance: string | null, prix: number, prixAuKg: number | null, disponible: boolean, bio: boolean }`
  - `listerFavoris(session): Promise<Produit[]>` (toutes les pages)
  - `rechercherProduits(session, terme: string, taille = 20): Promise<Produit[]>`
- Produces (dans `mcp.mjs`) : serveur MCP stdio `chronodrive-spike` avec exactement 5 outils : `lister_favoris()`, `rechercher_produits({ terme })`, `voir_panier()`, `ajouter_au_panier({ productId, quantite })`, `retirer_du_panier({ productId })`. Avec `CHRONODRIVE_LECTURE_SEULE=1`, les deux derniers renvoient `isError` « lecture seule » sans appeler l'API. `mcp.mjs` appelle `chargerEnv()` lui-même : aucun secret dans `config.yaml`.

- [ ] **Step 1 :** coder `listerFavoris`, `rechercherProduits`, les commandes de sonde `favoris` et `recherche <terme>`, puis lancer `node sonde.mjs favoris | head -c 600` et `node sonde.mjs recherche "lait demi-écrémé"`.
Expected : favoris non vides (de l'ordre de 200) ; recherche avec au moins un `Produit` complet, `disponible` renseigné.
- [ ] **Step 2 :** coder `mcp.mjs`. Sauvegarder `config.yaml`, puis ajouter sous `mcp_servers` :

```yaml
  chronodrive-spike:
    command: node
    args: [/opt/data/chronodrive-spike/mcp.mjs]
    env:
      CHRONODRIVE_LECTURE_SEULE: '1'
    enabled: true
```

- [ ] **Step 3 :** prévenir Arnaud, redémarrer la gateway Hermes, puis lister les outils vus par Hermes (`hermes mcp list` ou équivalent de la v0.21.5).
Expected : les 5 outils de `chronodrive-spike` ; un appel `ajouter_au_panier` renvoie l'erreur « lecture seule ».
- [ ] **Step 4 :** commit (`chore: spike Chronodrive, favoris, recherche et MCP stdio (#307)`).

### Task 5 : Qualité du mapping (seuil)

**Files :**
- Create : `integrations/chronodrive-mcp/spike/prompt-mapping.md` (prompt du run, base du skill Hermes de #308)
- Create : `integrations/chronodrive-mcp/spike/mesures/mapping-2026-10-30.md` (tableau annoté, sans prix ni données de compte autres que les libellés produits)

**Interfaces :**
- Consumes : outils MCP `dodojo.lire_liste_courses` et `chronodrive-spike.*` (Task 4).
- Produces : pour chaque article, une ligne `article OMQ | quantité OMQ | produit choisi | quantité | source (favori/recherche) | confiance (haute/à choisir/introuvable) | verdict d'Arnaud (juste/faux)`.

- [ ] **Step 1 :** écrire `prompt-mapping.md`. Règles à y fixer, tirées de RG-82 :
  - lire la liste par `lire_liste_courses` (non cochés, articles manuels compris) ; **ne jamais appeler** `cocher_article` ni un autre outil d'écriture OMQ ;
  - favoris d'abord (`lister_favoris` une seule fois), puis `rechercher_produits` ;
  - **haute** seulement si : un seul produit correspond sans ambiguïté sur la nature, `disponible: true`, et la quantité se déduit de la quantité OMQ et de la contenance ; sinon **à choisir** (avec au plus 3 candidats) ; aucun résultat → **introuvable** ;
  - quantité OMQ absente ou en unité libre (gousse, pincée, botte…) → au plus 1 unité, et jamais en haute si la contenance ne permet pas de conclure ;
  - sortie : le tableau ci-dessus, sans la colonne verdict.
- [ ] **Step 2 :** vérifier qu'Arnaud a une liste réelle d'au moins 20 articles non cochés dans OMQ (`lire_liste_courses` via Hermes). Moins de 20 → compléter avec des articles manuels réalistes, ajoutés par Arnaud dans l'appli.
- [ ] **Step 3 :** lancer le run en lecture seule dans une session Hermes avec `prompt-mapping.md`, chronométré (heure de début et de fin).
- [ ] **Step 4 :** Arnaud annote chaque ligne juste/faux. Calculer : % haute, % à choisir, % introuvable, nombre de « haute » fausses.
Expected (go) : haute ≥ 60 % et 0 haute fausse. 40-60 % → go sous réserve. < 40 % ou une haute fausse → ajuster le prompt **une seule fois**, relancer, retenir le 2ᵉ résultat (noter les deux).
- [ ] **Step 5 :** commit (`chore: spike Chronodrive, prompt et mesure du mapping (#307)`).

### Task 6 : Déclenchement push et run complet chronométré

**Files :**
- Create : `integrations/chronodrive-mcp/spike/envoyer-webhook.mjs` (envoie un POST signé HMAC à une URL, corps `{"evenement":"demande_panier"}` sans donnée métier)

**Interfaces :**
- Consumes : prompt de Task 5, MCP de Task 4.
- Produces : URL Funnel `https://<nom>.<tailnet>.ts.net/webhooks/panier-omq`, format de signature attendu par Hermes, durée d'un run complet.

- [ ] **Step 1 :** lire dans `/opt/hermes` (code de la plateforme webhook) le port d'écoute, le nom de l'en-tête de signature et l'algorithme. `envoyer-webhook.mjs <url> <secret>` signe selon ce format.
- [ ] **Step 2 :** sauvegarder `config.yaml`, activer `platforms.webhook.enabled: true`, redémarrer la gateway (Arnaud prévenu), puis :

Run : `hermes webhook subscribe panier-omq --description "Spike #307" --prompt "<contenu de prompt-mapping.md>" --deliver telegram`
Expected : route créée, secret affiché une fois (le garder dans `/opt/data/chronodrive.env` sous `OMQ_WEBHOOK_SECRET`, jamais dans Git).

- [ ] **Step 3 :** exposer **un seul chemin** depuis le conteneur `tailscale` : `tailscale funnel --bg --set-path /webhooks/panier-omq http://127.0.0.1:<port>/webhooks/panier-omq`. Vérifier depuis le PC :
  - `node envoyer-webhook.mjs <url> <secret>` → `2xx`, un run Hermes démarre, compte-rendu sur Telegram ;
  - même POST avec un mauvais secret → refus, aucun run ;
  - `curl -s -o /dev/null -w "%{http_code}" https://<nom>.<tailnet>.ts.net/` → `404` (rien d'autre n'est exposé).
  Échec du Funnel ou de la route → noter la cause, tester le repli cron (`wakeAgent: false` + script de pré-vérification sans token), pas de no-go.
- [ ] **Step 4 : run complet, sur feu vert d'Arnaud.** Relever le panier (`panier-avant-run.json`), passer `CHRONODRIVE_LECTURE_SEULE` à `'0'`, redémarrer la gateway, déclencher par webhook. Chronométrer du POST au compte-rendu Telegram.
Expected : articles « haute » ajoutés au panier, visibles dans l'appli ; durée notée. Ensuite Arnaud garde ou vide ce panier (c'est le sien).
- [ ] **Step 5 :** remise au propre : `CHRONODRIVE_LECTURE_SEULE` repasse à `'1'`, `tailscale funnel --set-path /webhooks/panier-omq off`, `hermes webhook rm panier-omq`. Le MCP `chronodrive-spike` reste branché en lecture seule (utile à #308) ; le noter dans le README.
- [ ] **Step 6 :** commit (`chore: spike Chronodrive, webhook signé et run complet (#307)`).

### Task 7 : Go / no-go et répercussions

**Files :**
- Modify : `docs/etudes/chronodrive.md` (« Résultats du spike » : verdict par critère, mesures, durée, cause en cas de no-go)
- Modify : `ADR.md` (ADR-12 : statut **accepté** ou **rejeté**, ajustements)
- Modify : `SPECS_FONCTIONNELLES.md` (RG-83 : délai d'expiration fixé, « provisoire » retiré ; RG-80→84 ajustés si le spike le demande)
- Create (si un piège est apparu) : `.claude/rules/chronodrive.md` avec `paths: ["integrations/chronodrive-mcp/**"]`, et sa ligne dans le tableau de `CLAUDE.md`
- Modify : `CHANGELOG.md` (`[Unreleased]` : une ligne « Étude : spike panier Chronodrive, verdict … »)

- [ ] **Step 1 :** remplir « Résultats du spike » critère par critère (1 à 5 de #307), avec les chiffres de Tasks 2-6. Durée d'un run : sous 15 min, RG-83 garde 15 min ; au-delà, arrondir au quart d'heure supérieur.
- [ ] **Step 2 :** répercuter dans ADR-12 et RG-80→84. No-go : ADR-12 passe **rejeté** avec la cause, US-53 et RG-80→84 marquées « abandonnées (no-go #307) », #308 à fermer après accord d'Arnaud.
- [ ] **Step 3 :** `npm run lint` (le dossier `integrations/` ne doit pas casser la CI) puis `graphify update .`.
Expected : lint sans erreur.
- [ ] **Step 4 :** commit (`docs: résultats du spike Chronodrive, verdict go/no-go (#307)`), push, PR vers `main` (pas d'e2e staging : aucun changement d'UI, de synchro ni de persistance). Cocher les cases de #307 et y coller le verdict.
- [ ] **Step 5 :** merge seulement sur CI verte et accord d'Arnaud.
