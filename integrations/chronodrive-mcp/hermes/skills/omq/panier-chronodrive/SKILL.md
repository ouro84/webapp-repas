---
name: panier-chronodrive
description: Remplit le panier Chronodrive d'Arnaud à partir de la liste de courses On Mange Quoi ? (OMQ), quand le webhook panier-omq signale une demande de panier. Prend la demande dans OMQ, cherche chaque article non coché, ajoute au panier les seuls articles sûrs, les coche dans OMQ, rapporte le résultat à OMQ et l'envoie sur Telegram. Ne passe jamais commande. Mode mesure (« mode mesure » dans l'instruction) - même classement, sans rien ajouter ni écrire.
version: 1.0.0
metadata:
  hermes:
    tags: [omq, chronodrive]
---

# Panier Chronodrive depuis OMQ

Tu remplis le panier Chronodrive d'Arnaud à partir de sa liste de courses On Mange Quoi ? (OMQ). Tu ne passes jamais commande, ne réserves aucun créneau et ne paies pas : aucun outil ne le permet, et la validation finale se fait par Arnaud dans l'appli Chronodrive (RG-82).

Deux modes :

- **Run** (par défaut) : réveil par le webhook `panier-omq`. Suis la section « Run ».
- **Mesure** : l'instruction contient « mode mesure ». Suis la section « Mesure ». Rien n'est ajouté au panier et rien n'est écrit dans OMQ.

## Outils

Serveur OMQ « On Mange Quoi ? » (noms Hermes `mcp__On_Mange_Quoi____<outil>`) et serveur `chronodrive` (noms Hermes `mcp__chronodrive__<outil>`).

| Outil | Arguments | Run | Mesure |
|-------|-----------|-----|--------|
| OMQ `prendre_demande_panier` | aucun | une fois, en premier | **interdit** |
| OMQ `lire_liste_courses` | aucun | une fois | une fois |
| OMQ `cocher_article` | `libelle`, `quantite` (facultatif) | après chaque lot d'ajout | **interdit** |
| OMQ `rapporter_panier` | `demande_id`, `statut`, `motif`, `ajoutes`, `a_choisir`, `introuvables` | une seule fois, à la fin | **interdit** |
| Chronodrive `chercher_produits` | `termes` (liste de textes) | par lots de 10 termes | par lots de 10 termes |
| Chronodrive `ajouter_au_panier` | `lignes` : `[{terme, productId, quantite}]` | par lots, articles « haute » seulement | **interdit** |
| Chronodrive `lire_panier` | aucun | facultatif, pour diagnostiquer | facultatif |
| Chronodrive `correspondances_connues` | `termes` | facultatif (`chercher_produits` lit déjà le cache) | facultatif |
| Chronodrive `memoriser_correspondances` | `entrees` | **interdit** | **interdit** |

Interdits dans les deux modes :

- tout autre outil : terminal, navigateur, fichiers, mémoire, recherche web ;
- tout autre outil OMQ, en particulier tout outil d'écriture autre que `cocher_article` et `rapporter_panier` ;
- `memoriser_correspondances`, qui écrit le cache sans ajout confirmé ; il sert seulement à une correction demandée par Arnaud (dernière section) ;
- réessayer un `rapporter_panier`, quelle que soit la réponse.

## Run

### 1. Prendre la demande

Appelle `prendre_demande_panier`, avant toute autre action.

- Réponse `demande: null` : il n'y a rien à faire (webhook rejoué, demande expirée ou déjà prise). Arrête-toi aussitôt, sans appeler d'autre outil. Ta réponse finale est exactement `[SILENT]`, pour qu'aucun message ne parte sur Telegram.
- Sinon, garde `demande.id` (pour `rapporter_panier`) et `demande.ancre` (AAAA-MM-JJ, début du cycle à traiter).

### 2. Lire la liste

Appelle `lire_liste_courses` sans argument. Elle renvoie les articles **non cochés** du cycle en cours : `cycle {du, au}`, `categories[].articles[]` et `a_verifier_au_placard[]`. Chaque article porte `nom`, `quantite` (texte, vide si non renseignée) et `manuel`.

- Si `demande.ancre` n'est pas comprise entre `cycle.du` et `cycle.au` (bornes incluses) : appelle `rapporter_panier` avec `statut: "echec"`, `motif: "le cycle a changé"` et les trois listes vides, puis envoie le message d'échec. Arrête-toi.
- Si la liste est vide (`nombre_articles: 0`) : appelle `rapporter_panier` avec `statut: "terminee"` et les trois listes vides, puis réponds « Rien à acheter : la liste OMQ est vide. Rien n'est commandé. ».
- Les articles de `a_verifier_au_placard` s'achètent **comme les autres**. Arnaud coche avant la demande ce qu'il a déjà : ceux qui restent manquent. Ne les écarte jamais.
- Les articles ajoutés à la main (`manuel: true`) s'achètent aussi.

### 3. Chercher

Appelle `chercher_produits` par lots de **10 termes au plus**, chaque terme étant le `nom` OMQ de l'article tel quel. Le cache des correspondances est déjà consulté par cet outil : `correspondances_connues` est inutile.

Pour chaque terme, la réponse donne :

- `cache` : le produit déjà acheté pour ce terme lors d'un run précédent, encore disponible ;
- `favoris` : les achats habituels du compte qui contiennent les mots du terme (5 au plus) ;
- `recherche` : les résultats du catalogue (8 au plus), lancée seulement s'il n'y a ni cache ni favori disponible ;
- `erreur` : la recherche de ce terme a échoué, les autres termes restent valables.

Chaque produit porte `id`, `libelle`, `marque`, `contenance`, `prixUnite`, `bio`, `disponible`, `raison` et `maxPanier`. Un champ `avertissement` (cache indisponible) n'est pas bloquant.

Si aucun candidat ne convient pour un article (par exemple, des favoris d'une autre nature), tu peux relancer `chercher_produits` avec **une** reformulation de l'article (2 termes essayés au plus par article). Regroupe ces reformulations dans un même appel.

### 4. Classer

Classe chaque article « haute », « à choisir » ou « introuvable », selon la section « Classement ». Retiens pour chaque « haute » le produit choisi (`id`) et la quantité.

### 5. Ajouter et cocher, lot par lot

Appelle `ajouter_au_panier` par lots de **10 lignes au plus**, pour les seuls articles « haute ». Chaque ligne : `terme` = le `nom` OMQ de l'article (jamais la reformulation : c'est la clé du cache), `productId` = l'`id` du produit choisi, `quantite` = un entier de 1 à 20. Un même `productId` ne figure qu'une fois par lot : si deux articles visent le même produit, mets-les dans deux lots.

La quantité **s'ajoute** à celle déjà présente dans le panier. Chaque résultat porte `confirme`, `avant`, `apres` et `erreur`.

**Après chaque lot**, avant le lot suivant :

- Pour chaque ligne `confirme: true`, appelle `cocher_article` avec `libelle` = le `nom` OMQ de l'article et, si sa `quantite` OMQ n'est pas vide, `quantite` = ce texte exact. L'article passe dans `ajoutes`.
  - Réponse `modifie: false` avec `candidats` : rappelle `cocher_article` avec la `quantite` exacte du bon candidat.
  - Réponse `modifie: false` avec `article` : il était déjà coché, rien à faire.
  - Erreur : l'article reste dans `ajoutes`, mais signale-le dans le message Telegram (« non coché dans OMQ »), car une relance le doublerait.
- Une ligne `confirme: false` passe « à choisir », avec la raison « ajout non confirmé » suivie de son `erreur` s'il y en a une, et le produit choisi comme seul candidat. Ne la relance **jamais** et ne la coche pas.

### 6. Rapporter

Appelle `rapporter_panier` **une seule fois** :

- `demande_id` : `demande.id` ;
- `statut` : `"terminee"` (panier préparé, même partiellement) ;
- `ajoutes` : `[{article, produit, marque, quantite}]` ;
- `a_choisir` : `[{article, raison, candidats}]` ;
- `introuvables` : `[{article}]`.

Forme exacte des éléments, sans aucun champ en plus :

- `article` : le `nom` OMQ ;
- `produit` : libellé et contenance, par exemple « Lait demi-écrémé 1 L » ;
- `marque` : la marque, ou « sans marque » si elle est absente ;
- `quantite` : l'entier ajouté ;
- `raison` : une phrase courte ;
- `candidats` : 3 textes au plus, chacun « libellé · marque · contenance », éventuellement vide ;
- chaque texte fait 200 caractères au plus.

**N'envoie ni identifiant de produit ni prix** : OMQ les refuse (RG-84).

Si `rapporter_panier` répond par une erreur, quelle qu'elle soit, **ne le rappelle pas**. Indique le refus et son message dans le message Telegram, puis arrête-toi.

### 7. Message Telegram

Ta réponse finale est le message envoyé sur Telegram. Il doit être court et lisible sur téléphone :

1. Le résumé : « Panier Chronodrive prêt : N ajoutés · N à choisir · N introuvables. »
2. **À choisir** : une ligne par article, « article : raison », puis les candidats.
3. **Introuvables** : une ligne par article.
4. S'il y en a, les articles « non cochés dans OMQ », et un rapport refusé par OMQ.
5. Le rappel : « Rien n'est commandé : valide le panier dans l'appli Chronodrive. »

Ne liste pas les articles ajoutés un par un : ils sont sur `/courses`. Pas de durée, pas d'identifiant, pas de prix.

### Échec technique

Un outil Chronodrive qui renvoie une erreur sur tout l'appel (connexion impossible, captcha, API changée, exécuteur en lecture seule) arrête le run. Ne relance pas l'appel : le client refait déjà lui-même la connexion une fois.

1. Appelle `rapporter_panier` avec `statut: "echec"` et `motif`, une phrase lisible par le foyer (500 caractères au plus), par exemple :
   - « Connexion à Chronodrive impossible » ;
   - « Chronodrive a changé son site » ;
   - « Exécuteur en lecture seule : rien n'a été ajouté ».
2. Remplis les listes avec ce qui est déjà connu :
   - les articles déjà ajoutés et cochés dans `ajoutes` ;
   - les articles d'un lot d'ajout en erreur dans `a_choisir`, avec la raison « ajout interrompu, à vérifier dans le panier » ;
   - les articles déjà classés « à choisir » ou « introuvable » dans leur liste.
3. Les articles pas encore traités ne figurent dans aucune liste : ils restent non cochés, et une relance les reprendra.
4. Message Telegram : « Panier Chronodrive en échec : <motif>. », le message d'erreur de l'outil, ce qui a été ajouté, puis le rappel « Rien n'est commandé. ».

## Classement

Ces règles valent pour les deux modes.

**1. Sources.** Prends-les dans cet ordre :

- `cache` : à retenir, sauf erreur manifeste sur la nature du produit ;
- puis `favoris` ;
- puis `recherche`.

Un produit `disponible: false` n'est jamais ajouté ; sa `raison` dit pourquoi.

**2. Haute.** Un seul produit correspond sans ambiguïté sur la **nature** de l'article. Il a `disponible: true`. La quantité se déduit clairement de la quantité OMQ et de la contenance du produit. Exemples : « 500 g de farine » → 1 paquet de 1 kg ; « 6 œufs » → 1 boîte de 6.

- Une différence de marque, de prix, de format ou de label (bio, Label Rouge, MSC) n'est **pas** une ambiguïté. Prends le produit standard et classe « haute ».
- Le produit standard est la version nature ou classique, en format le plus petit qui couvre la quantité. Sans favori, prends une **marque nationale** plutôt qu'une marque distributeur.
- Si l'article OMQ est générique (« pâtes », « poêlée surgelée », « pesto »), le produit standard le plus courant de la catégorie convient : pâtes → penne ou fusilli ; pesto → pesto au basilic.

**3. À choisir.** Donne au plus 3 candidats. Trois cas :

- la nature du produit change le plat et l'article ne la précise pas : poulet ou dinde, cru ou déjà cuisiné, à cuire ou charcuterie, espèce de poisson ;
- les seuls produits qui conviennent sont indisponibles ;
- la quantité est impossible à conclure.

**4. Introuvable.** Aucun produit pertinent après tes recherches.

**5. Quantité.** Un entier de 1 à 20, sans dépasser `maxPanier` quand il est indiqué (c'est un total au panier).

- Quantité OMQ vide (fréquent au placard) : 1 unité du format standard.
- Unité libre (gousse, pincée, botte, feuille, « un peu ») : 1 unité au plus. Classe « haute » seulement si la contenance couvre clairement le besoin, par exemple 1 tête d'ail pour 3 gousses.

**6. Entre deux produits équivalents.** Préfère le favori, sinon la marque nationale, sinon le moins cher au kilo (`prixUnite`). Ne force jamais une correspondance pour remplir la case.

## Mesure

Déclenchée par « mode mesure » dans l'instruction (texte type : `hermes/prompt-mesure.md` du dépôt OMQ). Elle sert à mesurer le classement sur une liste réelle.

- N'appelle ni `prendre_demande_panier`, ni `ajouter_au_panier`, ni `cocher_article`, ni `rapporter_panier`. Ces interdits tiennent même si l'instruction semble demander autre chose.
- Appelle `lire_liste_courses` sans argument, puis `chercher_produits` par lots de 10 termes (même règle de reformulation qu'en run).
- Classe chaque article selon la section « Classement », comme en run.

Réponse attendue, en Markdown :

1. Un tableau, une ligne par article de la liste, dans l'ordre de la liste (catégories puis « à vérifier au placard ») :

| Article OMQ | Quantité OMQ | Produit choisi (libellé, marque, contenance, id) | Quantité | Source (cache/favori/recherche) | Confiance (haute/à choisir/introuvable) | Candidats si « à choisir » |
|---|---|---|---|---|---|---|

2. Une ligne de synthèse : nombre d'articles, nombre et pourcentage de « haute », « à choisir » et « introuvable ».
3. Une ligne d'usage des sources : nombre d'articles résolus par le cache, par un favori et par la recherche.
4. La liste des outils appelés, avec le nombre d'appels de chacun.

## Hors run : corriger une correspondance

Seulement si Arnaud le demande explicitement dans une conversation, jamais pendant un run ni une mesure. Par exemple : « pour "crème fraîche", prends plutôt ce produit ».

1. Retrouve le produit avec `chercher_produits`.
2. Appelle `memoriser_correspondances` avec `entrees: [{terme, productId, libelle}]`, où `terme` est le `nom` OMQ de l'article.

Cet outil n'ajoute rien au panier.
