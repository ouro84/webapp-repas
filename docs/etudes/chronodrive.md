# Étude — Remplir un panier Chronodrive depuis OMQ

> Étude de faisabilité du 2026-10-29 (recherche documentaire, sans compte ni requête authentifiée). Épopée #303, spike #307, décision ADR-12. Le spike complète la section « Résultats du spike » en fin de document.

## Besoin

Avec OMQ, l'étape la plus longue des courses est le remplissage du panier dans l'appli Chronodrive (utilisée à 99 % sur mobile). Objectif : remplir le panier à partir des articles non cochés de la liste de courses, en privilégiant les produits favoris du client, et laisser la validation finale à l'humain.

## API Chronodrive

**Officiel.** Pas d'API publique, pas de programme partenaire ou d'affiliation publié. Seul partenariat visible : **Jow** (recettes intégrées à chronodrive.com/recettes, intégration B2B).

**API front privée** (site Nuxt, appels vers `https://api.chronodrive.com`), décodée par plusieurs projets open source :

- En-têtes : `x-api-key` par microservice (clé publique, lisible dans la config Nuxt de la page d'accueil), `x-chronodrive-site-id` (drive, 4 chiffres), `x-chronodrive-site-mode` (`DRIVE` | `HOME_DELIVERY`), `x-device-type: WEB`.
- Endpoints utiles :
  - `GET v1/products?searchTerm=…&size=50` : recherche (prix, prix/kg, stock, bio, origine) ;
  - `GET v1/favourite-products` : favoris (environ 200 références, alimentées par les achats des 6 derniers mois) ;
  - `GET v1/customers/me/carts`, `GET v1/carts/{id}` : panier ;
  - `POST v1/carts/{id}/items` `{"content":[{"productId","quantity","clientOrigin"}],"optimizedMode":true}` : **incrémente** la quantité ;
  - `DELETE v1/carts/{id}/items/{productId}` ;
  - `GET v1/shopping-lists`, `GET v1/customers/me/orders` (environ 6 mois), `GET v1/recipes/{id}` (recettes Jow liées aux produits).
- Authentification : `connect.chronodrive.com`, `POST /identity/v1/password/login` (email + mot de passe), puis `GET /oauth/authorize` (PKCE) et `POST /oauth/token` → Bearer, avec `offline_access` (refresh token). Aucun captcha ni 2FA mentionné par les projets, mais l'un d'eux a choisi un navigateur anti-détection par précaution.
- Anti-bot : site servi par **Cloudflare** (`__cf_bm`, Bot Management ou Bot Fight Mode). Les clients HTTP simples fonctionnent depuis une IP résidentielle selon leurs auteurs (mai et septembre 2026) ; comportement depuis une IP datacenter inconnu.

Projets de référence, **lus comme documentation uniquement, jamais exécutés** :
[y-vex/chronodrive-mcp](https://github.com/y-vex/chronodrive-mcp),
[arvernesmotion/Chronodrivemcp](https://github.com/arvernesmotion/Chronodrivemcp),
[ncleton/chronodrive-mcp](https://github.com/ncleton/chronodrive-mcp) (Camoufox),
[machintrucbidule/cOURSesDrive](https://github.com/machintrucbidule/cOURSesDrive) (userscript),
[machintrucbidule/barclaudegateway](https://github.com/machintrucbidule/barclaudegateway).

## Cadre contractuel et juridique

Analyse documentaire, pas un avis juridique. Source : [CGV Chronodrive](https://www.chronodrive.com/cgv) (mise à jour du 26/06/2024, lue aux deux tiers environ).

- **Art. 3** : le client s'engage à ne pas communiquer ses identifiants à un tiers. Un service tiers qui les stocke côté serveur contrevient directement à cette clause.
- **Art. 19** : interdiction d'extraire ou réutiliser une partie substantielle du site (droit du producteur de bases de données). Ajouter au panier de son propre compte n'en relève pas ; constituer un cache de catalogue côté OMQ s'en approcherait.
- **Art. 17** : l'accès au site peut être coupé à tout moment.
- Pas de clause explicite sur les robots dans la partie lue ; le risque de suspension de compte reste réel en pratique.
- RGPD : stocker les mots de passe de tiers ferait d'OMQ le gardien d'une donnée très sensible (chiffrement, analyse d'impact, notification de fuite).
- Ouverture B2C : ne pas utiliser la marque d'une manière qui laisserait croire à un partenariat.

## Précédents

- **Jow** : partenariats officiels avec 6 à 8 enseignes (dont Chronodrive), panier poussé par intégration négociée, rémunération à la commission.
- **750g « Mes Courses »** : recette vers panier via l'intermédiaire Fly Menu (B2B).
- **Extensions et userscripts** indépendants (cOURSesDrive, Cuisinette, ComPrix) : session de l'onglet du client, sans serveur.
- Aucun lien profond public « ajouter N produits au panier » chez Chronodrive.

## Options étudiées

| Option | Faisabilité | Risque CGV / compte | Identifiants | Verdict |
|---|---|---|---|---|
| Appel HTTP depuis le serveur OMQ (Vercel) | Prouvée ailleurs, Cloudflare incertain sur IP datacenter | Élevé (art. 3) | Stockés chez OMQ | Écartée |
| Appel HTTP depuis un exécuteur chez l'utilisateur | Prouvée | Faible (son compte, son IP) | Chez l'utilisateur | **Retenue** (Hermes sur NAS) |
| Navigateur anti-détection hébergé (Camoufox, Browserbase) | Prouvée, lente et fragile | Le plus élevé (contournement assumé) | Profil stocké côté serveur | Écartée |
| Apify | Aucun acteur Chronodrive, revient à l'option précédente | Idem | Idem | Écartée |
| Userscript / extension | Prouvée (cOURSesDrive) | Faible | Aucun | Écartée : usage mobile |
| Agent « computer use » | Possible, lent et coûteux | Selon hébergement | Selon hébergement | Écartée |
| Liens de recherche par article | Triviale | Nul | Aucun | Écartée : apport trop faible |

Notes :
- **Camoufox** : fork de Firefox modifié pour masquer l'empreinte navigateur, piloté via Playwright ; maintenance incertaine (retrait annoncé du mainteneur principal). **camofox** (`camofox-browser`) : serveur REST au-dessus de Camoufox pour agents.
- **Apify** : plateforme cloud d'« Actors » (conteneurs de scraping/automatisation) facturés au compute unit ; conçue pour l'extraction publique, inadaptée à une action authentifiée et transactionnelle.

## Architecture retenue (ADR-12)

1. `/courses` → « Constituer mon panier Chronodrive » (visible si un exécuteur est enregistré pour le foyer).
2. OMQ crée une `demande_panier` et envoie un **webhook signé HMAC, sans donnée**, vers Hermes via **Tailscale Funnel** (un seul chemin exposé).
3. Hermes lit la demande et la liste (non cochés, articles manuels compris) via le **MCP OMQ**.
4. Pour chaque article : cache local des correspondances, puis favoris, puis recherche ; la cascade LLM de Hermes choisit produit et quantité.
5. Confiance haute → ajout au panier via le **MCP Chronodrive maison**, puis coche immédiate dans OMQ ; sinon, report « à choisir » / « introuvable ».
6. Rapport à OMQ (`rapporter_panier`) et sur Telegram. Validation humaine dans l'appli Chronodrive.

## Incertitudes à lever par le spike (#307)

- Captcha ou 2FA au login ; comportement Cloudflare depuis le NAS.
- **Visibilité dans l'appli mobile** d'un panier rempli via l'API.
- Qualité du mapping (taux de confiance haute) sur une vraie liste.
- Fonctionnement de Tailscale Funnel vers le webhook Hermes (sinon repli cron).
- Durée d'un run complet, qui fixe le délai d'expiration d'une demande (RG-83).

## Résultats du spike

**Verdict : GO** (2026-10-30). Critères fixés dans #307 avant toute mesure ; PoC dans `integrations/chronodrive-mcp/spike/`, mesures détaillées dans `spike/mesures/mapping-2026-10-30.md`.

Conditions du spike : compte Chronodrive **neuf**, créé pour le PoC (aucune commande, un seul favori), drive Toulouse Lalande (`1034`), liste OMQ réelle de 36 articles non cochés (cycle du 30/10 au 05/11), Hermes v0.21.5 dans Docker sur le NAS, cascade LLM `glm-5.3-flash`. Le compte neuf est le pire cas pour le mapping : la recherche fait tout le travail que les favoris d'un vrai compte feraient en premier.

| Critère | Verdict | Mesure |
|---|---|---|
| 1. Login depuis le NAS (bloquant) | ✅ | Password → PKCE → jeton sans captcha, sans 2FA, sans blocage Cloudflare. Jeton valable 7 200 s. **Aucun `refresh_token`** malgré `offline_access` : le client refait le login avec les identifiants de l'exécuteur à l'expiration (vérifié, sans saisie). |
| 2. Panier visible dans l'appli mobile (bloquant) | ✅ | Un produit ajouté deux fois par l'API apparaît dans l'appli avec la quantité 2 (l'ajout **incrémente**, ce qui confirme RG-83). |
| 3. Mapping (seuil ≥ 60 % « haute », 0 faux) | ✅ | Run 1 : 44 % (prompt trop prudent : marque ou format comptés comme ambiguïtés). Run 2, après l'unique ajustement : **30 « haute » sur 36 (83 %)**, 5 à choisir, 1 introuvable, **0 faux** selon l'utilisateur. Préférence relevée : marques nationales plutôt que distributeur. |
| 4. Déclenchement push (non bloquant) | ✅ | Funnel publie un seul chemin vers la plateforme webhook de Hermes (`127.0.0.1:8644`). Depuis Internet : signé 202 et run lancé ; mauvais secret ou sans signature 401 ; racine et chemin voisin 404. |
| 5. Durée d'un run (non bloquant) | ⚠️ | Run complet déclenché par webhook : **12 min 10 s** (27 articles, ajouts compris, sans coche OMQ). Mapping seul sur 36 articles : 15 min 24 s. Un vrai run (36 articles + ajouts + coches) dépasse 15 min. |

**Constats qui changent la spec ou l'implémentation (#308).**

- **Un ajout peut réussir sans renvoyer `SUCCESS`.** Le run complet a reçu `returnType: NO_STOCK_AFTER` pour un produit, le PoC l'a traité en échec et l'a rapporté « à choisir »… alors que le produit était bien dans le panier. Un ajout non rapporté n'est pas coché dans OMQ, et une relance le doublerait. L'exécuteur doit donc **confirmer chaque ajout en relisant le panier** plutôt que se fier au code de retour.
- **Articles « à vérifier au placard » non cochés = à acheter.** L'utilisateur les coche lui-même avant de lancer la demande s'il les a déjà. Le run 1 et le run complet les avaient écartés d'eux-mêmes : le prompt de l'exécuteur doit le dire explicitement.
- **Pas de refresh token** : les identifiants restent nécessaires chez l'exécuteur (déjà le cas, ADR-12) ; un login par run.
- **Signature du webhook** : Hermes vérifie le format **Standard Webhooks** (en-têtes `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 de « id.timestamp.corps »>`), avec fenêtre anti-rejeu et dédoublonnage par `webhook-id`. C'est le format qu'OMQ doit émettre (`spike/envoyer-webhook.mjs`).
- **Funnel sur le port 10000** : sur le NAS, 443 et 8443 sont déjà pris (« address already in use », TLS coupé). L'URL de l'exécuteur porte donc un port ; aucun impact côté OMQ, qui stocke une URL. Premier lancement : certificat Let's Encrypt émis en 35 s environ.
- **Clés de service** : `GET v1/customers/me/carts` attend la clé `CUSTOMERS`, pas `CARTS`. Un 401 « API Key is not valid » signale une mauvaise clé, pas un jeton expiré.
- **Identifiant du drive** : absent de l'URL du site ; il se lit dans `GET v1/sites` (clé `SITES`, sans authentification), champ `id` du drive cherché par `name`.

**Ajustements reportés** : RG-82 (placard explicite, préférence de marque), RG-83 (confirmation par relecture du panier, expiration **30 min**), ADR-12 **accepté** avec les précisions ci-dessus.

### Protocole relevé

Sources lues le 2026-10-30 comme documentation (aucun code exécuté) : `y-vex/chronodrive-mcp` (commit du 2026-05-09), `arvernesmotion/Chronodrivemcp` (2026-09-22), `ncleton/chronodrive-mcp` (2026-10-09). Les trois concordent sur le flux et les en-têtes.

**Constantes publiques.** Lues dans le HTML de `https://www.chronodrive.com` (config Nuxt), jamais recopiées en dur : une clé `x-api-key` par microservice, sous la forme `CHR_API_<SERVICE>_APIKEY` (UUID), et le `CLIENT_ID` OAuth. Services utiles : `CUSTOMERS`, `CARTS`, `PRODUCTS`, `FAVOURITE_PRODUCTS`.

**En-têtes de tout appel API** : `x-chronodrive-site-id` (drive), `x-chronodrive-site-mode` (`DRIVE`, sinon `HOME_DELIVERY` : on garde celui où le compte a un panier), `x-device-type: WEB`, `referer: https://www.chronodrive.com/`, `content-type` et `Accept` en JSON, un `User-Agent` de navigateur de bureau, `Authorization: Bearer …`, `x-api-key` du service appelé.

| Étape | Appel | Corps / paramètres | Réponse utile |
|---|---|---|---|
| Login | `POST connect.chronodrive.com/identity/v1/password/login` | JSON `client_id`, `scope`, `email`, `password` | `tkn` |
| Autorisation | `GET connect.chronodrive.com/oauth/authorize` (en-têtes `Origin`/`Referer` du site) | `client_id`, `response_type=code`, `nonce`, `persistent=true`, `redirect_uri=https://www.chronodrive.com`, `scope`, `response_mode=web_message`, `prompt=none`, `code_challenge` (S256), `tkn` | page HTML contenant `"code":"…"` |
| Jeton | `POST connect.chronodrive.com/oauth/token` | JSON `client_id`, `grant_type=authorization_code`, `code_verifier`, `code`, `redirect_uri` | `access_token` (+ `refresh_token` attendu avec `offline_access`) |
| Client | `GET api.chronodrive.com/v1/customers/me` (clé `CUSTOMERS`) | | `id` |
| Panier courant | `GET v1/customers/me/carts` (clé `CUSTOMERS`, la clé `CARTS` y est refusée) | | `content[0].id` |
| Lire le panier | `GET v1/carts/{id}` (clé `CARTS`) | | `items[].product`, `items[].quantity` |
| Ajouter | `POST v1/carts/{id}/items` (clé `CARTS`) | `{"content":[{"clientOrigin":"WEB|SEARCH|TG|/promotions","productId","quantity"}],"optimizedMode":true}` | `content[0].returnType == "SUCCESS"` |
| Retirer | `DELETE v1/carts/{id}/items/{productId}` (clé `CARTS`) | | 2xx |
| Favoris | `GET v1/favourite-products` (clé `FAVOURITE_PRODUCTS`) | `page` (à partir de 1), `size=50` | `content[]`, `page.hasNext` |
| Recherche | `GET v1/products` (clé `PRODUCTS`, en-têtes `X-Kamino-User-Consent: true`, `X-Kamino-User-Id: <id client>`) | `searchTerm`, `page=1`, `size`, `withKamino=true`, `kaminoMode=ADVANCED` | `content[]` |

`scope` = `openid profile email phone full_write offline_access`.

**Fiche produit** (même forme en recherche, favoris et panier) : `id`, `labels.productLabel`, `labels.brandLabel`, `labels.unitQuantityLabel` (contenance), `prices.defaultPrice`, `prices.pricePerUnitMeasure`, `flags.isOrganic`, et pour la disponibilité `stock`, `remainingStock`, `isEligible`, `maxCartQuantity`.

**Inconnues.** Aucun des trois projets n'utilise le `refresh_token` : ils refont le login complet sur un 401. Le grant `refresh_token` reste à vérifier (Task 2). Aucun ne mentionne de captcha ni de 2FA ; `ncleton` passe par Camoufox par précaution, sans échec documenté en HTTP simple.
