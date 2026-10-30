Tu prépares un panier Chronodrive à partir de ma liste de courses On Mange Quoi ? (OMQ). Ce run est une mesure : tu n'ajoutes rien au panier et tu ne modifies rien dans OMQ.

## Outils

- OMQ (serveur MCP « On Mange Quoi ? ») : appelle **uniquement** `lire_liste_courses` (sans argument : articles non cochés du cycle en cours, articles ajoutés à la main compris). N'appelle **jamais** `cocher_article` ni aucun autre outil OMQ.
- Chronodrive (serveur MCP « chronodrive-spike ») : `lister_favoris` (**une seule fois**, au début), puis `rechercher_produits` autant que nécessaire. N'appelle ni `ajouter_au_panier` ni `retirer_du_panier`.
- N'utilise aucun autre outil (terminal, navigateur, fichiers, mémoire).

## Méthode, pour chaque article de la liste

1. Cherche d'abord un produit correspondant dans les favoris, puis avec `rechercher_produits` (essaie au plus 2 termes de recherche différents).
2. Choisis un produit et une quantité, puis classe l'article :
   - **haute** : un seul produit correspond sans ambiguïté sur la nature de l'article, il a `disponible: true`, et la quantité se déduit clairement de la quantité OMQ et de la contenance du produit (ex. « 500 g de farine » → 1 paquet de 1 kg ; « 6 œufs » → 1 boîte de 6) ;
   - **à choisir** : plusieurs produits plausibles (variété, format, marque ou bio qui changent vraiment l'achat), produit seulement indisponible, ou quantité impossible à conclure ; donne au plus 3 candidats ;
   - **introuvable** : aucun produit pertinent après tes recherches.
3. Quantité OMQ absente ou en unité libre (gousse, pincée, botte, feuille, « un peu ») : au plus 1 unité, et **jamais** « haute » si la contenance ne permet pas de conclure.
4. Entre deux produits équivalents, préfère le favori, sinon le moins cher au kilo. Ne force jamais une correspondance pour remplir la case.

## Réponse attendue

Un tableau Markdown, une ligne par article de la liste, dans l'ordre de la liste :

| Article OMQ | Quantité OMQ | Produit choisi (libellé, marque, contenance, id) | Quantité | Source (favori/recherche) | Confiance (haute/à choisir/introuvable) | Candidats si « à choisir » |

Puis une ligne de synthèse : nombre d'articles, nombre et pourcentage de « haute », « à choisir », « introuvable ». Puis la liste des outils que tu as appelés, avec le nombre d'appels de chacun.
