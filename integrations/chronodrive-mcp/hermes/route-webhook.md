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
- Le secret `OMQ_WEBHOOK_SECRET` est dans `/opt/data/chronodrive.env` (mode `600`), sans guillemets. Celui du spike est un secret **brut** et il est conservé.

## 1. Secret de la route

OMQ et Hermes acceptent tous deux un secret brut. Ils n'ont besoin que d'une chose : recevoir **exactement la même chaîne**. Un secret au format `whsec_<base64>` marcherait aussi, puisque les deux côtés le décodent de la même façon. Il n'y a rien à convertir.

Le secret ne va **jamais** dans Git ni dans `config.yaml`, et il ne figure dans aucune commande tapée en clair.

## 2. Créer la route

Le secret est lu dans le fichier et passé directement à la CLI, sans être affiché :

```sh
$D exec -u 1000 hermes sh -c '
  SECRET=$(sed -n "s/^OMQ_WEBHOOK_SECRET=//p" /opt/data/chronodrive.env)
  hermes webhook subscribe panier-omq \
    --prompt "Une demande de panier OMQ attend. Applique la skill panier-chronodrive." \
    --skills panier-chronodrive \
    --deliver telegram \
    --deliver-chat-id 8985917282 \
    --description "Réveil de l’exécuteur de panier Chronodrive par OMQ (#308)" \
    --secret "$SECRET"
'
```

- **Prompt de réveil** : « Une demande de panier OMQ attend. Applique la skill panier-chronodrive. ». Il reste volontairement court : la procédure est dans la skill, que Hermes injecte avant le prompt.
- **Skill** : `--skills` prend une liste séparée par des virgules ; ici une seule skill, `panier-chronodrive`.
- **Livraison** : `telegram`, chat `8985917282` (canal maison d'Arnaud). Une réponse `[SILENT]` (aucune demande à traiter) n'est pas livrée.
- **Secret** : pendant l'exécution de la commande, `--secret "$SECRET"` est visible un court instant dans `/proc/*/cmdline` du conteneur. C'est accepté : seul l'utilisateur du conteneur y a accès.
- **Outils du run** : une route dynamique ne restreint pas les outils, et le run voit tous les MCP activés. Avant de passer `CHRONODRIVE_LECTURE_SEULE` à `'0'`, restreindre le run aux deux MCP `chronodrive` et « On Mange Quoi ? » et le vérifier : `README.md`, étape 8 (route statique avec `toolsets`, ou `platform_toolsets.webhook`).

### Contrôle

```sh
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

## Rotation du secret (facultative)

1. Générer un nouveau secret dans `chronodrive.env`, sans l'afficher :

   ```sh
   $D exec -u 1000 hermes sh -c '
     F=/opt/data/chronodrive.env
     sed -i "/^OMQ_WEBHOOK_SECRET=/d" "$F"
     printf "OMQ_WEBHOOK_SECRET=%s\n" "$(head -c 32 /dev/urandom | base64 | tr -d "\n")" >> "$F"
     chmod 600 "$F"
     grep -c "^OMQ_WEBHOOK_SECRET=" "$F"
   '
   ```

   La dernière commande doit afficher `1`.
2. Recréer la route `panier-omq` (étape 2). Si la CLI refuse un nom déjà pris, supprimer d'abord la route (`hermes webhook --help` donne la sous-commande).
3. Ré-enregistrer l'exécuteur dans OMQ avec le nouveau secret. Le secret Vault existant est alors mis à jour.

Entre les étapes 2 et 3, les webhooks d'OMQ sont refusés en 401 : la demande passe en échec « exécuteur injoignable ». C'est sans conséquence, il suffit de relancer.

## Supprimer la route

```sh
$D exec tailscale tailscale funnel --https=10000 off
$D exec -u 1000 hermes hermes webhook --help   # sous-commande de suppression de la route
```
