# Exécuteur Chronodrive de OMQ (#308)

Remplit le panier Chronodrive du foyer à partir de la liste de courses OMQ, **chez l'utilisateur** : un MCP stdio lancé par Hermes sur le NAS, piloté par la skill `panier-chronodrive` et réveillé par un webhook d'OMQ.

- **RG-80 / ADR-12** : OMQ ne parle jamais à Chronodrive et ne stocke aucun identifiant d'enseigne. Les identifiants Chronodrive restent sur le NAS, dans `/opt/data/chronodrive.env` (mode `600`). Ils ne vont ni dans Git, ni dans `config.yaml`, ni dans OMQ.
- **RG-82** : le MCP n'expose **aucun** outil de commande, de créneau, de paiement ni de retrait. La validation finale reste humaine, dans l'appli Chronodrive.
- **RG-83** : un ajout est confirmé par l'écart de quantité dans le panier, avant et après. L'article est coché dans OMQ juste après, ce qui évite de doubler le panier à la relance.

Protocole de l'API et mesures : `docs/etudes/chronodrive.md`. Pièges : `.claude/rules/chronodrive.md`. Spécification : RG-80→84 de `SPECS_FONCTIONNELLES.md`.

## Fichiers

| Chemin | Rôle |
|--------|------|
| `src/client.ts` | Connexion (mot de passe → PKCE → jeton, sans refresh token), clés `x-api-key` par service, rejeu unique sur 401 de jeton, caviardage des erreurs. |
| `src/catalogue.ts` | Favoris (paginés, gardés 30 min), recherche, disponibilité d'un produit. |
| `src/panier.ts` | Panier courant relu à chaque run, ajout par lot confirmé par l'écart de quantité. |
| `src/correspondances.ts` | Cache SQLite `terme → productId` (`node:sqlite`), écrit seulement après un ajout confirmé. |
| `src/outils.ts` | Les 5 outils MCP : `chercher_produits`, `ajouter_au_panier`, `lire_panier`, `correspondances_connues`, `memoriser_correspondances`. |
| `src/mcp.ts` | Point d'entrée stdio (`node src/mcp.ts`), lecture seule si `CHRONODRIVE_LECTURE_SEULE=1`. |
| `test/` | Tests `node --test`, Chronodrive simulé (`test/simulation.ts`). |
| `hermes/skills/omq/panier-chronodrive/SKILL.md` | Skill Hermes : procédure du run et du mode mesure. |
| `hermes/route-webhook.md` | Route webhook `panier-omq`, secret, Funnel. |
| `hermes/prompt-mesure.md` | Message de mesure du classement, en lecture seule. |
| `spike/` | PoC du spike #307, gardé jusqu'à la fin de #308 puis supprimé. |

## Tests en local

Node 24 ou plus. Ce dossier est hors de l'outillage de l'app : la CI ne le voit pas, et il faut le vérifier à la main.

```sh
cd integrations/chronodrive-mcp
npm install
npm test                    # node --test "test/*.test.ts"
npx tsc --noEmit -p .       # ou npm run typecheck
```

Aucun test n'appelle Chronodrive.

## Installation sur le NAS

Tout tourne dans le conteneur `hermes` : réseau host, donc IP résidentielle, en utilisateur `1000`. `/opt/data` dans le conteneur correspond à `/share/CACHEDEV1_DATA/Container/hermes/data` sur le NAS.

**Toute opération sur le NAS se fait avec Arnaud.** Commandes depuis une session `ssh nas-hermes` :

```sh
D=/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker
```

### 1. Sauvegarder

```sh
$D exec -u 1000 hermes sh -c '
  cd /opt/data
  cp -p config.yaml config.yaml.bak-avant-308-mcp
  cp -p webhook_subscriptions.json webhook_subscriptions.json.bak-avant-308
'
```

### 2. Copier le code

Copier le code sans `node_modules`, `test`, `spike` ni `mesures`. Depuis le PC, Git Bash, à la racine du dépôt :

```sh
tar -C integrations/chronodrive-mcp \
    --exclude=node_modules --exclude=test --exclude=spike --exclude=mesures \
    -cf - . \
  | ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes \
      sh -c "mkdir -p /opt/data/chronodrive-mcp && tar -C /opt/data/chronodrive-mcp -xf -"'
```

Puis, sur le NAS :

```sh
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes npm install --omit=dev
```

Le code TypeScript est exécuté tel quel par Node 26, sans build. La copie en utilisateur 1000 donne les bons propriétaires aux fichiers.

### 3. Identifiants : `chronodrive.env`

`/opt/data/chronodrive.env` (mode `600`, utilisateur 1000) est lu par le MCP lui-même : **Hermes ne le charge pas**. Format `NOM=valeur`, une variable par ligne. Les identifiants du vrai compte y sont posés **par Arnaud lui-même**.

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `CHRONODRIVE_EMAIL` | oui | Identifiant du compte Chronodrive. |
| `CHRONODRIVE_MOT_DE_PASSE` | oui | Mot de passe du compte. |
| `CHRONODRIVE_SITE_ID` | oui | Identifiant du drive (lu dans `GET v1/sites?size=500`, cf. `docs/etudes/chronodrive.md`). |
| `CHRONODRIVE_MODE` | non | `DRIVE` (défaut) ou `HOME_DELIVERY`. |
| `CHRONODRIVE_SESSION` | non | Fichier de session, par défaut `/opt/data/chronodrive-session.json` (mode `600`, réécrit à chaque connexion). |
| `OMQ_WEBHOOK_SECRET` | pour la route | Secret `whsec_<base64>` de la route webhook. Il n'est pas lu par le MCP mais rangé ici (cf. `hermes/route-webhook.md`). |

Ces variables peuvent aussi venir de l'environnement du processus, mais le fichier l'emporte.

D'autres variables ne se lisent **que** dans l'environnement du processus, donc dans l'entrée `env` de `config.yaml`, jamais dans `chronodrive.env` :

| Variable | Rôle |
|----------|------|
| `CHRONODRIVE_LECTURE_SEULE` | `'1'` : `ajouter_au_panier` est refusé sans aucun appel à Chronodrive. |
| `CHRONODRIVE_CACHE` | Base du cache, par défaut `/opt/data/chronodrive-correspondances.sqlite`. |
| `CHRONODRIVE_ENV` | Chemin du fichier d'identifiants, par défaut `/opt/data/chronodrive.env`. |

Après un changement de compte, supprimer la session et le cache. Sinon la session de l'ancien compte servirait jusqu'à expiration, et le cache garderait ses correspondances :

```sh
$D exec -u 1000 hermes rm -f /opt/data/chronodrive-session.json /opt/data/chronodrive-correspondances.sqlite
```

### 4. Déclarer le MCP dans `config.yaml`

Dans `/opt/data/config.yaml`, sous `mcp_servers`, remplacer l'entrée `chronodrive-spike` par :

```yaml
  chronodrive:
    command: node
    args:
      - /opt/data/chronodrive-mcp/src/mcp.ts
    env:
      CHRONODRIVE_LECTURE_SEULE: '1'
    enabled: true
```

- Garder `'1'` pendant le déploiement à blanc et la mesure. Passer à `'0'` seulement pour le premier run réel, avec Arnaud.
- Les outils apparaissent dans Hermes sous `mcp__chronodrive__<outil>`. Les outils OMQ apparaissent sous `mcp__On_Mange_Quoi____<outil>`.
- Vérifier aussi que `platforms.webhook.extra.host` vaut `127.0.0.1`. Sinon le webhook est exposé au réseau local.

### 5. Redémarrer la gateway

Un changement de `mcp_servers` exige un redémarrage. La gateway porte aussi Telegram, WhatsApp, Home Assistant et le cron : **prévenir Arnaud et attendre son feu vert**. Puis :

```sh
$D exec hermes s6-svc -t /run/service/gateway-default
```

Préférer cette commande à `docker restart hermes`, qui relance tout le conteneur. Après le redémarrage :

- vérifier que Hermes liste les outils `chronodrive` ;
- vérifier que Telegram répond ;
- vérifier que WhatsApp est reconnecté.

La gateway redémarre de toute façon chaque jour vers 04 h 16.

Contrôle de fumée, en lecture seule, depuis Hermes :

- `chercher_produits` sur `["lait demi-écrémé", "œufs"]` ;
- `lire_panier` ;
- `ajouter_au_panier` doit être refusé (« lecture seule »).

### 6. Installer la skill

```sh
tar -C integrations/chronodrive-mcp/hermes/skills -cf - omq \
  | ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes \
      sh -c "mkdir -p /opt/data/skills && tar -C /opt/data/skills -xf -"'
```

Chemin final : `/opt/data/skills/omq/panier-chronodrive/SKILL.md`. La skill se lance aussi à la main par `/panier-chronodrive` (mode mesure : `hermes/prompt-mesure.md`).

### 7. Route webhook et Funnel

Suivre `hermes/route-webhook.md` :

- secret `whsec_<base64>` ;
- `hermes webhook subscribe panier-omq …`, sans redémarrage ;
- Funnel sur le port **10000**, chemin `/webhooks/panier-omq`.

## Enregistrer l'exécuteur dans OMQ

L'exécuteur se déclare par la fonction SQL `enregistrer_executeur_panier(foyer, url, secret)`, via l'API de management de Supabase, jamais depuis le client. Elle range le secret dans Vault. **En prod (`gabyhlcwahzquolwxmgd`), seulement sur l'accord explicite d'Arnaud.**

Le secret vient d'une variable d'environnement et n'est jamais tapé en clair dans une commande, à cause de l'historique du shell. Depuis le PC, Git Bash, à la racine du dépôt (`SUPABASE_ACCESS_TOKEN` posé) :

```sh
read -rs OMQ_WEBHOOK_SECRET        # coller le secret whsec_… (rien ne s'affiche)
node scripts/query-supabase.mjs gabyhlcwahzquolwxmgd \
  "select enregistrer_executeur_panier('<foyer_id>', 'https://<nas>.<tailnet>.ts.net:10000/webhooks/panier-omq', '$OMQ_WEBHOOK_SECRET')"
unset OMQ_WEBHOOK_SECRET
```

Variante sans copier-coller : le secret est lu sur le NAS et passe directement dans la variable, sans s'afficher.

```sh
OMQ_WEBHOOK_SECRET=$(ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -u 1000 hermes sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env')
```

Notes :

- `<foyer_id>` est le `foyer_id` du profil d'Arnaud (table `profiles`). Le lire en SQL : `select foyer_id from profiles p join auth.users u on u.id = p.user_id where u.email = '<e-mail d''Arnaud>'`.
- L'URL porte le port du Funnel (`10000`).
- Le secret transite dans le corps de la requête HTTPS vers l'API de management.
- Rotation : ré-enregistrer avec le nouveau secret. Le secret Vault existant est mis à jour.

## Désinstaller le spike

Seulement après la validation du run réel (Task 8 de #308).

1. L'entrée `chronodrive-spike` de `config.yaml` a déjà été remplacée à l'étape 4. Vérifier qu'elle n'y figure plus.
2. Garder une archive, puis supprimer le dossier. Il contient aussi des instantanés de panier, `panier-*.json` :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data
     tar czf chronodrive-spike.bak-308.tgz chronodrive-spike
     rm -rf chronodrive-spike
   '
   ```

3. Dans le dépôt, supprimer `integrations/chronodrive-mcp/spike/` et mettre à jour `.claude/rules/chronodrive.md`.

La session `/opt/data/chronodrive-session.json` est partagée avec le nouveau MCP : la garder.

## Dépannage

Les messages d'erreur remontent au LLM puis sur Telegram. Ils sont caviardés : jamais de mot de passe, de jeton ni de cookie. Le journal du MCP part sur la sortie d'erreur, dans les logs de la gateway (`/opt/data/logs/gateways/default`).

| Symptôme | Cause et remède |
|----------|-----------------|
| `config : variable CHRONODRIVE_… absente` | Variable manquante dans `chronodrive.env`, ou fichier illisible pour l'utilisateur 1000 (`chown 1000`, `chmod 600`). |
| `HTTP 401 … API Key is not valid` | **Erreur de clé de service**, pas de jeton : aucune reconnexion n'est tentée. Les clés `x-api-key` sont lues sur l'accueil de chronodrive.com à la connexion, puis gardées dans `chronodrive-session.json` jusqu'à l'expiration du jeton (2 h). Si Chronodrive a changé ses clés, supprimer ce fichier pour forcer une relecture. Une erreur qui persiste ensuite veut dire que Chronodrive a changé ses services ou leurs routes : comparer avec le « Protocole relevé » de `docs/etudes/chronodrive.md`. |
| `HTTP 401` sans « API Key » | **Jeton refusé.** Le client a déjà refait une connexion complète et rejoué l'appel une fois. Un second 401 veut dire identifiants refusés ou compte bloqué. Vérifier le compte dans l'appli, puis supprimer `chronodrive-session.json`. |
| `login : réponse sans tkn (captcha ou 2FA ?)` | Chronodrive demande un captcha ou une double authentification. Se connecter une fois dans un navigateur depuis le même réseau, puis réessayer. |
| `[cf-ray …, cf-mitigated …]` dans l'erreur | Blocage Cloudflare. Vérifier que le conteneur sort bien par l'IP résidentielle (réseau host). |
| `avertissement` : cache des correspondances indisponible | Non bloquant : le run continue sans cache. Cause habituelle : `database is locked`, quand deux processus écrivent plus de 5 s (deux MCP lancés, ou le spike encore actif), ou fichier SQLite non inscriptible par l'utilisateur 1000. |
| `lecture seule (CHRONODRIVE_LECTURE_SEULE=1)` | Mode voulu pour la mesure et le déploiement à blanc. Pour un run réel : `'0'` dans `config.yaml`, puis redémarrage avec Arnaud. Le run rapporte un échec « Exécuteur en lecture seule ». |
| Webhook en 401 côté Hermes | Secret différent entre la route et OMQ, ou secret sans préfixe `whsec_`. Ré-enregistrer l'exécuteur avec le secret exact de la route. |
| Demande « exécuteur injoignable » sur `/courses` | Funnel coupé (`tailscale funnel status`), gateway arrêtée, ou route absente. |
| Aucun message Telegram | Normal si le run a trouvé `demande: null` : il répond `[SILENT]`. Sinon, vérifier `--deliver telegram` sur la route. |
