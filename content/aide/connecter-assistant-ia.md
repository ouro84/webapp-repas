_Ton assistant IA (Claude, Cursor, OpenCode, Hermes…) peut lire et modifier ton planning et ta liste de courses, sans ouvrir l’app._

Tu lui demandes « on mange quoi ce soir ? », « génère mon cycle », « remplace le repas de jeudi midi par une blanquette » ou « envoie-moi la liste de courses », et il le fait dans OMQ, en ton nom et seulement pour ton foyer.

## L’adresse à donner à ton assistant

```plain text
https://webapp-repas.vercel.app/api/mcp
```

C’est un serveur MCP (le protocole que les assistants utilisent pour se brancher à une app). À la première connexion, l’assistant t’envoie sur un écran OMQ : tu te connectes si besoin, puis tu cliques sur **« Autoriser »**. Tant que tu n’as pas autorisé, il n’a accès à rien.

## Dans Claude (claude.ai ou l’app Claude)

1. Va dans **Personnaliser > Connecteurs**.

1. Clique sur **+ Ajouter**, puis **Ajouter un connecteur personnalisé**.

1. Donne-lui un nom (« OMQ ») et colle l’adresse ci-dessus.

1. Valide, puis connecte-toi et autorise l’accès sur l’écran OMQ.

Dans une conversation, active le connecteur via le bouton **+**, puis **Connecteurs**.

## Dans Claude Code

```plain text
claude mcp add --transport http omq https://webapp-repas.vercel.app/api/mcp
```

Lance ensuite `/mcp` dans Claude Code et choisis **omq** pour te connecter.

## Dans Cursor

Ajoute OMQ dans `~/.cursor/mcp.json` :

```json
{
  "mcpServers": {
    "omq": { "url": "https://webapp-repas.vercel.app/api/mcp" }
  }
}
```

Cursor propose ensuite de te connecter depuis ses réglages MCP.

## Dans OpenCode

Ajoute OMQ dans `opencode.json` :

```json
{
  "mcp": {
    "omq": { "type": "remote", "url": "https://webapp-repas.vercel.app/api/mcp" }
  }
}
```

Puis lance `opencode mcp auth omq` : ton navigateur s’ouvre sur l’écran OMQ.

## Dans Hermes (Docker sur un NAS)

Hermes tourne sans écran, donc la connexion se fait en deux temps : Hermes affiche une adresse, tu l’ouvres dans le navigateur de ton PC.

1. Ajoute le serveur dans la config de Hermes (`mcp_servers:`), avec l’adresse ci-dessus et le nom `omq`.

1. Depuis un terminal sur le NAS, lance la connexion : `docker exec -it hermes hermes mcp login omq` (remplace `hermes` par le nom de ton conteneur).

1. Hermes affiche une adresse d’autorisation. Ouvre-la dans le navigateur de ton PC, connecte-toi à OMQ et autorise.

1. Le navigateur part alors vers `http://127.0.0.1:<port>/callback` et affiche une erreur : c’est normal. Copie l’adresse complète de la barre d’adresse et colle-la dans le terminal de Hermes.

Hermes attend ce copier-coller jusqu’à 5 minutes.

> 💡 Le port change à chaque connexion (Hermes en prend un libre) : lis-le dans la ligne `Waiting for callback on …` qu’il affiche. Si tu préfères un tunnel au copier-coller, ouvre-le depuis ton PC avec ce port : `ssh -N -L <port>:127.0.0.1:<port> <ton-nas>`. Le tunnel ne marche que si le conteneur partage le réseau du NAS (`network_mode: host`).

## Ce que ton assistant peut faire

- Lire le planning du cycle en cours (ou d’une semaine), la liste de courses (ce qu’il reste à acheter) et la recette d’un repas, ingrédients à l’échelle.

- Générer ton cycle, comme le bouton « Générer mon cycle ». Si le cycle contient déjà des repas, il te demande confirmation avant de l’écraser.

- Remplacer un repas, au hasard ou par une recette que tu nommes. Si plusieurs recettes correspondent, il te propose la liste au lieu de choisir à ta place.

- Changer le nombre de personnes d’un repas (de 1 à 12).

- Ajouter une recette à celles de ton foyer, ajouter un article à la liste de courses, cocher ou décocher un article.

Ses modifications sont des modifications ordinaires : les autres membres du foyer les voient en direct, avec l’alerte habituelle s’ils sont en magasin.

## Déconnecter un assistant

Dans **Profil > Assistants connectés**, clique sur **Déconnecter** à côté de l’assistant. Il ne peut plus se reconnecter sans ton accord, et son accès en cours s’arrête au plus tard une heure après.
