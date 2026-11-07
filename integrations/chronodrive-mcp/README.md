# Exécuteur Chronodrive de OMQ (#308)

Remplit le panier Chronodrive du foyer à partir de la liste de courses OMQ, **chez l'utilisateur** : un MCP stdio lancé par Hermes sur le NAS, piloté par la skill `panier-chronodrive` et réveillé par un webhook d'OMQ.

- **RG-80 / ADR-12** : OMQ ne parle jamais à Chronodrive et ne stocke aucun identifiant d'enseigne. Les identifiants Chronodrive restent sur le NAS, dans `/opt/data/chronodrive.env` (mode `600`). Ils ne vont ni dans Git, ni dans `config.yaml`, ni dans OMQ.
- **RG-82** : le MCP n'expose **aucun** outil de commande, de créneau, de paiement ni de retrait. La validation finale reste humaine, dans l'appli Chronodrive.
- **RG-83** : un ajout est confirmé par l'écart de quantité dans le panier, avant et après. L'article est coché dans OMQ juste après, ce qui évite de doubler le panier à la relance.

Protocole de l'API et mesures : `docs/etudes/chronodrive.md`. Pièges : `.claude/rules/chronodrive.md`. Spécification : RG-80→84 de `SPECS_FONCTIONNELLES.md`.

## Fichiers

| Chemin | Rôle |
|--------|------|
| `src/client.ts` | Connexion (mot de passe → PKCE → jeton, sans refresh token), clés `x-api-key` par service, rejeu unique sur 401, délai de 20 s par requête, caviardage des erreurs. Config et session relues quand leur fichier change. |
| `src/catalogue.ts` | Favoris (paginés, gardés 30 min), recherche, disponibilité d'un produit. |
| `src/panier.ts` | Panier courant relu à chaque run, ajout par lot (90 s au plus) confirmé par l'écart de quantité. |
| `src/correspondances.ts` | Cache SQLite `terme → productId` (`node:sqlite`), écrit seulement après un ajout confirmé. |
| `src/jetons.ts` | Vérification des jetons HMAC des articles d’une demande OMQ (#330) : format `<demande_id>.<exp>.<mac>`, expiration à `pris_le + 30 min`, clé de libellé `cleJeton` (jumelle de `lib/jeton-panier.ts` côté OMQ, mêmes vecteurs de test). |
| `src/outils.ts` | Les 5 outils MCP : `chercher_produits`, `ajouter_au_panier`, `lire_panier`, `correspondances_connues`, `memoriser_correspondances`. `ajouter_au_panier` exige pour chaque ligne `jetons` (le `jeton` de chaque article OMQ couvert, renvoyé par `prendre_demande_panier`) et refuse sans envoi une ligne dont aucun jeton ne vérifie `terme`, ou tout ajout si `OMQ_WEBHOOK_SECRET` manque (#330). Il n'accepte aussi, pour chaque ligne, qu'un produit proposé par `chercher_produits` pour le terme de cette ligne (`terme`, ou `terme_recherche` pour une reformulation cherchée dans un appel postérieur à celui de l'article) depuis moins de 30 min. Avec `quantite_omq` (quantité OMQ de l'article), la quantité est plafonnée au besoin calculé, jamais augmentée (`quantiteAjustee`). `chercher_produits` lit le panier courant une fois par appel et marque chaque produit renvoyé de `dansPanier` (indisponibles compris) : la skill reconnaît ainsi un article déjà au panier, quel que soit le produit qu'elle choisirait. |
| `src/quantites.ts` | Lecture de la quantité OMQ et de la contenance (masse, volume, nombre) et plafond `min(demande, besoin)`. |
| `src/mcp.ts` | Point d'entrée stdio (`node src/mcp.ts`), en lecture seule sauf si `CHRONODRIVE_LECTURE_SEULE` vaut `'0'`. |
| `src/vider-panier.ts` | Script manuel qui vide le panier courant (jamais depuis un run Hermes : le run webhook ne voit aucun outil de retrait, RG-82 ; Claude Code ne le lance que sur ordre explicite d'Arnaud) ; `--simulation` pour voir sans rien retirer. |
| `src/bilan-vidage.ts` | Texte du bilan d'un vidage (`formaterBilan`), partagé par le script et l'outil `vider_panier` ; module sans effet de bord. |
| `src/admin.ts`, `src/mcp-admin.ts` | Serveur MCP séparé `chronodrive-admin` (`node src/mcp-admin.ts`), un seul outil `vider_panier`, en deux temps (aperçu puis confirmation), pour Telegram seulement (RG-82). |
| `test/` | Tests `node --test`, Chronodrive simulé (`test/simulation.ts`). |
| `hermes/skills/omq/panier-chronodrive/SKILL.md` | Skill Hermes (version 1.3.0) : procédure du run (serveurs `OMQ exécuteur` et `chronodrive`) et du mode mesure (serveur général). |
| `hermes/route-webhook.md` | Route webhook `panier-omq`, secret, Funnel. |
| `hermes/prompt-mesure.md` | Message de mesure du classement, en lecture seule. |
| `outils/envoyer-webhook.mjs` | Signe et envoie un webhook de test comme OMQ (Standard Webhooks), pour la route de contrôle. |
| `hermes/skills/omq/preparer-cycle/SKILL.md` | Skill Hermes « préparer mon cycle » : tendances confirmées, ajustements, deux validations, panier et partage WhatsApp sur ordre (RG-85, RG-86). |
| `outils/duree-machine.ts` | Mesure la durée machine d’un run de préparation de cycle, en lecture seule de `state.db` (RG-86). |
| `mesures/cycle-gabarit.md` | Gabarit du fichier d’un run réel de préparation de cycle. |

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

Copier le code sans `node_modules`, `test` ni `mesures`. Depuis le PC, Git Bash, à la racine du dépôt :

```sh
tar -C integrations/chronodrive-mcp \
    --exclude=node_modules --exclude=test --exclude=mesures \
    -cf - . \
  | ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes \
      sh -c "mkdir -p /opt/data/chronodrive-mcp && tar -C /opt/data/chronodrive-mcp -xf -"'
```

Puis, sur le NAS :

```sh
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes npm ci --omit=dev
```

`npm ci` installe exactement les versions de `package-lock.json`. Le code TypeScript est exécuté tel quel par Node 26, sans build. La copie en utilisateur 1000 donne les bons propriétaires aux fichiers.

**Après une mise à jour du code, redémarrer la gateway** (étape 6, avec Arnaud) : le MCP est un processus qui vit aussi longtemps qu'elle. En revanche, un changement de `chronodrive.env` ou du fichier de session est pris en compte au prochain appel d'outil, sans redémarrage.

### 3. Identifiants : `chronodrive.env`

`/opt/data/chronodrive.env` (mode `600`, utilisateur 1000) est lu par le MCP lui-même : **Hermes ne le charge pas**. Format `NOM=valeur`, une variable par ligne. Les identifiants du vrai compte y sont posés **par Arnaud lui-même**.

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `CHRONODRIVE_EMAIL` | oui | Identifiant du compte Chronodrive. |
| `CHRONODRIVE_MOT_DE_PASSE` | oui | Mot de passe du compte. |
| `CHRONODRIVE_SITE_ID` | oui | Identifiant du drive (lu dans `GET v1/sites?size=500`, cf. `docs/etudes/chronodrive.md`). |
| `CHRONODRIVE_MODE` | non | `DRIVE` (défaut) ou `HOME_DELIVERY`. |
| `CHRONODRIVE_SESSION` | non | Fichier de session, par défaut `/opt/data/chronodrive-session.json` (mode `600`, réécrit à chaque connexion). Il est lié à l'e-mail et au drive : une session d'un autre compte est ignorée. |
| `OMQ_WEBHOOK_SECRET` | oui pour tout ajout (#330) | Secret partagé à l'identique avec OMQ : il signe le webhook de la route et les jetons des articles de la demande. Un secret brut convient. Depuis #330, le MCP `chronodrive` le **lit** (le fichier l'emporte sur l'environnement, relu à chaque appel d'outil) pour vérifier les jetons : absent alors que `CHRONODRIVE_LECTURE_SEULE` vaut `'0'`, tout ajout est refusé. **Rotation couplée** : OMQ (ré-enregistrer l'exécuteur), route Hermes et `chronodrive.env` changent ensemble (cf. `hermes/route-webhook.md`). |

Ces variables peuvent aussi venir de l'environnement du processus, mais le fichier l'emporte. Le fichier est relu dès qu'il change (sa date de modification est vérifiée à chaque appel d'outil).

D'autres variables ne se lisent **que** dans l'environnement du processus, donc dans l'entrée `env` de `config.yaml`, jamais dans `chronodrive.env` :

| Variable | Rôle |
|----------|------|
| `CHRONODRIVE_LECTURE_SEULE` | **Lecture seule par défaut** : `ajouter_au_panier` est refusé sans aucun appel à Chronodrive, sauf si la variable vaut exactement `'0'`. Absente, vide ou `'1'` : lecture seule. |
| `CHRONODRIVE_CACHE` | Base du cache, par défaut `/opt/data/chronodrive-correspondances.sqlite`. |
| `CHRONODRIVE_ENV` | Chemin du fichier d'identifiants, par défaut `/opt/data/chronodrive.env`. |

Après un changement de compte ou de drive, la session de l'ancien compte est ignorée d'elle-même (elle est liée à l'e-mail et au drive). Supprimer le cache, qui garderait les correspondances de l'ancien compte :

```sh
$D exec -u 1000 hermes rm -f /opt/data/chronodrive-correspondances.sqlite
```

### 4. Déclarer le MCP dans `config.yaml`

**Sauvegarder d'abord**, avant toute modification de `config.yaml` : `cp -p config.yaml config.yaml.bak-avant-320-prb` (dans `/opt/data`). Puis, sous `mcp_servers`, remplacer l'entrée `chronodrive-spike` par :

```yaml
  chronodrive:
    command: node
    args:
      - /opt/data/chronodrive-mcp/src/mcp.ts
    enabled: true
```

- Sans `env`, le MCP est en **lecture seule** : c'est l'état voulu pour le déploiement à blanc et la mesure.
- Le passage en écriture se fait en ajoutant `env: {CHRONODRIVE_LECTURE_SEULE: '0'}`, seulement pour le premier run réel, avec Arnaud, et **seulement après l'étape 8** (outils du run webhook restreints).
- Les outils apparaissent dans Hermes sous `mcp__chronodrive__<outil>`. Les outils du serveur général OMQ apparaissent sous `mcp__On_Mange_Quoi____<outil>` ; ceux du serveur `OMQ exécuteur` (#330, « Durcissement #330 ») se repèrent par leur nom, Hermes nettoyant le préfixe.
- Vérifier aussi que `platforms.webhook.extra.host` vaut `127.0.0.1`. Sinon le webhook est exposé au réseau local.

Pour pouvoir vider le panier depuis Telegram (voir « Vider le panier (hors run) »), déclarer aussi le serveur séparé `chronodrive-admin` sous `mcp_servers`, **en trois temps** :

1. Déclarer l'entrée **sans `env`** (sauvegarde faite en tête de cette étape), donc en lecture seule. L'ajout d'un serveur sous `mcp_servers` se recharge à chaud : l'entrée est **chargée dès l'enregistrement du fichier**, sans redémarrage ni feu vert, avant toute vérification des surfaces qui l'exposent.

   ```yaml
     chronodrive-admin:
       command: node
       args:
         - /opt/data/chronodrive-mcp/src/mcp-admin.ts
       enabled: true
   ```

   Sans `CHRONODRIVE_LECTURE_SEULE: '0'`, l'aperçu marche mais la confirmation est refusée sans appel API : aucun retrait n'est possible. Cette variable est celle de **ce** serveur ; celle de `chronodrive` reste indépendante.
2. **Vérifier toutes les surfaces** (étape 8) : chaque `platform_toolsets.<plateforme>` de `config.yaml` (Home Assistant compris), les tâches cron et chaque route de `webhook_subscriptions.json`. Aucune ne doit laisser passer `vider_panier` ; seule `telegram` nomme `chronodrive-admin`.
3. **Seulement après**, ajouter `env: {CHRONODRIVE_LECTURE_SEULE: '0'}` à l'entrée, au redémarrage qui suit l'étape 8 (celui qui arme aussi `chronodrive`), avec le feu vert explicite d'Arnaud. Un changement de code ou d'`env` de ce serveur exige en effet de redémarrer la gateway.

### 5. Installer la skill

À faire avant le redémarrage, pour que la gateway la trouve au démarrage (sa prise en compte à chaud n'est pas vérifiée).

```sh
tar -C integrations/chronodrive-mcp/hermes/skills -cf - omq \
  | ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes \
      sh -c "mkdir -p /opt/data/skills && tar -C /opt/data/skills -xf -"'
```

Chemin final : `/opt/data/skills/omq/panier-chronodrive/SKILL.md`. La skill se lance aussi à la main par `/panier-chronodrive` (mode mesure : `hermes/prompt-mesure.md`).

### 6. Redémarrer la gateway

Un changement du code ou de l'`env` d'un serveur MCP (par exemple après l'étape 2) exige un redémarrage ; l'ajout ou le retrait d'un serveur sous `mcp_servers` se recharge à chaud. La gateway porte aussi Telegram, WhatsApp, Home Assistant et le cron : **prévenir Arnaud et attendre son feu vert**. Puis :

```sh
$D exec hermes /package/admin/s6/command/s6-svc -t /run/hermes-service/gateway-default
```

Depuis l'image s6-overlay de Hermes, `s6-svc` n'est plus dans le `PATH` et le service `gateway-default` vit sous `/run/hermes-service` (scruté par un second `s6-svscan`), plus sous `/run/service`. La gateway s'arrête puis est relancée par son superviseur en une trentaine de secondes : contrôler dans `gateway.log` les lignes « ✓ webhook connected », « ✓ telegram connected » et « ✓ whatsapp connected ».

Préférer cette commande à `docker restart hermes`, qui relance tout le conteneur. Après le redémarrage :

- vérifier que Hermes liste les outils `chronodrive` ;
- vérifier que Telegram répond ;
- vérifier que WhatsApp est reconnecté.

La gateway redémarre de toute façon chaque jour vers 04 h 16.

Contrôle de fumée, en lecture seule, depuis Hermes :

- `chercher_produits` sur `["lait demi-écrémé", "œufs"]` ;
- `lire_panier` ;
- `ajouter_au_panier` doit être refusé (« lecture seule »).

### 7. Route webhook et Funnel

Suivre `hermes/route-webhook.md` :

- secret `OMQ_WEBHOOK_SECRET` de `chronodrive.env`, brut et conservé ;
- `hermes webhook subscribe panier-omq …`, sans redémarrage ;
- Funnel sur le port **10000**, chemin `/webhooks/panier-omq`.

### 8. Restreindre les outils du run webhook (obligatoire avant l'écriture)

**Tant que cette étape n'est pas faite et vérifiée, `CHRONODRIVE_LECTURE_SEULE` ne passe à `'0'` ni pour `chronodrive` ni pour `chronodrive-admin`.**

Par défaut, un run webhook voit `web_search`, `web_extract`, `vision_analyze`, `clarify` et **tous** les serveurs MCP activés : linkedin, camofox-browser, dodojo, en plus de `chronodrive` et OMQ. La skill interdit les autres outils, mais le contenu de la liste et les libellés Chronodrive sont des données non fiables : une consigne glissée dans un libellé ne doit trouver aucun autre outil à appeler. Le run de `panier-omq` doit donc ne voir **que** les deux serveurs MCP `chronodrive` et `OMQ exécuteur` (endpoint `/api/mcp/executeur`, #330), **pas** le serveur général « On Mange Quoi ? ».

La route `panier-omq` est **dynamique** (`hermes webhook subscribe …`) et la CLI n'a pas d'option `toolsets` : la clé s'ajoute **à la main** dans `/opt/data/webhook_subscriptions.json`, dans l'objet de la route :

```json
"toolsets": ["chronodrive", "OMQ exécuteur"]
```

- **Désigner chaque serveur par son nom**, jamais par `mcp-<nom>` : avec `mcp-<nom>`, Hermes ignore la clé sans erreur et le run voit tous les MCP activés.
- **Sauvegarder avant de modifier** : `cp webhook_subscriptions.json webhook_subscriptions.json.bak-<motif>` (le fichier contient le secret, mode `600` ou `640`).
- **Aucun redémarrage** : une route dynamique, et l'ajout ou le retrait d'un serveur MCP, sont rechargés à chaud. Seul un changement du **code** ou de l'`env` d'un serveur MCP exige de redémarrer la gateway (étape 6).

`chronodrive` est exclu des plateformes Telegram, WhatsApp, cron, homeassistant et discord (seule `cli` le nomme, pour les mesures manuelles) : le panier ne doit être rempli que par le run webhook ou par une mesure lancée à la main. `platform_toolsets.<plateforme>` est une **liste d'autorisation** : dès qu'elle nomme un serveur MCP (par son nom, pas `mcp-<nom>`), seuls les serveurs nommés passent. `telegram` et `whatsapp` listent donc leurs toolsets natifs, puis `"On Mange Quoi ?"`, `linkedin`, `dodojo` et `camofox-browser`, sans `chronodrive`. Tout nouveau serveur MCP doit y être ajouté à la main. `telegram` (et lui seul) nomme en plus `chronodrive-admin`, par son nom : jamais `whatsapp`, ni les `toolsets` de la route `panier-omq` ni ceux de `controle-outils`. Sauvegarde : `config.yaml.bak-avant-320-toolsets`.

**État réel des surfaces** (sauvegardes : `config.yaml.bak-avant-320-toolsets`, `config.yaml.bak-avant-320-prb`). `platform_toolsets.cli`, `cron`, `homeassistant` et `discord` sont des **listes explicites**, comme `telegram` et `whatsapp` :

- `cron`, `homeassistant` et `discord` ne nomment ni `chronodrive` ni `chronodrive-admin` : une tâche cron lit du contenu web non fiable, et aucune de ces surfaces ne doit remplir ni vider un panier ;
- `cli` nomme `chronodrive` (mesures manuelles) mais pas `chronodrive-admin` ;
- `telegram` nomme `chronodrive-admin` ; `whatsapp` ne nomme ni `chronodrive` ni `chronodrive-admin` ;
- la route `panier-omq` porte `toolsets: ["chronodrive", "OMQ exécuteur"]` (depuis #330 ; avant, « On Mange Quoi ? » à la place d’`OMQ exécuteur`) ;
- `OMQ exécuteur` n’est dans aucune liste `platform_toolsets` sauf `cli` ;
- le préréglage `webhook` (une route sans `toolsets`) voit encore tous les serveurs MCP : **chaque route porte donc sa clé `toolsets`**.

Un nouveau serveur MCP (ou `indeed`, réactivé) s’ajoute **à la main** à chacune de ces listes et à chaque route de `webhook_subscriptions.json`.

**Avant d'armer `chronodrive-admin`** (étape 4, temps 3), contrôler **chaque surface** qui peut lui ouvrir un outil : tout `platform_toolsets.<plateforme>` présent dans `config.yaml` (Home Assistant compris), les tâches cron et chaque route de `webhook_subscriptions.json`. Aucune ne doit laisser passer `vider_panier` ; seule `telegram` nomme `chronodrive-admin`. Une plateforme dont la liste ne nomme aucun serveur MCP les voit tous.

La liste d'une plateforme est relue à chaque tour d'après le code de Hermes, sans redémarrage. Vérifier sur Telegram (« liste tes outils MCP sans en appeler aucun ») que `vider_panier` apparaît et qu'aucun outil de `chronodrive` (`ajouter_au_panier`, `chercher_produits`) n'apparaît, puis sur WhatsApp que `vider_panier` n'apparaît pas. Contrôler le **nom de l'outil**, pas le préfixe `mcp__chronodrive-admin__*` : Hermes nettoie les noms de serveur (`mcp__On_Mange_Quoi____<outil>`), le préfixe réel n'est donc pas garanti.

**Vérifier ce que le run voit réellement**, avec une route de contrôle `controle-outils` qui porte **les mêmes `toolsets`** (même ajout à la main dans `webhook_subscriptions.json`, après sauvegarde), livrée en `log` et dont le prompt demande la liste des outils sans en appeler aucun :

```sh
$D exec -u 1000 hermes sh -c '
  SECRET=$(sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env)
  hermes webhook subscribe controle-outils \
    --prompt "Liste les noms exacts de tous les outils dont tu disposes, un par ligne. N’en appelle aucun." \
    --deliver log \
    --secret "$SECRET"
'
```

Ajouter la clé `toolsets` à la route `controle-outils` (même valeur que `panier-omq`), puis lui envoyer un webhook signé :

```sh
$D exec -u 1000 hermes sh -c '
  SECRET=$(sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env)
  node /tmp/envoyer-webhook.mjs http://127.0.0.1:8644/webhooks/controle-outils "$SECRET"
'
```

Le script `envoyer-webhook.mjs` signe comme OMQ : le copier avant, depuis `outils/` du dépôt, dans `/tmp` du conteneur, puis le lancer de là. Depuis le PC, à la racine du dépôt : `ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes sh -c "cat > /tmp/envoyer-webhook.mjs"' < integrations/chronodrive-mcp/outils/envoyer-webhook.mjs`. La livraison `log` n'envoie rien sur Telegram : lire la réponse du run dans `/opt/data/state.db`. Elle ne doit lister que les outils `mcp__chronodrive__*` et les trois outils d’`OMQ exécuteur` (`prendre_demande_panier`, `cocher_article_demande`, `rapporter_panier`), et ni `vider_panier`, ni `lire_liste_courses`, ni `cocher_article`, ni `lancer_demande_panier`. Supprimer ensuite la route `controle-outils` (`hermes webhook --help` donne la sous-commande).

### Durcissement #330 : jetons de demande et serveur « OMQ exécuteur »

Un run Hermes a un jour sauté `prendre_demande_panier`, inventé une `ancre`, coché le mauvais cycle et rempli le vrai panier. Les consignes de skill ne suffisent pas : #330 les remplace par des gardes serveur.

- Le run ne voit plus le serveur général « On Mange Quoi ? » mais le serveur `OMQ exécuteur` (endpoint `/api/mcp/executeur` d’OMQ), qui n’a que `prendre_demande_panier`, `cocher_article_demande` (sans `ancre`) et `rapporter_panier`. Ce serveur gère lui-même « cycle changé » et « liste vide ».
- `prendre_demande_panier` renvoie un `jeton` par article, signé par OMQ avec `OMQ_WEBHOOK_SECRET` et valable 30 min (`pris_le + 30 min`). `ajouter_au_panier` exige ces jetons (`jetons` sur chaque ligne) et les vérifie avec le même secret, lu dans `chronodrive.env`. Sans jeton valide, rien n’est envoyé à Chronodrive.

**Deux phases autour du merge.** Le code de `chronodrive` passe **avant** le merge : le nouveau code échoue fermé avec l’ancienne skill (`jetons` est requis par le schéma de `ajouter_au_panier`), donc plus aucun ajout n’est possible, même si un modèle léger sautait la prise ou inventait une `ancre`. Faire l’inverse (merge d’abord, NAS ensuite) rouvrirait le chemin de l’incident : tant que le NAS garde la skill 1.1.0, la route avec « On Mange Quoi ? » et l’ancien `chronodrive` sans jetons, `prendre_demande_panier` disparaît de `/api/mcp` mais `lire_liste_courses(ancre)`, `cocher_article(ancre)` et `ajouter_au_panier` restent appelables.

**Aucune demande de panier entre le début de la phase A et la fin de la phase B** : ni le bouton de `/courses`, ni `lancer_demande_panier` depuis Telegram, ni `preparer-cycle`. Aucune des étapes ci-dessous ne touche à `CHRONODRIVE_LECTURE_SEULE`. **Toute opération sur le NAS se fait avec Arnaud.** `$D` est défini en tête de « Installation sur le NAS ». Chaque étape qui modifie le NAS commence par sa sauvegarde, sans écraser une sauvegarde déjà prise (`[ -e … ] ||`).

#### Phase A : avant le merge (code `chronodrive` et secret)

1. **Copier le code de `chronodrive-mcp`.** Sauvegarde du dossier, puis copie et `npm ci` comme à l’étape 2 d’« Installation sur le NAS » (même commande `tar` depuis le PC) :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data
     [ -e chronodrive-mcp.bak-avant-330.tgz ] || tar -czf chronodrive-mcp.bak-avant-330.tgz chronodrive-mcp
     ls -l chronodrive-mcp.bak-avant-330.tgz
   '
   ```

   Le code du durcissement n’est pas encore sur `main` : faire l’archive `tar` depuis la branche de la PR #330, `git switch feat/330-gardes-run-panier` avant la commande `tar` de l’étape 2 d’« Installation sur le NAS » (sinon l’archive contiendrait l’ancien code). La copie s’applique tout de suite au disque, mais le MCP garde l’ancien code en mémoire jusqu’au redémarrage de l’étape 3.
2. **Vérifier `OMQ_WEBHOOK_SECRET`.** Lecture seule, sans afficher le secret. Les droits du fichier, puis l’empreinte SHA-256 (12 premiers hex) de la valeur telle que `parseEnv` (`node:util`, comme `src/client.ts`) la lit dans `chronodrive.env`, comparée à celle du secret stocké pour la route `panier-omq` :

   ```sh
   $D exec -u 1000 hermes sh -c '
     stat -c "%a %U" /opt/data/chronodrive.env
     node -e "
       const { parseEnv } = require(\"node:util\");
       const { readFileSync } = require(\"node:fs\");
       const { createHash } = require(\"node:crypto\");
       const h = (s) => createHash(\"sha256\").update(String(s)).digest(\"hex\").slice(0, 12);
       const lu = parseEnv(readFileSync(\"/opt/data/chronodrive.env\", \"utf8\")).OMQ_WEBHOOK_SECRET;
       const abonnements = JSON.parse(readFileSync(\"/opt/data/webhook_subscriptions.json\", \"utf8\"));
       const route = abonnements[\"panier-omq\"] ?? (abonnements.routes ?? {})[\"panier-omq\"];
       console.log(\"chronodrive.env (parseEnv) :\", lu === undefined ? \"ABSENT\" : h(lu));
       console.log(\"route panier-omq (secret)  :\", route?.secret === undefined ? \"ABSENT\" : h(route.secret));
     "
   '
   ```

   Attendu : `600 1000`, puis **deux empreintes identiques** (aucune « ABSENT »). Si le JSON de Hermes range le secret ailleurs, adapter l’accès à `route` sans jamais afficher le secret. C’est le secret déjà enregistré dans OMQ (Vault) et dans la route `panier-omq`, à l’identique : le MCP l’utilise maintenant pour **vérifier** les jetons qu’OMQ signe avec (tableau des variables, étape 3 d’« Installation sur le NAS »). Des guillemets ou des espaces dans `chronodrive.env` font différer ce que lit `parseEnv` de ce que `sed` a passé à la CLI : c’est ce que la comparaison détecte, et un simple `grep -c` ne le voit pas. Une rotation change les trois endroits ensemble (`hermes/route-webhook.md`), hors run : les jetons déjà pris deviennent invalides.
3. **Redémarrer la gateway, seulement après le feu vert explicite d’Arnaud.** Elle porte aussi Telegram, WhatsApp, Home Assistant et le cron : prévenir Arnaud et attendre son accord, sans le déduire d’un accord sur une autre étape. Sans ce feu vert, le classifieur de Hermes bloque la commande et on ne le contourne pas. Puis, comme à l’étape 6 d’« Installation sur le NAS » (commande de l’étape 6) et avec ses vérifications : Hermes liste les outils `chronodrive`, Telegram répond, WhatsApp est reconnecté. Le MCP `chronodrive` tourne alors avec le nouveau code : il refuse tout ajout sans jeton valide, y compris avec la skill 1.1.0 encore en place.

#### Merge

Merge de la PR #330 : migration des jetons appliquée sur la base de prod (RPC `demande_panier_en_cours` et `signer_jetons_panier`) et déploiement Vercel (endpoint `/api/mcp/executeur`). Vérifier que les deux sont en place avant la phase B : sans eux, `prendre_demande_panier` n’existe pas encore côté OMQ.

- **Migration prod** (lecture seule ; `SUPABASE_ACCESS_TOKEN` en variable d’environnement, jamais affiché) : les deux fonctions doivent être listées.

  ```sh
  node scripts/query-supabase.mjs gabyhlcwahzquolwxmgd "select proname from pg_proc where proname in ('signer_jetons_panier','demande_panier_en_cours')"
  ```
- **Vercel** : l’endpoint exécuteur doit répondre `401` (jeton requis), et la metadata de ressource protégée doit avoir un `resource` qui finit par `/api/mcp/executeur`.

  ```sh
  curl -s -o /dev/null -w '%{http_code}' https://webapp-repas.vercel.app/api/mcp/executeur
  curl -s https://webapp-repas.vercel.app/.well-known/oauth-protected-resource/api/mcp/executeur
  ```

#### Phase B : après le merge (serveur « OMQ exécuteur », toolsets, skill)

4. **Déclarer le serveur `OMQ exécuteur` sous `mcp_servers`.** Sauvegarde de `config.yaml` d’abord :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data
     [ -e config.yaml.bak-avant-330 ] || cp -p config.yaml config.yaml.bak-avant-330
   '
   ```

   Puis, sous `mcp_servers`, une entrée `OMQ exécuteur` : recopier celle de « On Mange Quoi ? » (même bloc d’authentification OAuth) en ne changeant que l’URL. Le dépôt ne documente pas ce bloc, il se lit dans le `config.yaml` du NAS :

   ```yaml
     "OMQ exécuteur":
       url: https://webapp-repas.vercel.app/api/mcp/executeur
       enabled: true
       # + bloc d'authentification identique à « On Mange Quoi ? »
   ```

   Faire ensuite, avec Arnaud, le login OAuth de ce serveur comme pour « On Mange Quoi ? » : Hermes donne une URL d’autorisation, Arnaud la valide (écran de consentement OMQ), puis on colle dans Hermes l’URL de retour du navigateur. L’ajout se recharge à chaud, sans redémarrage : le serveur est chargé dès l’enregistrement du fichier, d’où l’étape 5 tout de suite après.
5. **`platform_toolsets` : ajouter `OMQ exécuteur` à `cli` seulement.** Même sauvegarde que l’étape 4, à reprendre telle quelle si cette étape se fait dans une autre session. Dans `config.yaml`, ajouter la ligne `- "OMQ exécuteur"` à la liste de `cli`, en laissant ses autres entrées :

   ```yaml
   platform_toolsets:
     cli:
       # … entrées existantes, inchangées …
       - "OMQ exécuteur"
   ```

   Puis contrôler :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data
     [ -e config.yaml.bak-avant-330 ] || cp -p config.yaml config.yaml.bak-avant-330
     grep -n "OMQ exécuteur" config.yaml
   '
   ```

   Relire ensuite le bloc `platform_toolsets` plateforme par plateforme : `OMQ exécuteur` doit être **absent** de `telegram`, `whatsapp`, `cron`, `homeassistant` et `discord`, et présent dans `cli` (le `grep` ne doit donner que l’entrée de `mcp_servers` et la ligne de `cli`). Pourquoi : `platform_toolsets.<plateforme>` est une liste d’autorisation ; une plateforme qui nommerait ce serveur donnerait à un message Telegram ou à une tâche cron la prise et le rapport de demandes de panier. Ces plateformes gardent « On Mange Quoi ? » : le serveur général a perdu `prendre_demande_panier` et `rapporter_panier`.
6. **Route `panier-omq` : `toolsets: ["chronodrive", "OMQ exécuteur"]`.** Sauvegarde, puis modification à la main de la clé `toolsets` de la route dans `webhook_subscriptions.json` (rechargée à chaud, sans redémarrage ; noms de serveurs, jamais `mcp-<nom>`) :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data
     [ -e webhook_subscriptions.json.bak-avant-330 ] || cp -p webhook_subscriptions.json webhook_subscriptions.json.bak-avant-330
   '
   ```

   Vérifier avec la route de contrôle `controle-outils` de l’étape 8 (mêmes `toolsets`, sauvegarde avant de toucher au fichier, route supprimée ensuite) : la liste ne doit contenir que les outils `chronodrive` et `prendre_demande_panier`, `cocher_article_demande`, `rapporter_panier`.
7. **Installer la skill 1.2.0.** Sauvegarde de la skill en place (une archive hors du dossier `skills`, pour que Hermes ne la charge pas comme une seconde skill), puis la commande de l’étape 5 d’« Installation sur le NAS » :

   ```sh
   $D exec -u 1000 hermes sh -c '
     cd /opt/data/skills
     [ -e /opt/data/skills-omq.bak-avant-330.tgz ] || tar -czf /opt/data/skills-omq.bak-avant-330.tgz omq
     ls -l /opt/data/skills-omq.bak-avant-330.tgz
   '
   ```

   Contrôler ensuite que `/opt/data/skills/omq/panier-chronodrive/SKILL.md` porte `version: 1.2.0`.

**Second redémarrage : non requis en principe.** Les étapes 4 à 6 se rechargent à chaud : ajout d’un serveur sous `mcp_servers`, liste `platform_toolsets` relue à chaque tour, route dynamique de `webhook_subscriptions.json`. La prise en compte à chaud de la skill n’est en revanche pas vérifiée (étape 5 d’« Installation sur le NAS ») : si le premier run ou la route de contrôle montre que la skill 1.2.0 n’est pas celle utilisée, un second redémarrage de la gateway est nécessaire, avec un nouveau feu vert d’Arnaud. La phase B est finie quand `controle-outils` ne liste que les outils attendus et que la skill 1.2.0 est active ; les demandes de panier peuvent reprendre alors.

**Retour arrière** (avec Arnaud) : remettre `config.yaml.bak-avant-330` et `webhook_subscriptions.json.bak-avant-330`, extraire `chronodrive-mcp.bak-avant-330.tgz` dans `/opt/data` et `skills-omq.bak-avant-330.tgz` dans `/opt/data/skills`, puis redémarrer la gateway avec le même feu vert. L’ancien code ne vérifie plus aucun jeton : ne repasser `CHRONODRIVE_LECTURE_SEULE` à `'0'` qu’avec Arnaud.

## Enregistrer l'exécuteur dans OMQ

L'exécuteur se déclare par la fonction SQL `enregistrer_executeur_panier(foyer, url, secret)`, via l'API de management de Supabase, jamais depuis le client. Elle range le secret dans Vault. **En prod (`gabyhlcwahzquolwxmgd`), seulement sur l'accord explicite d'Arnaud.**

Le secret vient d'une variable d'environnement et n'est jamais tapé en clair dans une commande, à cause de l'historique du shell. Depuis le PC, Git Bash, à la racine du dépôt (`SUPABASE_ACCESS_TOKEN` posé) :

```sh
read -rs OMQ_WEBHOOK_SECRET        # coller le secret de chronodrive.env (rien ne s'affiche)
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

## Vider le panier (hors run)

`src/vider-panier.ts` retire du panier Chronodrive courant toutes les lignes, une par une, puis relit le panier : un retrait n'est confirmé que par cette relecture. Il se lance à la main sur le NAS. **Jamais depuis un run Hermes** : le run webhook ne voit aucun outil de retrait (RG-82). Claude Code ne le lance que sur ordre explicite d'Arnaud. Le script ne passe ni commande, ni créneau, ni paiement. Ne pas le lancer pendant un run de panier (carte « Panier en cours… » sur `/courses`) : RG-82 l'interdit.

Toujours commencer par la simulation, qui liste ce qui serait retiré sans rien modifier. Sur le NAS (`$D` est défini plus haut) :

```sh
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes node src/vider-panier.ts --simulation
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes node src/vider-panier.ts
```

Codes de sortie :

| Code | Sens |
|------|------|
| `0` | Simulation, ou panier vidé et relu vide (un panier déjà vide compte aussi). |
| `1` | Panier pas entièrement vidé, panier non relu, ou erreur (connexion, configuration). Le bilan dit quoi vérifier dans l'appli Chronodrive. |
| `2` | Argument inconnu : seul `--simulation` est accepté, et rien n'est lancé. |

Le code se copie comme à l'étape 2. Le script lit le nouveau code à chaque lancement : **pas de redémarrage de la gateway pour lui**.

### Depuis Telegram : l'outil `vider_panier`

Le serveur MCP séparé `chronodrive-admin` (`src/mcp-admin.ts`, étapes 4 et 8) expose un seul outil, `vider_panier`, réservé à Telegram. Le serveur `chronodrive` du run webhook n'a toujours aucun outil de retrait. L'outil se lance sur demande explicite d'Arnaud, jamais pendant un run de panier, et en deux temps :

1. **Aperçu** : `vider_panier` sans `confirmation`. Rien n'est retiré ; l'outil renvoie les lignes du panier (libellé, marque, quantité) et un `jeton` lié à l'état du panier (identifiant du panier et lignes `productId` × quantité).
2. **Confirmation** : après un « oui » explicite d'Arnaud, `vider_panier` avec `confirmation` = ce `jeton`. L'outil relit le panier et compare : si le panier a changé depuis l'aperçu (ajout à la main, commande validée), il refuse sans aucun retrait (« Le panier a changé depuis l’aperçu : relance vider_panier sans confirmation pour un nouvel aperçu. ») et il faut refaire un aperçu. Sinon il vide, relit, et renvoie le même bilan que le script.

La confirmation n'agit que si `CHRONODRIVE_LECTURE_SEULE` vaut `'0'` dans l'entrée `env` de `chronodrive-admin` : sinon elle est refusée sans appel API, l'aperçu reste disponible. Un changement du **code** exige de redémarrer la gateway : les serveurs `chronodrive` et `chronodrive-admin` gardent sinon l'ancien code (`panier.ts`, `admin.ts`) en mémoire ; seul le script `src/vider-panier.ts` relit le code à chaque lancement.

## Préparer le cycle (skill `preparer-cycle`)

La skill `preparer-cycle` (RG-85, RG-86) prépare le prochain cycle avec Arnaud sur Telegram (« prépare mon cycle ») : tendances du foyer sur 8 semaines confirmées par Arnaud, génération et ajustements, deux validations (« repas OK », « panier OK »), `lancer_demande_panier` puis, sur ordre explicite seulement, partage de la liste des repas sur WhatsApp. Elle ne voit aucun outil du serveur `chronodrive` ; seul `vider_panier` (`chronodrive-admin`) est visible sur Telegram, et la skill se l’interdit. Le panier est rempli par le run webhook (`panier-chronodrive`). Ses contrôles sont des consignes, pas des gardes : seules les listes d’outils de l’étape 8 bornent l’agent.

**Installation.** Même commande que l’étape 5 : la skill est copiée avec le dossier `omq`. Chemin final : `/opt/data/skills/omq/preparer-cycle/SKILL.md`. `outils/duree-machine.ts` part avec la copie du code de l’étape 2, qui exclut seulement `node_modules`, `test` et `mesures` : la rejouer si l’outil est plus récent que le NAS.

**Contact WhatsApp.** Le destinataire du partage se mémorise dans Hermes, avec Arnaud, jamais dans Git : une entrée `memory` « OMQ contact partage cycle : <prénom> → <numéro ou JID> » (numéro E.164 ou identifiant WhatsApp, sans préfixe). L’envoi passe par `hermes send -t "whatsapp:<numéro ou JID>" -f <fichier>` avec l’outil `terminal` : Hermes n’expose pas `send_message` à l’agent.

**Mesure.** La durée machine d’un run est la somme des écarts « message d’Arnaud → réponse finale de l’assistant » sur la session Telegram, hors run panier (session webhook) et hors temps de lecture. Objectif : moins de 10 minutes. Dans le conteneur, depuis `/opt/data/chronodrive-mcp` (`$D` est défini plus haut) :

```sh
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes node outils/duree-machine.ts --db /opt/data/state.db --session <id>
$D exec -u 1000 -w /opt/data/chronodrive-mcp hermes node outils/duree-machine.ts --db /opt/data/state.db --depuis <ISO> --jusqu-a <ISO>
```

`--session` est le mode précis : la session du run, refusée (code `2`) si elle est absente de `sessions` ou si sa source n’est pas `telegram`. La fenêtre `--depuis` / `--jusqu-a` compte toutes les sessions Telegram qui y ont un message, tours calculés session par session puis sommés : à réserver au cas où l’identifiant de session manque. Les dates portent un fuseau explicite, `Z` ou `±hh:mm` (`2026-11-02T19:00:00+01:00`), sinon code `2` ; les heures affichées sont celles de Paris. Chaque durée est arrondie à la seconde, et le total est la somme des durées affichées.

L’outil ne lit que `state.db`, en lecture seule. Codes de sortie : `0` mesure affichée, `1` base illisible, `2` argument invalide (drapeau inconnu ou répété, valeur manquante, date sans fuseau, session absente ou hors Telegram).

**Fichier de run.** Un fichier par run réel, `mesures/cycle-<ancre>.md`, d’après `mesures/cycle-gabarit.md`, rempli avec Arnaud après le run. Critère de réussite : 3 runs réels consécutifs réussis ; un run raté remet le compteur à zéro, et la skill est corrigée avant le suivant.

## Spike désinstallé

Fait le 2026-11-01 : l'entrée `chronodrive-spike` a été retirée de `config.yaml`, le dossier a été archivé sur le NAS (`chronodrive-spike.bak-308.tgz`, avec les instantanés de panier) puis supprimé, et le dossier `spike` a été supprimé du dépôt.

La session écrite par le spike dans `/opt/data/chronodrive-session.json` n'a pas d'empreinte `compte` : le nouveau MCP l'ignore, se connecte une fois de plus au premier appel, puis réécrit le fichier avec sa propre session. Il n'y a rien à garder : ce fichier peut être supprimé à tout moment, le MCP en recrée un à la connexion suivante.

## Dépannage

Les messages d'erreur remontent au LLM puis sur Telegram. Ils sont caviardés : jamais de mot de passe, de jeton ni de cookie. Le journal du MCP part sur la sortie d'erreur, dans les logs de la gateway (`/opt/data/logs/gateways/default`).

| Symptôme | Cause et remède |
|----------|-----------------|
| `config : variable CHRONODRIVE_… absente` | Variable manquante dans `chronodrive.env`, ou fichier illisible pour l'utilisateur 1000 (`chown 1000`, `chmod 600`). |
| `HTTP 401 … API Key is not valid` | **Erreur de clé de service**, pas de jeton : aucune reconnexion n'est tentée. Le client a déjà relu une fois les clés `x-api-key` sur l'accueil de chronodrive.com et rejoué l'appel. L'erreur qui persiste veut dire que Chronodrive a changé ses services ou leurs routes : comparer avec le « Protocole relevé » de `docs/etudes/chronodrive.md`. |
| `HTTP 401` sans « API Key » | **Jeton refusé.** Le client a déjà refait une connexion complète et rejoué l'appel une fois (ou venait de se connecter pour cet appel). Un second 401 veut dire identifiants refusés ou compte bloqué. Vérifier le compte dans l'appli, puis supprimer `chronodrive-session.json` (pris en compte au prochain appel). |
| `délai dépassé (20 s sans réponse)` | Chronodrive ne répond pas. Réessayer plus tard ; si cela dure, vérifier la connexion du NAS. |
| `aucun panier courant … CHRONODRIVE_SITE_ID et CHRONODRIVE_MODE` | Le compte n'a pas de panier pour ce drive et ce mode. Vérifier ces deux variables dans `chronodrive.env` : le mode n'est jamais deviné (pas de repli `DRIVE` → `HOME_DELIVERY`). |
| `produit inconnu ou vu il y a plus de 30 min` | Ligne refusée sans envoi : le produit n'a pas été renvoyé par `chercher_produits` depuis moins de 30 min (identifiant inventé, ou run trop long). Rien n'est ajouté. |
| `produit non proposé pour cet article : relance chercher_produits pour ce terme` | Ligne refusée sans envoi : le produit a bien été vu, mais pas dans le résultat du terme de la ligne (identifiant recopié depuis un autre article). Si le produit vient d'une reformulation, la ligne doit porter `terme_recherche`, et cette reformulation doit avoir été cherchée pour la première fois dans un appel de `chercher_produits` postérieur à celui de l'article ; sinon la ligne est aussi refusée. La skill classe l'article « à choisir » sans relance. Rien n'est ajouté. |
| `non tenté : délai du lot dépassé` | Le lot d'ajout a dépassé 90 s : les lignes restantes n'ont pas été envoyées. Rien n'est ajouté pour elles. |
| `ajout peut-être appliqué (délai dépassé)` | L'ajout est parti mais Chronodrive n'a pas répondu en 20 s, et le panier relu ne le montre pas encore : Chronodrive a pu l'appliquer en retard. Vérifier le panier dans l'appli avant toute relance. |
| `login : réponse sans tkn (captcha ou 2FA ?)` | Chronodrive demande un captcha ou une double authentification. Se connecter une fois dans un navigateur depuis le même réseau, puis réessayer. |
| `[cf-ray …, cf-mitigated …]` dans l'erreur | Blocage Cloudflare. Vérifier que le conteneur sort bien par l'IP résidentielle (réseau host). |
| `avertissement` : cache des correspondances indisponible | Non bloquant : le run continue sans cache. Cause habituelle : `database is locked`, quand deux processus écrivent plus de 5 s (deux MCP lancés, ou le spike encore actif), ou fichier SQLite non inscriptible par l'utilisateur 1000. |
| `avertissement` : panier illisible : contrôle "déjà au panier" impossible | `chercher_produits` n'a pas pu lire le panier : `dansPanier` est absent de tous les produits. Les résultats restent valables, mais la skill passe en « Échec technique » avant tout ajout (sinon une relance pourrait doubler un article). Cause : celle de l'erreur journalisée (`panier illisible, dansPanier non renseigné : …`), par exemple Chronodrive en 5xx ou « aucun panier courant ». |
| `lecture seule (CHRONODRIVE_LECTURE_SEULE n'est pas '0')` | Mode par défaut, voulu pour la mesure et le déploiement à blanc. Pour un run réel : `CHRONODRIVE_LECTURE_SEULE: '0'` dans l'entrée `env` de `config.yaml`, après l'étape 8, puis redémarrage avec Arnaud. Le run rapporte un échec « Exécuteur en lecture seule ». |
| Webhook en 401 côté Hermes | Deux causes possibles. Le secret diffère entre la route et OMQ : ré-enregistrer l'exécuteur avec la chaîne exacte de `OMQ_WEBHOOK_SECRET` (sans espace ni retour à la ligne). Ou l'horodatage est périmé : Hermes refuse un `webhook-timestamp` à plus de 300 s ; vérifier l'heure du NAS. |
| Demande « exécuteur injoignable » sur `/courses` | Funnel coupé (`tailscale funnel status`), gateway arrêtée, ou route absente. |
| Aucun message Telegram | Vérifier `--deliver telegram` sur la route. À noter : même un run sans demande (`demande: null`) envoie un court message, car Hermes refuse le marqueur `[SILENT]` sur un tour webhook (« silence marker rejected on a user turn ») ; limite connue. |
