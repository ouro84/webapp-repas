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
| `src/outils.ts` | Les 5 outils MCP : `chercher_produits`, `ajouter_au_panier`, `lire_panier`, `correspondances_connues`, `memoriser_correspondances`. `ajouter_au_panier` n'accepte, pour chaque ligne, qu'un produit proposé par `chercher_produits` pour le terme de cette ligne (`terme`, ou `terme_recherche` pour une reformulation cherchée dans un appel postérieur à celui de l'article) depuis moins de 30 min. Avec `quantite_omq` (quantité OMQ de l'article), la quantité est plafonnée au besoin calculé, jamais augmentée (`quantiteAjustee`). `chercher_produits` lit le panier courant une fois par appel et marque chaque produit renvoyé de `dansPanier` (indisponibles compris) : la skill reconnaît ainsi un article déjà au panier, quel que soit le produit qu'elle choisirait. |
| `src/quantites.ts` | Lecture de la quantité OMQ et de la contenance (masse, volume, nombre) et plafond `min(demande, besoin)`. |
| `src/mcp.ts` | Point d'entrée stdio (`node src/mcp.ts`), en lecture seule sauf si `CHRONODRIVE_LECTURE_SEULE` vaut `'0'`. |
| `src/vider-panier.ts` | Script manuel qui vide le panier courant (hors run, jamais exposé à un LLM, RG-82) ; `--simulation` pour voir sans rien retirer. |
| `test/` | Tests `node --test`, Chronodrive simulé (`test/simulation.ts`). |
| `hermes/skills/omq/panier-chronodrive/SKILL.md` | Skill Hermes : procédure du run et du mode mesure. |
| `hermes/route-webhook.md` | Route webhook `panier-omq`, secret, Funnel. |
| `hermes/prompt-mesure.md` | Message de mesure du classement, en lecture seule. |
| `outils/envoyer-webhook.mjs` | Signe et envoie un webhook de test comme OMQ (Standard Webhooks), pour la route de contrôle. |

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
| `OMQ_WEBHOOK_SECRET` | pour la route | Secret de la route webhook, partagé à l'identique avec OMQ. Un secret brut convient. Il n'est pas lu par le MCP mais rangé ici (cf. `hermes/route-webhook.md`). |

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

Dans `/opt/data/config.yaml`, sous `mcp_servers`, remplacer l'entrée `chronodrive-spike` par :

```yaml
  chronodrive:
    command: node
    args:
      - /opt/data/chronodrive-mcp/src/mcp.ts
    enabled: true
```

- Sans `env`, le MCP est en **lecture seule** : c'est l'état voulu pour le déploiement à blanc et la mesure.
- Le passage en écriture se fait en ajoutant `env: {CHRONODRIVE_LECTURE_SEULE: '0'}`, seulement pour le premier run réel, avec Arnaud, et **seulement après l'étape 8** (outils du run webhook restreints).
- Les outils apparaissent dans Hermes sous `mcp__chronodrive__<outil>`. Les outils OMQ apparaissent sous `mcp__On_Mange_Quoi____<outil>`.
- Vérifier aussi que `platforms.webhook.extra.host` vaut `127.0.0.1`. Sinon le webhook est exposé au réseau local.

### 5. Installer la skill

À faire avant le redémarrage, pour que la gateway la trouve au démarrage (sa prise en compte à chaud n'est pas vérifiée).

```sh
tar -C integrations/chronodrive-mcp/hermes/skills -cf - omq \
  | ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes \
      sh -c "mkdir -p /opt/data/skills && tar -C /opt/data/skills -xf -"'
```

Chemin final : `/opt/data/skills/omq/panier-chronodrive/SKILL.md`. La skill se lance aussi à la main par `/panier-chronodrive` (mode mesure : `hermes/prompt-mesure.md`).

### 6. Redémarrer la gateway

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

### 7. Route webhook et Funnel

Suivre `hermes/route-webhook.md` :

- secret `OMQ_WEBHOOK_SECRET` de `chronodrive.env`, brut et conservé ;
- `hermes webhook subscribe panier-omq …`, sans redémarrage ;
- Funnel sur le port **10000**, chemin `/webhooks/panier-omq`.

### 8. Restreindre les outils du run webhook (obligatoire avant l'écriture)

**Tant que cette étape n'est pas faite et vérifiée, `CHRONODRIVE_LECTURE_SEULE` ne passe pas à `'0'`.**

Par défaut, un run webhook voit `web_search`, `web_extract`, `vision_analyze`, `clarify` et **tous** les serveurs MCP activés : linkedin, camofox-browser, dodojo, en plus de `chronodrive` et OMQ. La skill interdit les autres outils, mais le contenu de la liste et les libellés Chronodrive sont des données non fiables : une consigne glissée dans un libellé ne doit trouver aucun autre outil à appeler. Le run de `panier-omq` doit donc ne voir **que** les deux serveurs MCP `chronodrive` et « On Mange Quoi ? ».

Une route dynamique ne prend pas `toolsets`. Pistes, selon ce que Hermes v0.21.5 accepte (à lire dans sa documentation ou `hermes webhook --help`) :

- une route **statique** `platforms.webhook.extra.routes.panier-omq` dans `config.yaml`, avec `toolsets` limité aux deux MCP, à la place de la route dynamique ; elle demande un redémarrage ;
- ou `platform_toolsets.webhook` limité aux deux MCP : il s'applique à toutes les routes webhook, ce qui convient tant que `panier-omq` est la seule.

`chronodrive` est exclu des plateformes Telegram et WhatsApp (#320, 2026-11-01) : le panier ne doit être rempli que par le run webhook ou par une mesure lancée à la main. `platform_toolsets.<plateforme>` est une **liste d'autorisation** : dès qu'elle nomme un serveur MCP (par son nom, pas `mcp-<nom>`), seuls les serveurs nommés passent. `telegram` et `whatsapp` listent donc leurs toolsets natifs, puis `"On Mange Quoi ?"`, `linkedin`, `dodojo` et `camofox-browser`, sans `chronodrive`. Tout nouveau serveur MCP doit y être ajouté à la main. Sauvegarde : `config.yaml.bak-avant-320-toolsets`. La config est relue à chaque tour, sans redémarrage d'après le code de Hermes ; vérifier sur Telegram (« liste tes outils MCP sans en appeler aucun ») qu'aucun `mcp__chronodrive__*` n'apparaît.

Sauvegarder `config.yaml` avant (`config.yaml.bak-avant-308-toolsets`), puis redémarrer la gateway avec Arnaud (étape 6).

**Vérifier ce que le run voit réellement**, avec une route de contrôle soumise à la même restriction (même `platform_toolsets.webhook`, ou route statique avec les mêmes `toolsets`), dont le prompt demande la liste des outils sans en appeler aucun :

```sh
$D exec -u 1000 hermes sh -c '
  SECRET=$(sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env)
  hermes webhook subscribe controle-outils \
    --prompt "Liste les noms exacts de tous les outils dont tu disposes, un par ligne. N’en appelle aucun." \
    --deliver telegram --deliver-chat-id 8985917282 \
    --secret "$SECRET"
  node /tmp/envoyer-webhook.mjs http://127.0.0.1:8644/webhooks/controle-outils "$SECRET"
'
```

Le script `envoyer-webhook.mjs` signe comme OMQ : le copier avant, depuis `outils/` du dépôt, dans `/tmp` du conteneur, puis le lancer de là. Depuis le PC, à la racine du dépôt : `ssh nas-hermes '/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker exec -i -u 1000 hermes sh -c "cat > /tmp/envoyer-webhook.mjs"' < integrations/chronodrive-mcp/outils/envoyer-webhook.mjs`. La réponse sur Telegram ne doit lister que des outils `mcp__chronodrive__*` et `mcp__On_Mange_Quoi____*`. Supprimer ensuite la route `controle-outils` (`hermes webhook --help` donne la sous-commande). Si la restriction passe par une route statique, faire le même contrôle avec une route statique de contrôle aux mêmes `toolsets`.

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

`src/vider-panier.ts` retire du panier Chronodrive courant toutes les lignes, une par une, puis relit le panier : un retrait n'est confirmé que par cette relecture. Il se lance à la main sur le NAS, ou par Claude Code via `ssh nas-hermes`. **Jamais par un LLM** : le MCP n'expose aucun outil de retrait (RG-82), et le script ne passe ni commande, ni créneau, ni paiement.

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

Le code se copie comme à l'étape 2. Le script lit le nouveau code à chaque lancement : **pas de redémarrage de la gateway pour lui**. Le MCP en cours garde l'ancien code jusqu'au prochain redémarrage, ce qui est compatible : le vidage n'y touche pas.

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
