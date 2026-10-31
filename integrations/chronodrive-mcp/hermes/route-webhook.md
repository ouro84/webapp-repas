# Route webhook `panier-omq` (Hermes v0.21.5)

OMQ réveille l'exécuteur par un `POST` signé, **sans donnée métier** (corps `{"evenement":"demande_panier"}`, RG-81). Le chemin complet est le suivant :

1. OMQ envoie la requête vers `https://<nas>.<tailnet>.ts.net:10000/webhooks/panier-omq`.
2. Tailscale Funnel la transmet à la plateforme webhook de Hermes, sur `http://127.0.0.1:8644/webhooks/panier-omq`.
3. Hermes vérifie la signature et répond 202.
4. Hermes lance un run avec le prompt de réveil et la skill `panier-chronodrive`.
5. La réponse finale du run part sur Telegram.

La route est **dynamique** : elle est stockée dans `/opt/data/webhook_subscriptions.json` et rechargée à chaque requête. Elle ne demande **aucun redémarrage** de la gateway.

Toutes les commandes ci-dessous se lancent dans une session `ssh nas-hermes`, avec :

```sh
D=/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker
```

Si `hermes` n'est pas dans le `PATH` du conteneur, utiliser `/opt/hermes/.venv/bin/hermes`.

## Prérequis

- La skill est installée dans `/opt/data/skills/omq/panier-chronodrive/SKILL.md` (cf. `README.md`).
- Le MCP `chronodrive` est déclaré dans `config.yaml` et la gateway a redémarré depuis.
- La plateforme webhook écoute en local seulement (`platforms.webhook.extra.host: 127.0.0.1`, port `8644`). Vérification depuis le NAS (le conteneur est en réseau host) : `curl -s http://127.0.0.1:8644/health` répond `{"status":"ok","platform":"webhook"}`.
- Le secret `OMQ_WEBHOOK_SECRET` est dans `/opt/data/chronodrive.env` (mode `600`), au format **`whsec_<base64>`**, sans guillemets.

## 1. Secret de la route

Format Standard Webhooks : `whsec_` suivi de la clé HMAC en base64. Hermes **et** OMQ décodent ce base64 ; un secret sans préfixe serait pris brut des deux côtés. Les deux doivent donc recevoir exactement la même chaîne (cf. `.claude/rules/chronodrive.md`).

Le secret laissé par le spike n'a peut-être pas ce format. Dans ce cas, en génère un nouveau, sans l'afficher :

```sh
$D exec -u 1000 hermes sh -c '
  F=/opt/data/chronodrive.env
  sed -i "/^OMQ_WEBHOOK_SECRET=/d" "$F"
  printf "OMQ_WEBHOOK_SECRET=whsec_%s\n" "$(head -c 32 /dev/urandom | base64 | tr -d "\n")" >> "$F"
  chmod 600 "$F"
  grep -c "^OMQ_WEBHOOK_SECRET=whsec_" "$F"
'
```

La dernière commande doit afficher `1`. Le secret ne va **jamais** dans Git ni dans `config.yaml`. Il ne figure dans aucune commande tapée en clair.

## 2. Créer la route

Le secret est lu dans le fichier et passé directement à la CLI, sans être affiché :

```sh
$D exec -u 1000 hermes sh -c '
  SECRET=$(sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env)
  hermes webhook subscribe panier-omq \
    --prompt "Une demande de panier OMQ attend. Applique la skill panier-chronodrive." \
    --skills panier-chronodrive \
    --deliver telegram \
    --secret "$SECRET"
'
```

- **Prompt de réveil** : « Une demande de panier OMQ attend. Applique la skill panier-chronodrive. ». Il reste volontairement court : la procédure est dans la skill, que Hermes injecte avant le prompt.
- **Skill** : `panier-chronodrive`. Hermes n'injecte que la première skill trouvée de la liste.
- **Livraison** : `telegram`. Sans `chat_id`, Hermes livre au canal maison de Telegram (`home_channel`, chat `8985917282`). Une réponse `[SILENT]` (aucune demande à traiter) n'est pas livrée.

### Options à vérifier avant de lancer

Les options `--skills` et `--secret` n'ont **pas** été vérifiées sur la v0.21.5. La reconnaissance du NAS confirme seulement que la route accepte `skills`, `secret`, `deliver` et `deliver_extra`. Avant la première création, lancer :

```sh
$D exec -u 1000 hermes hermes webhook subscribe --help
```

Puis adapter la commande :

- si l'option de skill s'appelle autrement (`--skill`, plusieurs `--skills`…), prendre ce nom ;
- si la CLI **génère** le secret au lieu de le recevoir, ne pas passer `--secret`. Recopier ensuite le secret généré dans `OMQ_WEBHOOK_SECRET`, s'il est au format `whsec_` ; sinon, voir ci-dessous ;
- si la CLI ne prend ni `--skills` ni `--secret`, éditer l'entrée `panier-omq` de `/opt/data/webhook_subscriptions.json` après création. Sauvegarder le fichier d'abord. Clés `skills: ["panier-chronodrive"]` et `secret`. Le fichier est relu à chaud ;
- pour livrer ailleurs qu'au canal maison, chercher l'option de `deliver_extra.chat_id` dans l'aide.

Corriger ce document dans la PR une fois la commande exacte connue.

### Contrôle

```sh
$D exec -u 1000 hermes hermes webhook --help        # sous-commande de liste, si elle existe
$D exec -u 1000 hermes sh -c 'stat -c "%a %U" /opt/data/webhook_subscriptions.json'
```

`webhook_subscriptions.json` contient le secret : il doit rester lisible par l'utilisateur 1000 seul (mode `600` ou `640`). Ne pas l'afficher dans une conversation ni dans un ticket.

## 3. Ouvrir le Funnel (port 10000)

Les ports 443 et 8443 sont pris sur le NAS : le Funnel passe par le port **10000** et publie un **seul** chemin.

```sh
$D exec tailscale tailscale funnel --bg --https=10000 \
  --set-path /webhooks/panier-omq http://127.0.0.1:8644/webhooks/panier-omq
$D exec tailscale tailscale funnel status
```

Au premier lancement, le certificat Let's Encrypt met environ 35 s à arriver.

Contrôles depuis Internet (par exemple depuis le PC hors Tailscale) :

```sh
curl -i -X POST https://<nas>.<tailnet>.ts.net:10000/webhooks/panier-omq -d '{}'   # 401 : sans signature
curl -i https://<nas>.<tailnet>.ts.net:10000/                                      # 404 : rien d'autre n'est publié
```

L'URL de l'exécuteur à enregistrer dans OMQ est `https://<nas>.<tailnet>.ts.net:10000/webhooks/panier-omq`. Le nom du nœud se lit dans `tailscale funnel status`.

## 4. Enregistrer l'exécuteur dans OMQ

Suivre la section « Enregistrer l'exécuteur » du `README.md`. Le même secret `OMQ_WEBHOOK_SECRET` y sert. En prod, l'enregistrement se fait **seulement sur l'accord explicite d'Arnaud**.

## Rotation du secret

1. Générer un nouveau secret (étape 1).
2. Mettre à jour la route. Recréer la route `panier-omq` (étape 2) ou éditer son `secret` dans `webhook_subscriptions.json`.
3. Ré-enregistrer l'exécuteur dans OMQ avec le nouveau secret. Le secret Vault existant est alors mis à jour.

Entre les étapes 2 et 3, les webhooks d'OMQ sont refusés en 401 : la demande passe en échec « exécuteur injoignable ». C'est sans conséquence, il suffit de relancer.

## Supprimer la route

```sh
$D exec tailscale tailscale funnel --https=10000 off
$D exec -u 1000 hermes hermes webhook --help   # sous-commande de suppression (unsubscribe / remove)
```
