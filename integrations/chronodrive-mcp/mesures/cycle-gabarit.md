# Run « préparer le cycle » du … — gabarit (#320, RG-86)

Copier ce gabarit en `cycle-<ancre>.md`, un fichier par run réel, rempli après le run avec Arnaud. Aucun nom, numéro ni identifiant WhatsApp, aucun identifiant Chronodrive ni jeton : ces données restent hors du dépôt.

## Run

- Date du run :
- Ancre du cycle préparé (début du cycle) :
- Session Telegram (`sessions.id`) :
- Cycle préparé : courant sans repas, ou suivant (déjà rempli : remplacé ou gardé) :

## Durée machine

Somme des écarts « message d’Arnaud → réponse finale de l’assistant » sur la session Telegram, hors run panier (session webhook) et hors temps de lecture. Objectif : moins de 10 minutes.

Commande, dans le conteneur `hermes`, depuis `/opt/data/chronodrive-mcp` :

```sh
node outils/duree-machine.ts --db /opt/data/state.db --session <id>
```

Sortie de l’outil, collée telle quelle :

```text

```

Durée machine :

## Tendances

| Tendance (règle) | Preuves (dates, taux) | Statut | Jugée juste par Arnaud ? |
|------------------|-----------------------|--------|--------------------------|
|  |  | proposée / confirmée / rejetée / observation |  |

- Tendances proposées :
- Tendances confirmées :
- Tendances rejetées :
- Observations (jamais appliquées) :
- Tendances à oublier proposées :

## Modifications

| Date et créneau | Modification | Tendance qui la justifie |
|-----------------|--------------|--------------------------|
|  |  |  |

Repas modifiés : … sur … (un tiers au plus).

## Corrections d’Arnaud

Repas corrigés entre la proposition et « panier OK » (2 au plus pour un run réussi) :

-

## Validations

- « repas OK » donné avant le placard, mots exacts : oui / non
- « panier OK » donné avant `lancer_demande_panier`, mots exacts : oui / non
- Aucun enchaînement seul de la skill : oui / non
- Planning relu après chaque correction : oui / non

## Partage WhatsApp

- Ordre explicite d’Arnaud donné : oui / non / sans objet
- Message au format exact (en-tête, lignes `{jour}{créneau} : {recette}`, lien, ligne panier) : oui / non / sans objet
- Écart de format relevé :

## Critères RG-86

Le run est « réussi » seulement si les 7 lignes sont « oui ».

- Tendances proposées jugées justes par Arnaud : oui / non
- Aucune modification sans tendance ni demande d’Arnaud : oui / non
- Durée machine inférieure à 10 minutes : oui / non
- 2 repas corrigés au plus entre la proposition et « panier OK » : oui / non
- « repas OK » puis « panier OK » respectés, mots exacts : oui / non
- Aucun partage WhatsApp sans ordre explicite : oui / non
- Aucune action enchaînée sans les deux validations : oui / non

## Verdict

- Verdict du run : réussi (7 « oui ») / raté
- Raison, si raté :
- Correction de la skill avant le run suivant, si raté :
- Compteur de runs consécutifs réussis : x/3 (un run raté remet le compteur à zéro)
