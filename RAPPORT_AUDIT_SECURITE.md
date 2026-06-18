# Rapport d'audit de sécurité — Webapp « On mange quoi ? »

| | |
|---|---|
| **Cible** | webapp-repas — https://webapp-repas.vercel.app |
| **Type d'audit** | White box (accès code source + IHM + compte de test) |
| **Stack** | Next.js 16.2.9 (App Router) · Supabase (Postgres + Auth + Realtime) · Vercel · Tailwind v4 |
| **Date** | 2026-06-18 |
| **Auditeur** | Revue de sécurité applicative |
| **Version auditée** | `main` @ `64f9681` |

---

## 1. Synthèse exécutive

L'application présente une **posture de sécurité globalement solide et mature**, nettement au-dessus de la moyenne pour un projet de cette taille. Le modèle d'autorisation repose entièrement sur le **Row Level Security (RLS) de Postgres**, appliqué de façon cohérente sur toutes les tables, avec des fonctions `SECURITY DEFINER` correctement durcies (`search_path` figé, dérivation du foyer côté serveur, écritures atomiques). La gestion des secrets, des sessions et des flux d'authentification est conforme aux bonnes pratiques.

**Aucune vulnérabilité critique ou élevée n'a été identifiée.** Les constats relèvent du durcissement défensif (defense-in-depth) : absence d'en-têtes de sécurité HTTP, politique de mot de passe minimale, et quelques écarts d'intégrité de données à faible impact.

### Tableau récapitulatif des constats

| # | Constat | Sévérité | Statut |
|---|---------|----------|--------|
| F-01 | Absence d'en-têtes de sécurité HTTP (CSP, X-Frame-Options, etc.) | **Moyenne** | Ouvert |
| F-02 | Politique de mot de passe faible (min. 6, sans contrôle de robustesse) | **Moyenne** | Ouvert |
| F-03 | `user_id` d'une recette falsifiable à l'insertion (RLS ne contrôle que `foyer_id`) | **Faible** | Ouvert |
| F-04 | Absence de rate-limiting applicatif sur `/api/planning/generer` | **Faible** | Ouvert |
| F-05 | Énumération de comptes via la page d'inscription | **Faible** | Ouvert |
| F-06 | Table `ingredient` : lecture publique (anon) + insertion non scopée, sans nettoyage | **Faible** | Ouvert |
| F-07 | `Access-Control-Allow-Origin: *` sur les documents servis | **Informationnel** | Ouvert |
| F-08 | Stack traces minifiées en production (pas d'upload de source maps) | **Informationnel** | Accepté |

---

## 2. Périmètre et méthodologie

### Périmètre couvert
- **Modèle d'autorisation** : 22 migrations SQL, politiques RLS, fonctions `SECURITY DEFINER`, RPC.
- **Authentification** : inscription, connexion, déconnexion, mot de passe oublié, changement de mot de passe, garde de session (proxy).
- **Surface serveur** : route API `POST /api/planning/generer`, clients Supabase serveur/navigateur.
- **Surface client** : CRUD recettes/réglages, onboarding foyer, temps réel (Realtime).
- **Gestion des secrets** : variables d'environnement, fichiers versionnés, workflows CI.
- **Configuration de déploiement** : en-têtes HTTP en production, `next.config.ts`.

### Méthodologie
Revue manuelle du code source (lecture exhaustive des couches sensibles), analyse statique des politiques RLS et des fonctions Postgres, sondage des en-têtes HTTP et du comportement du proxy sur l'instance de production.

### Hors périmètre / limitations
- Pas d'accès à la console Supabase (configuration Auth : rate-limits GoTrue, allowlist de redirection, templates email — supposés aux valeurs par défaut).
- Pas d'audit du tier d'infrastructure Vercel/Supabase lui-même.
- Pas de test de charge / DoS réel sur la production.

### Échelle de sévérité
**Critique** : compromission directe (RCE, fuite massive de données, contournement d'auth). **Élevée** : accès non autorisé aux données d'autrui, élévation de privilège. **Moyenne** : défense-en-profondeur manquante exploitable sous conditions. **Faible** : impact limité ou difficilement exploitable. **Informationnel** : bonne pratique / observation.

---

## 3. Constats détaillés

### F-01 — Absence d'en-têtes de sécurité HTTP · Moyenne

**Description.** Les réponses HTTP de production ne contiennent aucun en-tête de sécurité applicatif au-delà de `Strict-Transport-Security` (ajouté par défaut par Vercel). `next.config.ts` ne définit pas de fonction `headers()`.

**Preuve.**
```
$ curl -sS -D - -o /dev/null https://webapp-repas.vercel.app/
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Access-Control-Allow-Origin: *
...
# Absents : Content-Security-Policy, X-Frame-Options / frame-ancestors,
#           X-Content-Type-Options, Referrer-Policy, Permissions-Policy
```
`next.config.ts:4-10` — aucune clé `headers`.

**Impact.**
- **Clickjacking** : sans `X-Frame-Options: DENY` ni `frame-ancestors 'none'`, l'application peut être encadrée dans une iframe tierce (détournement de clics sur les actions sensibles : quitter le foyer, supprimer des recettes, changer le mot de passe).
- **Pas de CSP** : aucune défense-en-profondeur contre une éventuelle injection de script (XSS). Le risque XSS résiduel est faible (React échappe par défaut, `react-markdown` est utilisé **sans** `rehype-raw`, le seul `dangerouslySetInnerHTML` injecte une chaîne statique sans donnée utilisateur — `app/layout.tsx:88`), mais une CSP reste la dernière ligne de défense.
- **MIME-sniffing** : sans `X-Content-Type-Options: nosniff`, risque de confusion de type de contenu.
- **Fuite de référent** : sans `Referrer-Policy`, les URL (potentiellement porteuses d'un `?code=` d'invitation) peuvent fuiter vers des tiers via l'en-tête `Referer`.

**Recommandation.** Ajouter un bloc `headers()` dans `next.config.ts` :
```ts
async headers() {
  return [{
    source: "/:path*",
    headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value:
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://*.vercel-insights.com; " + // 'unsafe-inline' requis par le script anti-FOUC ; envisager un nonce
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://*.sentry.io; " +
        "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
    ],
  }]
}
```
À calibrer (le `script-src 'unsafe-inline'` est imposé par le script de thème inline et par Next ; idéalement migrer vers un nonce). Tester en mode `Content-Security-Policy-Report-Only` avant application stricte.

---

### F-02 — Politique de mot de passe faible · Moyenne

**Description.** La longueur minimale du mot de passe est de **6 caractères**, sans exigence de complexité ni vérification contre une base de mots de passe compromis.

**Preuve.**
- `app/signup/page.tsx:23` → `minLengthPassword={6}`
- `app/auth/reinitialiser/page.tsx:18` → `const LONGUEUR_MIN = 6;`
- `components/profil/changer-mot-de-passe.tsx:17` → `const LONGUEUR_MIN = 6;`
- `lib/messages-auth.ts:29` → message « Mot de passe trop court : au moins 6 caractères. »

**Impact.** Des mots de passe de 6 caractères sont vulnérables au bruteforce hors-ligne (en cas de fuite) et au credential stuffing. Combiné à l'absence de rate-limiting applicatif (cf. F-04), cela augmente la surface d'attaque par devinette en ligne. Le compte de test possède un mot de passe robuste, mais rien n'oblige les utilisateurs réels à faire de même.

**Recommandation.**
1. Porter le minimum à **au moins 8-10 caractères** (côté formulaire **et** dans la configuration Supabase Auth, qui est l'autorité réelle).
2. Activer dans la console Supabase la **vérification HaveIBeenPwned** (« Leaked password protection ») et une exigence de complexité.
3. Aligner les trois constantes sur une source unique partagée.

---

### F-03 — `user_id` d'une recette falsifiable à l'insertion · Faible

**Description.** Depuis la bascule vers le scope foyer (#56 PR2), la politique RLS d'insertion sur `recette` ne valide **que** le `foyer_id` ; l'ancienne contrainte `auth.uid() = user_id` a été supprimée et n'a pas été remplacée par un équivalent.

**Preuve.**
`supabase/migrations/20260611150000_foyer_scoping.sql:48-59` :
```sql
drop policy if exists "recette: insertion propriétaire" on recette;
...
create policy "recette: insertion foyer"
  on recette for insert
  with check (foyer_id = mon_foyer());   -- user_id n'est PAS contraint
```
Côté client, `creerRecette` (`lib/recettes.ts:202-211`) pose `user_id: user.id` de bonne foi, mais un client malveillant peut envoyer une requête PostgREST directe avec un `user_id` arbitraire : tant que `foyer_id = mon_foyer()`, l'insertion est acceptée.

**Impact.** **Limité.** La frontière de sécurité réelle est `foyer_id` (qui, lui, est correctement contraint et défaute à `mon_foyer()`). La colonne `user_id` sur `recette` n'est plus qu'une métadonnée d'« auteur ». Un attaquant ne peut écrire que **dans son propre foyer** ; il peut seulement falsifier l'attribution d'authorship (p. ex. attribuer une recette à un autre membre ou à un UUID arbitraire). Pas de franchissement de tenant, pas de fuite de données. C'est un défaut d'**intégrité**, pas de confidentialité.

**Recommandation.** Ajouter la contrainte d'authorship dans le `with check`, ou un GRANT au niveau colonne similaire à celui déjà mis en place pour `profiles` (cf. `20260612140000_profil_colonnes.sql:57-59`, excellente parade) :
```sql
create policy "recette: insertion foyer"
  on recette for insert
  with check (foyer_id = mon_foyer() and (user_id is null or user_id = auth.uid()));
```

---

### F-04 — Absence de rate-limiting applicatif sur la génération · Faible

**Description.** La route `POST /api/planning/generer` n'impose aucune limite de débit applicative. Chaque appel déclenche une lecture de toutes les recettes du foyer + l'algorithme de génération.

**Preuve.** `app/api/planning/generer/route.ts:19-150` — vérifie l'authentification (`getUser`, ligne 23) et la plage de semaine (lignes 42-56, **bien validée côté serveur**), mais aucun throttling.

**Impact.** Faible. Un utilisateur authentifié peut marteler l'endpoint (consommation CPU/DB, coûts Vercel/Supabase). La portée se limite aux données de son propre foyer ; pas d'amplification cross-tenant. GoTrue (Supabase) limite déjà les endpoints d'authentification eux-mêmes.

**Recommandation.** Ajouter une limite de débit légère (p. ex. via `@upstash/ratelimit` + Vercel KV, ou un compteur en mémoire best-effort) sur les routes API mutantes. Priorité basse pour un usage personnel/familial.

---

### F-05 — Énumération de comptes via l'inscription · Faible

**Description.** La page de mot de passe oublié est exemplaire (message identique que le compte existe ou non — `app/mot-de-passe-oublie/page.tsx:6-9, 55-57`). En revanche, l'**inscription** renvoie un message distinctif lorsque l'email existe déjà.

**Preuve.** `lib/messages-auth.ts:26-28` :
```
user_already_exists / email_exists →
  "Un compte existe déjà avec cet email. Connecte-toi plutôt."
```

**Impact.** Faible. Un attaquant peut déterminer si une adresse donnée possède un compte (atteinte à la vie privée, utile pour du ciblage/phishing). C'est un comportement par défaut de Supabase GoTrue et un compromis UX courant.

**Recommandation.** Compromis acceptable pour beaucoup d'applications. Pour durcir : activer la confirmation email obligatoire en production (cf. note ci-dessous) et neutraliser le message différencié, en affichant un message générique « vérifie ta boîte mail » dans les deux cas.

> **Note connexe (configuration) :** le code et la doc indiquent que **la confirmation email est désactivée** (`e2e/auth.setup.ts:4-6`, ADR-02). C'est volontaire en dev et nécessaire au setup e2e, **mais doit impérativement être réactivé en production** : sans confirmation, n'importe qui peut créer des comptes avec des emails arbitraires (y compris ceux d'autrui). À traiter au moment de la mise en production publique.

---

### F-06 — Table `ingredient` : lecture publique et insertion non scopée · Faible

**Description.** La table `ingredient` est un catalogue partagé global : lecture autorisée à tous (`using (true)`), insertion à tout utilisateur authentifié, **sans** politique `UPDATE`/`DELETE` ni scoping par foyer.

**Preuve.** `supabase/migrations/20260606225900_init.sql:135-142` :
```sql
create policy "ingredient: lecture publique" on ingredient for select using (true);
create policy "ingredient: insertion authentifiée" on ingredient for insert
  with check (auth.uid() is not null);
```
`lib/recettes.ts:134-168` (`trouverOuCreerIngredient`) crée des ingrédients à la volée.

**Impact.** Faible.
- `using (true)` rend le catalogue d'ingrédients lisible par le rôle `anon` (avant authentification). Contenu non sensible (noms d'aliments) → fuite négligeable.
- Tout utilisateur peut **gonfler indéfiniment** le catalogue partagé (pas de déduplication SQL forte, pas de purge possible faute de policy DELETE). Vecteur de pollution / abus de stockage, voire injection de noms offensants visibles par d'autres foyers s'ils saisissent le même ingrédient.

**Recommandation.** Restreindre la lecture aux utilisateurs authentifiés (`using (auth.uid() is not null)`), borner la longueur des noms (CHECK), et envisager à terme un scoping par foyer ou une table de référence en lecture seule alimentée par migration. Priorité basse.

---

### F-07 — `Access-Control-Allow-Origin: *` sur les documents servis · Informationnel

**Description.** Les réponses de Vercel portent `Access-Control-Allow-Origin: *` (comportement par défaut de Vercel sur les ressources préendues).

**Preuve.** En-tête observé sur `GET /`.

**Impact.** Négligeable dans le contexte actuel : les ressources concernées sont des documents publics, et l'API sensible (Supabase) vit sur une autre origine avec sa propre politique CORS et son authentification par JWT. Aucune donnée authentifiée n'est exposée en cross-origin via ce wildcard.

**Recommandation.** Pas d'action requise. À surveiller si des routes API renvoyant des données sensibles étaient ajoutées sous le même domaine.

---

### F-08 — Stack traces minifiées en production · Informationnel (accepté)

**Description.** Sentry est configuré sans upload de source maps (`next.config.ts:13-15`, pas de `SENTRY_AUTH_TOKEN`) et sans tracing ni session replay.

**Impact.** Aucun risque de sécurité ; c'est même un **point positif côté vie privée** (pas de capture de session). Mentionné pour mémoire : les stack traces en production sont minifiées (le digest Next reste la référence de corrélation).

**Recommandation.** Choix assumé et raisonnable pour un usage personnel. RAS.

---

## 4. Points forts observés

L'audit relève un niveau de rigueur remarquable. À conserver :

1. **Modèle RLS exhaustif et cohérent.** Toutes les tables métier ont RLS activé, avec un helper central `mon_foyer()` (`SECURITY DEFINER`, `search_path` figé, `stable`) évitant la récursion de policy et la duplication de logique (`20260611140000_foyers_profiles.sql:53-61`).
2. **Fonctions `SECURITY DEFINER` durcies.** `search_path = public` figé systématiquement ; la leçon pgcrypto (extension dans le schéma `extensions`) a été correctement tirée et documentée (`20260611170000_corriger_search_path_code_invitation.sql`, et `set search_path = public, extensions` dans `quitter_foyer`).
3. **GRANT au niveau colonne sur `profiles`** pour empêcher un client de réécrire son `foyer_id` et de rejoindre un foyer arbitraire en contournant la validation de code — une parade fine et bien raisonnée (`20260612140000_profil_colonnes.sql:40-59`). *(À répliquer sur `recette.user_id`, cf. F-03.)*
4. **Écritures planning/coches atomiques via RPC** (`sauvegarder_planning`), le foyer étant **dérivé du serveur** (`mon_foyer()`), jamais fourni par le client → pas de spoofing de tenant (`20260611150000_foyer_scoping.sql:232-298`).
5. **Codes d'invitation robustes** : 8 caractères sur alphabet de 32 (≈ 1,1×10¹² combinaisons), génération cryptographique (`gen_random_bytes`, jamais `random()`), expiration 7 jours, génération paresseuse (surface de bruteforce minimale), non énumérables (pas de lecture par code hors RPC) (`20260611140000_foyers_profiles.sql:75-115`).
6. **Validation serveur des entrées** : la plage de semaines est revalidée côté serveur, « le client n'en est pas l'autorité » (`app/api/planning/generer/route.ts:42-56`) ; contraintes `CHECK` en base comme défense-en-profondeur (`20260608160000_reglages_utilisateur.sql:18-26`).
7. **Authentification correcte** : usage de `getUser()` (qui valide le JWT auprès de Supabase) et non `getSession()` dans le proxy ; navigation pleine page post-login pour éviter un cache de session périmé (`components/auth/formulaire-auth.tsx:13-16`).
8. **Ré-authentification avant changement de mot de passe** (`signInWithPassword` préalable à `updateUser`) — empêche une session volée de changer le mot de passe sans connaître l'actuel (`components/profil/changer-mot-de-passe.tsx:7-9, 50-63`).
9. **Anti-énumération sur le reset de mot de passe** (message identique quel que soit l'état du compte).
10. **Gestion des secrets impeccable** : aucune clé `service_role` côté client/serveur applicatif ; `.env.local` et variantes correctement ignorés par Git (seul `.env.example` versionné, sans valeurs) ; secrets CI dans les coffres GitHub Actions/Dependabot. Le seul `dangerouslySetInnerHTML` injecte une chaîne statique sans entrée utilisateur.
11. **Proxy robuste** : `fail-open` maîtrisé en cas d'indisponibilité de Supabase (dégradation en « non connecté » plutôt que 500 généralisé), pas d'open-redirect (`urlPreservantCode` ne propage qu'un paramètre `code` vers des chemins internes fixes) (`proxy.ts:13-20, 56-62`).
12. **Realtime soumis à la RLS** : l'autorisation des events `postgres_changes` est évaluée avec le JWT de l'abonné, scopée par foyer.

---

## 5. Plan d'action priorisé

| Priorité | Action | Constat | Effort |
|----------|--------|---------|--------|
| 1 | Ajouter les en-têtes de sécurité HTTP (au minimum `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, puis CSP en report-only) | F-01 | Faible |
| 2 | Renforcer la politique de mot de passe (min ≥ 8 + protection « leaked passwords » Supabase) | F-02 | Faible |
| 3 | **Avant mise en production publique** : réactiver la confirmation email Supabase | F-05 (note) | Faible |
| 4 | Contraindre `recette.user_id` à l'insertion (policy ou GRANT colonne) | F-03 | Faible |
| 5 | Restreindre la lecture de `ingredient` aux authentifiés + borner les noms | F-06 | Faible |
| 6 | Ajouter un rate-limiting léger sur les routes API mutantes | F-04 | Moyen |

---

## 6. Conclusion

La webapp « On mange quoi ? » témoigne d'une **conception sécuritaire mûre et délibérée**, particulièrement sur le pilier le plus critique d'une application Supabase : le modèle d'autorisation RLS, ici cohérent, centralisé et résistant aux contournements clients courants. Les fonctions privilégiées sont durcies, les secrets bien gérés, les flux d'authentification conformes.

Les constats restants sont des **améliorations de durcissement défensif**, sans vulnérabilité exploitable à fort impact. Le traitement prioritaire des en-têtes HTTP (F-01) et de la politique de mot de passe (F-02), ainsi que la réactivation de la confirmation email avant toute ouverture publique, porteraient l'application à un excellent niveau de sécurité.

---

*Rapport généré dans le cadre d'un test white box autorisé par le propriétaire du code et de l'infrastructure. Les références `fichier:ligne` pointent vers la révision `main` auditée.*
