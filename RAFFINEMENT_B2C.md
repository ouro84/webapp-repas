# Raffinement backlog — Passage perso → B2C public

> Date : 2026-06-22
> Statut : **En cours de raffinement** (session backlog, crédit CI épuisé jusqu'au 1er juillet)
> Objectif : 1000 utilisateurs / mois d'ici ~3 mois, à partir d'une app aujourd'hui conçue pour un usage perso/foyer.
> Cadrage validé :
> - **Posture** : public mais **progressif** (conformité + infra d'abord, puis acquisition/rétention).
> - **Monétisation** : **freemium plus tard** → on prépare les *fondations* (compteur d'usage, point de quota) sans coder le paiement.
> - **Périmètre de cette session** : Lot 0 (dettes ouvertes) → Lot 1/2 (Palier A conformité) → Lot 4/5/6 (Palier C produit). Le **Palier B (scalabilité technique)** est cartographié en §8 mais raffiné dans une session ultérieure.

Ce document est la source de vérité du raffinement. Une fois validé, chaque US devient une issue GitHub (sans consommer de crédit Actions) et alimente `SPECS_FONCTIONNELLES.md` / `ADR.md` au moment du dev.

---

## 0. Séquencement recommandé (« public mais progressif »)

| Lot | Thème | Bloque l'ouverture ? | Effort cumulé |
|-----|-------|----------------------|---------------|
| **Lot 0** | Solder les dettes ouvertes (QA/sécu) | Non, mais hygiène pré-lancement | S |
| **Lot 1** | Conformité RGPD & cycle de vie du compte | **OUI — bloqueur dur** | M-L |
| **Lot 2** | Email transactionnel & vérification | **OUI — bloqueur dur** | M |
| **Lot 3** | Hébergement & résilience prod | **OUI — bloqueur dur** (ops, peu de code) | S (décisions) |
| **Lot 4** | Mesure produit & support in-app | Non, mais indispensable pour piloter le lancement | M |
| **Lot 5** | Rétention (emails cycle de vie, relance, push) | Non | M-L |
| **Lot 6** | Acquisition (landing publique + SEO) | Non | M |
| **Transverse** | Fondations freemium (compteur d'usage, point de quota) | Non | S |

**Ligne de départ minimale pour ouvrir au public = Lot 0 + Lot 1 + Lot 2 + Lot 3.** Lots 4→6 se déroulent pendant la montée en charge.

Numérotation : cette épopée B2C occupe la **plage réservée US-25 à US-44** (à la suite de US-24, dernière US des specs avant le B2C). Les règles métier B2C utilisent **RG-40 à RG-42**.

> ⚠️ **Réservation (résolu 2026-06-24).** US-25→44 est **exclusivement** B2C — ne pas la réutiliser pour des features produit hors B2C. Les **features produit non-B2C** reprennent à **US-45+** (déjà attribuées : US-45 variété #218, US-46 étapes #233, US-47 article manuel #216, US-48 créneau désactivable #217, US-49 favoris #219 ; prochaine = US-50). Côté RG, le produit a pris RG-43 (#233) et RG-49→52 (#218) ; les RG B2C restent en 40-42. Une collision passée (issues #216-219 avaient repris US-25→28, déjà utilisées ici par le Lot 0) a été corrigée dans SPECS et sur GitHub.

---

## Lot 0 — Solder les dettes ouvertes

Petites dettes déjà tracées, à fermer avant d'empiler du neuf. Haute confiance, faible effort.

### US-25 — Politique de mot de passe robuste (#189, F-02)

> **En tant que** plateforme accueillant des comptes publics, je veux des mots de passe robustes et non compromis, afin de limiter le bruteforce et le credential stuffing.

**Comportement :**
> **Given** je crée un compte ou réinitialise mon mot de passe
> **When** je saisis un mot de passe de moins de **8** caractères
> **Then** la validation échoue avec un message clair (côté formulaire **et** côté Supabase, autorité réelle)

> **Given** je saisis un mot de passe figurant dans une fuite connue (HaveIBeenPwned)
> **When** je valide
> **Then** Supabase le refuse (« leaked password protection » activée), message actionnable côté UI

**Notes d'implémentation :**
- Unifier les 3 constantes éparpillées sur **une source unique** : `app/signup/page.tsx:23`, `app/auth/reinitialiser/page.tsx:18`, `components/profil/changer-mot-de-passe.tsx:17` → exporter `LONGUEUR_MIN_MDP = 8` depuis un module partagé (ex. `lib/auth-regles.ts`).
- Activer côté **console Supabase** : longueur min ≥ 8, complexité, et **Leaked password protection** (Auth → Policies). C'est l'autorité réelle — le front n'est qu'un garde-fou UX.
- Ajouter un mapping d'erreur dans `lib/messages-auth.ts` pour le code « weak/leaked password » → message FR actionnable.

**Critères d'acceptation :**
- [ ] Minimum ≥ 8 dans les 3 emplacements + config Supabase
- [ ] « Leaked passwords » activée côté Supabase (dev + prod)
- [ ] Constante unique partagée
- [ ] Message FR pour mot de passe refusé (faible/fuité)

**Tests :** unit (validation longueur sur la constante partagée) ; e2e signup avec mdp court → erreur visible.
**Effort :** S · **Dépend de :** rien · **Bloque :** ouverture publique (couple avec Lot 2).

---

### US-26 — Robustesse du stockage local & visibilité de la synchro (#170)

> **En tant qu'** utilisateur en navigation privée stricte (Safari ITP) ou quota plein, je veux que l'app ne casse pas, et savoir quand la synchro temps réel est interrompue.

**Comportement :**
> **Given** `localStorage.setItem` lève (quota plein / navigation privée)
> **When** une écriture de store a lieu (`sauvegarderPlanningComplet`, coches…)
> **Then** l'app dégrade gracieusement (l'état reste en mémoire, aucune exception non gérée) et un message discret signale que la persistance locale est indisponible

> **Given** le canal WebSocket Realtime tombe
> **When** je consulte la liste de courses / le planning
> **Then** l'indicateur de synchro reflète l'état « déconnecté / reconnexion… » au lieu d'afficher faussement « synchronisé » (RG-32)

**Notes d'implémentation :**
- `lib/stockage.ts` : envelopper les `setItem`/`getItem` dans try/catch (le script anti-FOUC de `app/layout.tsx` est déjà protégé — incohérence à corriger). Conserver une copie mémoire si le disque refuse.
- `lib/sync.ts` : exploiter les events de statut du canal Supabase (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`) → exposer un état via un store `useSyncExternalStore` ; reconnexion avec backoff. Surfacer dans un petit indicateur (réutiliser/poser près de la présence « en magasin » sur `/courses`).
- **Lien B2C** : à 1000 users avec du mobile en magasin (réseau instable), un faux « synchronisé » fait acheter en double — la visibilité de déco devient un vrai besoin produit, plus juste une dette.

**Critères d'acceptation :**
- [ ] Écritures `localStorage` tolérantes à l'échec (try/catch + dégradation)
- [ ] État de connexion Realtime exposé et reflété dans l'UI
- [ ] Tentative de reconnexion automatique

**Tests :** unit (store de statut, stockage qui throw → pas de crash) ; e2e difficile pour la déco WS (documenter en manuel).
**Effort :** M · **Dépend de :** rien.

---

### US-27 — Couverture e2e des dégradations & de l'état erreur (#168)

> **En tant que** mainteneur, je veux que les avertissements de dégradation (végé/légumes/saison) et l'état erreur du générateur soient couverts en e2e, afin qu'une régression UI ne passe pas inaperçue.

**Comportement (test) :**
> **Given** un vivier qui ne peut honorer une préférence (végé/légumes/saison)
> **When** je génère
> **Then** le toast/bandeau « N repas non honorés / hors-saison » est **visible** (RG-26/27/28)

> **Given** un vivier insuffisant pour 14 slots (RG-09)
> **When** je génère
> **Then** l'écran d'erreur + bouton « Réessayer » s'affiche

**Notes d'implémentation :**
- Specs e2e CI-only (génération réelle, cf. convention). Construire l'état de vivier via un compte jetable avec masquages/réglages forçant la dégradation, ou un compte dédié seedé.
- Réutiliser les helpers de nettoyage existants.

**Critères d'acceptation :** les deux scénarios e2e existent et passent en CI.
**Effort :** S-M · **Dépend de :** crédit CI (à faire dès le 1er juillet).

---

### US-28 — Clore les constats informationnels (#194, #195, #185)

> Décisions de traçabilité, pas de code (sauf #195 réévalué pour le B2C).

- **#194 (F-07, ACAO `*`)** : confirmer « sans action » et clore. Re-vérifier si une route API renvoyant des données sensibles est ajoutée sous le même domaine.
- **#195 (F-08, source maps Sentry)** : **à réévaluer pour le B2C**. En usage perso, stack traces minifiées = acceptable. À 1000 users, déboguer la prod sans source maps coûte cher. → Décision : poser `SENTRY_AUTH_TOKEN` (upload des source maps, **`hidden-source-maps`** pour ne pas les exposer publiquement) **avant** l'ouverture. Reclasser en `enhancement` plutôt que `wontfix`.
- **#185 (« audit sécurité »)** : issue épopée vide → soit la documenter comme parente des F-01→F-08, soit la clore.

**Critères d'acceptation :** chaque issue a une décision écrite ; #195 tranchée (recommandation : upload `hidden-source-maps` au lancement).
**Effort :** S · **Dépend de :** rien.

---

## Lot 1 — Conformité RGPD & cycle de vie du compte (BLOQUEUR DUR)

> **C'est le bloqueur n°1 du lancement public.** App française collectant emails + données personnelles (recettes, plannings, foyers), aujourd'hui **sans aucune page légale ni mécanisme RGPD** (vérifié : rien dans `app/`, `content/` ; aucun code de suppression de compte). Sans ce lot, ouvrir au public est illégal.

### EPIC #B2C-1 — Conformité & droits des personnes

Couvre : information (CGU, confidentialité, mentions légales, cookies), droit à l'effacement (art. 17), droit à la portabilité (art. 20), base légale & registre.

---

### US-29 — Pages légales (CGU, confidentialité, mentions légales)

> **En tant que** visiteur, je veux accéder aux conditions d'utilisation, à la politique de confidentialité et aux mentions légales, afin de savoir comment mes données sont traitées avant de m'inscrire.

**Comportement :**
> **Given** je suis sur l'app (connecté ou non)
> **When** je consulte le pied de page / la page d'inscription
> **Then** des liens mènent vers `/legal/cgu`, `/legal/confidentialite`, `/legal/mentions-legales` (pages **publiques**, hors `protectedRoutes`)

> **Given** je m'inscris
> **When** je valide le formulaire
> **Then** je dois **accepter explicitement** les CGU + politique de confidentialité (case à cocher non pré-cochée), acceptation **horodatée** et stockée (`profiles.cgu_acceptees_le`, version des CGU)

**Notes d'implémentation :**
- Pages SSG sous `app/legal/*`. Contenu rédigé en Markdown (réutiliser le pipeline `react-markdown` de `/aide`, ou pages statiques simples). **Source du contenu = juridique humain**, pas généré : prévoir un placeholder + relecture (DPO/avocat ou modèle CNIL).
- Ajouter les routes à la liste **publique** du `proxy.ts` (comme `/aide`).
- La politique de confidentialité doit lister : responsable de traitement, données collectées (email, prénom, recettes, plannings, foyer, cookies/auth), finalités, base légale, durée de conservation (cf. rétention 12 semaines + comptes), sous-traitants (**Supabase/AWS, Vercel, Upstash, Sentry, Resend, PostHog**), droits et contact, transferts hors UE le cas échéant (PostHog : choisir l'instance **EU** ; Resend : vérifier la région).
- Versionner les CGU (champ `version`) pour re-consentement si modif majeure.

**Critères d'acceptation :**
- [ ] 3 pages légales publiques accessibles sans connexion
- [ ] Acceptation explicite + horodatée au signup (colonne `profiles`)
- [ ] Liens présents dans le pied de page et le signup
- [ ] Liste des sous-traitants alignée sur les vendors réellement utilisés

**Nouvelle RG-40 — Consentement & information** : tout compte créé doit avoir accepté une version des CGU/confidentialité (horodatée). Une révision majeure des CGU déclenche un re-consentement à la prochaine connexion.

**Effort :** M (dont rédaction juridique externe) · **Dépend de :** liste finale des vendors (dépend Lot 2/4).

---

### US-30 — Bandeau cookies / consentement analytics

> **En tant que** visiteur européen, je veux contrôler les traceurs non essentiels, afin que mon consentement soit recueilli conformément à la CNIL/RGPD.

**Comportement :**
> **Given** ma première visite
> **When** la page charge
> **Then** un bandeau distingue les cookies **strictement nécessaires** (auth/session — pas de consentement requis) des traceurs **de mesure d'audience** (consentement requis), avec accepter / refuser / personnaliser au même niveau

> **Given** j'ai refusé la mesure d'audience
> **When** je navigue
> **Then** aucun traceur analytics non exempté n'est chargé

**Notes d'implémentation :**
- **Décision figée** : l'analytics produit est **PostHog (US-37)**, qui dépose des identifiants → **consentement requis** : le bandeau est **obligatoire** et PostHog ne s'initialise/ne capture **qu'après opt-in** (`opt_out_capturing_by_default` jusqu'au consentement).
- `@vercel/analytics` / `@vercel/speed-insights` (déjà présents) : Vercel Analytics est cookieless/agrégé, a priori exemptable — à confirmer ; les classer en « mesure essentielle/agrégée » distincte de PostHog dans le bandeau.
- Refus aussi simple qu'accepter ; stocker le choix (localStorage + éventuellement `profiles`), respecter `Do Not Track`, choix révocable depuis la confidentialité/profil.

**Critères d'acceptation :**
- [ ] Bandeau conforme (refus aussi simple qu'accepter)
- [ ] Traceurs non essentiels chargés uniquement après consentement
- [ ] Choix mémorisé et révocable (lien dans confidentialité/profil)

**Effort :** S-M · **Dépend de :** US-37 (choix de l'outil analytics).

---

### US-31 — Suppression de compte (droit à l'effacement, art. 17)

> **En tant qu'** utilisateur, je veux supprimer définitivement mon compte et mes données, afin d'exercer mon droit à l'effacement.

**Comportement :**
> **Given** je suis dans la section « Sécurité / Compte » de `/profil`
> **When** je demande la suppression et confirme (ré-authentification + confirmation explicite type « tape SUPPRIMER »)
> **Then** mon compte auth et **toutes mes données** sont supprimés ; je suis déconnecté et redirigé vers une page de confirmation publique

> **Given** je suis **seul** dans mon foyer
> **When** je supprime mon compte
> **Then** foyer + recettes du foyer + plannings + coches + masquages + réglages + profil sont purgés (le catalogue **global** `foyer_id IS NULL` n'est jamais touché)

> **Given** je suis dans un foyer **partagé**
> **When** je supprime mon compte
> **Then** je suis retiré du foyer, les recettes que j'y avais créées y **restent** (réattribuées sans créateur), les autres membres **conservent tout** — **aucune donnée d'un autre membre n'est supprimée**

> ⚠️ **PIÈGE DE CONCEPTION (vérifié sur le schéma) — `recette.user_id ... ON DELETE CASCADE`.** Dans un foyer partagé, les recettes créées par moi portent `user_id = moi` **même si elles vivent dans le foyer partagé**. Si on supprime naïvement l'utilisateur auth (`admin.deleteUser`), le `ON DELETE CASCADE` de `recette.user_id` **supprime ces recettes du foyer partagé** → violation de la pérennité (les autres membres les perdent). L'approche « quitter_foyer (clone) puis delete » **ne corrige PAS** ce point : le clone copie, mais les **originaux** dans le foyer partagé gardent `user_id = moi` et tombent quand même au cascade. **Seule parade** : avant la suppression auth, **réattribuer `user_id = NULL`** sur mes recettes restées dans le foyer partagé (NULL est valide — c'est l'état des recettes du catalogue global ; `foyer_id` inchangé → la recette reste dans le foyer, éditable par les membres via RG-30 qui contrôle `foyer_id`, pas `user_id`).

**Notes d'implémentation (design corrigé — voir §7 pour la séquence SQL complète) :**
- **Pas de `quitter_foyer` préalable** (clonage inutile puisqu'on supprime). Une **RPC dédiée** `supprimer_mon_compte()` (`SECURITY DEFINER`) traite les deux cas directement, puis la route appelle l'admin API.
- **Route serveur** `app/api/compte/supprimer/route.ts` : (1) re-vérifie la session, (2) appelle la RPC (purge atomique des données, laisse `auth.users` intact), (3) appelle `supabase.auth.admin.deleteUser(user.id)` via un client **service_role** instancié **uniquement côté serveur**.
- **Cas foyer partagé** (membres > 1) : `update recette set user_id = null where foyer_id = mon_foyer() and user_id = auth.uid()` (sévère le lien de cascade + préserve les recettes) ; mon profil disparaîtra au cascade de l'admin delete (PK `profiles.user_id`), me retirant du foyer ; mes `reglages` (par-user) tombent au cascade. Le foyer partagé subsiste (d'autres profils le référencent).
- **Cas solo** (membres = 1) : purge explicite ordonnée des tables foyer-scopées **non** liées à `user_id` (`etat_courses_article`, `planning`→slots cascade, `recette_masquee`) + `recette` du foyer + `reglages` ; puis **supprimer mon profil** (obligatoire AVANT le foyer car `profiles.foyer_id` est `ON DELETE RESTRICT`) ; puis **supprimer le foyer** (sinon ligne orpheline). L'admin delete final est alors un quasi no-op.
- ⚠️ **Secret `SUPABASE_SERVICE_ROLE_KEY` (validé)** : env serveur Vercel (Production/Preview), **jamais bundlé client**, jamais commité. `.env.example` + ADR (gestion des secrets). Si la CI l'utilise un jour pour le teardown e2e → **deux coffres** (Actions + Dependabot).
- **Échec partiel** : si l'admin delete échoue après le commit de la RPC, les données sont purgées mais l'auth survit (compte « fantôme » sans profil). → logguer Sentry + message « réessaie » ; la RPC est **idempotente** (re-run sûr : données déjà absentes). Acceptable avec monitoring.
- **Bonus** : la service_role permet enfin un **teardown réel des comptes jetables** e2e (dette assumée jusqu'ici).

**Critères d'acceptation :**
- [ ] Suppression réelle de l'utilisateur auth + données scopées
- [ ] **Foyer partagé : recettes créées par moi réattribuées (`user_id=NULL`), aucune donnée d'un autre membre supprimée** (test dédié)
- [ ] Catalogue global (`foyer_id IS NULL`) intact dans tous les cas
- [ ] Solo : aucune ligne orpheline (foyer supprimé, pas d'`etat_courses_article`/`planning`/`recette_masquee` résiduel)
- [ ] Ré-authentification + confirmation forte (« tape SUPPRIMER ») avant exécution
- [ ] Secret service_role serveur uniquement
- [ ] RPC idempotente + gestion de l'échec partiel (log + retry)

**Nouvelle RG-41 — Effacement** : la suppression de compte purge toutes les données du foyer **solo** du demandeur ; en foyer **partagé**, elle le retire sans toucher aux données conservées par les autres (recettes qu'il a créées réattribuées sans créateur, `user_id=NULL`) ; le catalogue global est hors périmètre. Opération atomique côté serveur, idempotente.

**Effort :** L · **Dépend de :** service_role (nouveau secret) · **Bloque :** ouverture publique.

---

### US-32 — Export de mes données (droit à la portabilité, art. 20)

> **En tant qu'** utilisateur, je veux exporter mes données dans un format réutilisable, afin d'exercer mon droit à la portabilité.

**Comportement :**
> **Given** je suis sur `/profil`
> **When** je clique « Exporter mes données »
> **Then** je télécharge un fichier **JSON** structuré : profil, réglages, recettes du foyer (+ ingrédients), plannings (historique), coches, masquages — **lisible et autosuffisant**

**Notes d'implémentation :**
- Route serveur `app/api/compte/export/route.ts` lisant **sous la session de l'utilisateur** (RLS) — pas besoin de service_role. Agrège via la couche `lib/persistance.ts` / `lib/recettes.ts`.
- Format documenté (un `version` de schéma d'export). Le catalogue global peut être référencé par id sans être ré-exporté en entier.

**Critères d'acceptation :**
- [ ] Export JSON complet des données du foyer de l'utilisateur
- [ ] Téléchargement direct, pas d'email requis
- [ ] Schéma versionné et documenté

**Effort :** M · **Dépend de :** rien (RLS suffit).

---

## Lot 2 — Email transactionnel & vérification (BLOQUEUR DUR)

> Le SMTP intégré de Supabase est **plafonné à ~3-4 emails/heure** et explicitement non destiné à la prod. À 1000 inscrits/mois, signup + reset de mot de passe **casseront** silencieusement. Et la confirmation email (OFF aujourd'hui) doit être activée pour fermer l'énumération (ex-#192) et empêcher les comptes à email arbitraire.

### EPIC #B2C-2 — Pipeline email production

### US-33 — SMTP transactionnel custom (Resend ou équivalent)

> **En tant que** plateforme, je veux un fournisseur d'email transactionnel fiable, afin que les emails d'auth (confirmation, reset) arrivent à l'échelle.

**Comportement :**
> **Given** un utilisateur s'inscrit ou demande un reset
> **When** Supabase envoie l'email
> **Then** il transite par un **SMTP custom** (Resend) authentifié sur un domaine vérifié (SPF/DKIM/DMARC), avec une délivrabilité et des quotas adaptés

**Notes d'implémentation :**
- **Vendor figé : Resend** (DX simple, free tier 3k mails/mois, scale ensuite). Nouvelle dépendance BaaS → l'ajouter à l'ADR (alternatives écartées) + à la liste des sous-traitants RGPD (US-29).
- Configurer le **Custom SMTP** dans Supabase Auth (host/port/user/pass Resend) + domaine d'envoi vérifié (DNS).
- Templates email Supabase (confirmation, reset, magic link, changement email) en **FR**, à la marque OMQ — solde **#154** (templates reset) et l'élargit.
- Nouveaux secrets : clés Resend côté Supabase (pas dans le repo). Documenter.

**Critères d'acceptation :**
- [ ] SMTP custom branché sur Supabase (dev/staging/prod cohérents)
- [ ] Domaine vérifié (SPF/DKIM/DMARC verts)
- [ ] Templates FR brandés (confirmation, reset a minima)
- [ ] #154 soldée

**Effort :** M (surtout config/DNS) · **Bloque :** US-34.

---

### US-34 — Activer la confirmation email + fermer l'énumération (ex-#192, F-05)

> **En tant que** plateforme, je veux que les emails soient vérifiés et que l'inscription ne révèle pas l'existence d'un compte, afin d'éviter les comptes à email arbitraire et l'énumération.

**Comportement :**
> **Given** je m'inscris avec un email
> **When** je valide
> **Then** je reçois un email de confirmation ; mon compte n'est pleinement actif qu'après clic (Supabase « Confirm email » **ON**)

> **Given** je m'inscris avec un email **déjà** utilisé
> **When** je valide
> **Then** le message est **identique** au cas « nouvel email » (« vérifie ta boîte mail ») — aucune fuite d'existence

**Notes d'implémentation (voir §7B pour le détail) :**
- Activer **Confirm email** côté Supabase, **prod ET staging** (même config partout pour ne pas tester un flux différent de la prod).
- ⚠️ **Modif UI signup obligatoire** : `app/signup/page.tsx` appelle `signUp` et s'appuie aujourd'hui sur la **session auto-créée** (confirmation OFF) pour enchaîner. Avec confirmation ON, `signUp` renvoie `session: null` → il faut un **état interstitiel « Vérifie ta boîte mail »** (et ne PAS rediriger vers une route protégée, qui rebondirait sur `/login`).
- ⚠️ **Casse TOUTE la suite e2e** (pas seulement `auth.setup.ts`) : tous les helpers (`e2e/helpers.ts`) et le setup obtiennent un token via `POST /auth/v1/token?grant_type=password` → `400 email_not_confirmed` tant que non confirmé. **Décision : auto-confirmer les comptes e2e via la `service_role`** (admin API), cf. §7B.2. Cohérent avec le secret déjà introduit en US-31.
- Le message UI anti-énumération est déjà neutre (`lib/messages-auth.ts`, `traduireErreurAuth(err,"signup")`). **Résiduel** : avec confirmation ON, `signUp` sur un email existant renvoie un user à `identities: []` (obfuscation Supabase) — un script peut encore le détecter. Acceptable (fermeture « best effort ») ; documenter.

**Critères d'acceptation :**
- [ ] Confirm email ON en prod **et** staging
- [ ] Interstitiel « vérifie ta boîte mail » après signup (pas de redirection protégée)
- [ ] Message d'inscription non différenciant (existe / n'existe pas) côté UI
- [ ] Suite e2e fonctionnelle (comptes auto-confirmés via service_role, documenté)
- [ ] Décision ADR (confirmation ON partout + auto-confirm e2e)

**Effort :** M · **Dépend de :** US-33 (sinon les emails ne partent pas) + service_role (US-31) · **Bloque :** ouverture publique.

---

## Lot 3 — Hébergement & résilience prod (BLOQUEUR DUR, surtout ops)

> Peu de code, mais des **décisions d'infra obligatoires** avant d'ouvrir. Aujourd'hui tout est en free tier : Vercel **Hobby = usage non commercial** (ToS), Supabase free **se met en pause après 7j d'inactivité** (#15 keep-alive ouvert) et **sans backup PITR**.

### EPIC #B2C-3 — Passage en tier production

### US-35 — Passer Vercel + Supabase en tier production

> **En tant qu'** exploitant, je veux des plans adaptés à un usage public, afin de respecter les ToS et d'avoir backups + capacité.

**Décisions / actions (chore, peu de code — détail en §7C) :**
- **Vercel Pro** (~20 $/mois) : ToS commercial OK (le plan Hobby est non commercial), plus de capacité fonctions/bande passante, protection DDoS de base.
- **Supabase Pro** (~25 $/mois) sur la **prod** : plus de pause d'inactivité, **backups quotidiens + PITR**, quotas Realtime/DB relevés.
- **Connection pooling = NON concerné (vérifié)** : l'app n'ouvre **aucune** connexion Postgres directe — uniquement le client HTTP `@supabase/supabase-js` (PostgREST/GoTrue), qui pool côté serveur. Pas de risque d'épuisement de connexions serverless → ne pas configurer Supavisor « pour scaler », ce serait du bruit. (Seuls la CLI `db push` en CI et `scripts/query-supabase.mjs` touchent la base directement, hors chemin requête.)
- **Keep-alive (#15) NE se ferme PAS, il se réduit** : Pro supprime la pause **prod** → retirer le ping prod du workflow ; **garder le ping staging** (qui reste free et casserait les e2e de la 1ʳᵉ PR suivante s'il se met en pause).
- **Migration clés API Supabase (#93)** : les clés `anon`/`service_role` legacy sont **dépréciées (arrêt fin 2026)** → adopter le **nouveau format** (`sb_publishable_…` / `sb_secret_…`) **dès maintenant**, en cohérence avec les nouveaux secrets des Lots 1/2. Détail §7C.1.
- **Domaine custom** : absorbe **#134** (le renommage Vercel change l'URL `.vercel.app` → mieux vaut un domaine propre). Impacte les **URLs de redirection Auth** Supabase (Site URL + allowlist) et le domaine d'envoi Resend. Détail §7C.2.
- **Budget** : ~45-50 $/mois infra de base (Vercel Pro + Supabase Pro), hors Resend/PostHog (free tiers au départ) — à valider vu le modèle « gratuit au lancement ».

**Critères d'acceptation :**
- [ ] Plans Pro actifs (Vercel + Supabase prod) avant ouverture
- [ ] Backups vérifiés (restauration testée une fois — US-36)
- [ ] Keep-alive réduit au ping staging (prod retirée du workflow), #15 mise à jour
- [ ] Clés API migrées vers le nouveau format (#93) partout (env Vercel, CI/2 coffres, `.env.local`, workflow keep-alive)
- [ ] Domaine custom en place + URLs de redirection Auth/Resend alignées (absorbe #134)
- [ ] Budget mensuel validé

**Effort :** S (décisions + config) · **Bloque :** ouverture publique.

---

### US-36 — Sauvegardes & plan de restauration documentés

> **En tant qu'** exploitant, je veux un plan de sauvegarde/restauration écrit, afin de survivre à une perte de données.

**Notes :** documenter dans l'ADR : fréquence backups (Pro), procédure de restauration PITR, RPO/RTO acceptés, qui fait quoi. Tester une restauration sur staging une fois.
**Critères d'acceptation :** runbook de restauration écrit + test réussi une fois.
**Effort :** S · **Dépend de :** US-35.

---

## Lot 4 — Mesure produit & support in-app (Palier C — indispensable au pilotage)

> Pour piloter un lancement vers 1000 users, il faut **mesurer le funnel** (inscription → onboarding → 1er planning → rétention) et **recevoir du feedback**. Aujourd'hui : seulement `@vercel/analytics` (trafic agrégé) + Sentry (erreurs). Aucun funnel produit, aucun canal de feedback.

### EPIC #B2C-4 — Observabilité produit & boucle de feedback

### US-37 — Analytics de funnel (activation & rétention)

> **En tant que** product owner, je veux mesurer le funnel d'activation et la rétention, afin de savoir si j'atteins 1000 users actifs et où ça décroche.

**Comportement / événements à tracer :** `signup`, `onboarding_step_1/2`, `onboarding_complete`, `premier_planning_genere`, `planning_genere` (récurrent), `liste_courses_ouverte`, `recette_creee`, `foyer_rejoint`, `compte_supprime`. KPIs : taux d'activation (signup→1er planning), rétention W1/W4, fréquence de génération.

**Notes d'implémentation (points d'ancrage : §7D.1) :**
- **Vendor figé : PostHog (instance EU)** pour de vrais funnels/rétention. Capture **gatée par le consentement** (US-30) : `opt_out_capturing_by_default: true` jusqu'à l'opt-in.
- **Décision : capture 100 % côté CLIENT** (le serveur ignore le consentement) → `planning_genere` se pose après le `fetch`, pas dans la route. Sécurité=serveur / mesure=client.
- Helper central `lib/analytics.ts` (no-op si non consenti / si env absente — même esprit que `lib/rate-limit.ts`). Pas de PII dans les events (id pseudonymisé, pas l'email en clair).
- Ajouter PostHog à l'ADR + sous-traitants RGPD (US-29) + **CSP `connect-src`** (origines `*.posthog.com` / domaine EU — Palier B / F-01, sinon les events seront bloqués une fois la CSP en enforcement).

**Critères d'acceptation :**
- [ ] Événements de funnel posés sur les étapes clés
- [ ] No-op sans consentement / sans config
- [ ] Dashboard funnel + rétention exploitable
- [ ] Aucune PII envoyée ; vendor déclaré (RGPD + CSP)

**Effort :** M · **Dépend de :** US-30 (consentement).

---

### US-38 — Canal de feedback / signalement in-app

> **En tant qu'** utilisateur, je veux signaler un bug ou suggérer une idée sans quitter l'app, afin d'être entendu (et l'équipe de capter les problèmes à l'échelle).

**Comportement :**
> **Given** je suis connecté
> **When** j'ouvre « Donner mon avis / Signaler un souci » (entrée discrète dans `/profil` ou la nav)
> **Then** je saisis un message (+ catégorie bug/idée), envoyé avec un contexte technique minimal (page, version app) — confirmation visible

**Notes d'implémentation :**
- Simple : table `feedback (user_id, foyer_id, categorie, message, contexte jsonb, cree_le)` + RPC insert sous RLS, ou route serveur qui poste vers un canal (email/Discord/Linear). Garder léger.
- Anti-spam : réutiliser le rate-limit Upstash (clé `user.id`).
- Lien avec la doc `/aide` (FAQ avant de contacter).

**Critères d'acceptation :**
- [ ] Formulaire de feedback accessible aux connectés
- [ ] Stockage/acheminement fiable + accusé de réception UI
- [ ] Throttle anti-spam

**Effort :** S-M · **Dépend de :** rien.

---

### US-39 — Page « statut / incident » légère (optionnel lancement)

> **En tant qu'** utilisateur, je veux savoir si une panne est connue, afin de ne pas croire que l'app est cassée chez moi.
> Léger : bannière d'incident pilotable (flag) ou page statut simple. **Nice-to-have**, après ouverture.
**Effort :** S · **Priorité :** basse.

---

## Lot 5 — Rétention (Palier C)

> Un produit hebdomadaire (« qu'est-ce qu'on mange cette semaine ? ») vit ou meurt sur la **rétention W1→W4**. Aujourd'hui aucun mécanisme de rappel.

### EPIC #B2C-5 — Boucle de rétention

### US-40 — Emails de cycle de vie

> **En tant qu'** utilisateur, je veux des emails utiles aux bons moments, afin de revenir au moment de planifier.

**Comportement / déclencheurs :**
- **Bienvenue** (J0, après confirmation) : rappel de la valeur + lien direct planning.
- **Relance d'activation** (J2-J3 si onboarding non terminé ou aucun planning généré).
- **Relance hebdo** (jour configurable, ex. vendredi/samedi : « Prépare la semaine prochaine ») — **opt-in/opt-out** respecté.

**Notes d'implémentation (détail : §7D.2) :**
- Réutilise le SMTP de **US-33** (Resend) ; templating côté Resend ou maison.
- **Déclenchement figé : Vercel Cron → route protégée** (`CRON_SECRET`), **pas** GitHub Actions — le `service_role` et la clé Resend restent côté Vercel prod (posture Lot 3). Vercel Pro (US-35) débloque les crons fins.
- **Ciblage cross-users** via fonction `SECURITY DEFINER` `utilisateurs_a_relancer(p_semaine)` (RLS ne permet pas de lire les autres) ; relance hebdo = foyers **sans planning** pour la semaine prochaine, **dédupliquée par foyer**.
- **Préférences email** dans `/profil` (`profiles` : `optin_relance_hebdo`, `optin_produit`) + **lien de désinscription** (route publique à token signé) dans chaque email (obligation RGPD, RG-42). Envois **idempotents** (drapeaux `derniere_relance_hebdo_le` / `relance_activation_le`).

**Critères d'acceptation :**
- [ ] 3 emails (bienvenue, activation, relance hebdo) avec opt-out fonctionnel
- [ ] Préférences email dans `/profil`
- [ ] Lien de désinscription dans chaque email
- [ ] Déclencheurs périodiques fiables et idempotents

**Nouvelle RG-42 — Communications & opt-out** : tout email non transactionnel exige un opt-in (ou opt-out clair) et un lien de désinscription ; les préférences sont respectées partout.

**Effort :** M-L · **Dépend de :** US-33 (SMTP).

---

### US-41 — Notifications push web (reprend #90)

> **En tant qu'** utilisateur ayant installé la PWA, je veux un rappel push hebdo, afin de penser à générer mon planning.
> La PWA (#71) est livrée (manifest + icônes), **sans service worker** (choix #71). Le push web **exige un service worker** → re-ouvrir ce périmètre. iOS support PWA push depuis 16.4 (app installée).
**Notes :** chantier conséquent (SW + abonnement push + VAPID + permission UX). À séquencer **après** les emails (US-40), qui couvrent déjà la relance avec moins de friction.
**Effort :** L · **Dépend de :** service worker (nouveau) · **Priorité :** basse au lancement.

---

## Lot 6 — Acquisition (Palier C)

> Aujourd'hui la valeur n'est visible qu'**après login**. Pour acquérir des inscrits organiques/SEO, il faut une **surface publique** qui vend la promesse.

### EPIC #B2C-6 — Surface d'acquisition publique

### US-42 — Landing page publique orientée conversion

> **En tant que** visiteur non inscrit, je veux comprendre la valeur de l'app et m'inscrire, afin de tester sans friction.

**Comportement :**
> **Given** j'arrive sur `/` sans compte
> **When** je lis la page
> **Then** je vois la promesse (« la question du soir a enfin sa réponse »), les bénéfices clés, un aperçu visuel (réutiliser `apercu-planning`), des CTA d'inscription, et les liens légaux

**Notes d'implémentation :**
- `app/page.tsx` est déjà un hero public (avec `apercu-planning` décoratif) → l'étoffer en vraie landing (sections bénéfices, capture d'écran, FAQ courte, CTA). Garder mobile-first + design system.
- SEO de base : `metadata` (title/description/OG déjà partiellement là), `sitemap.ts`, `robots.ts`, données structurées (`SoftwareApplication`).
- Mesurer la conversion via US-37.

**Critères d'acceptation :**
- [ ] Landing publique claire avec CTA d'inscription
- [ ] Métadonnées SEO + sitemap + robots
- [ ] Liens légaux présents (US-29)
- [ ] Responsive + cohérent design system

**Effort :** M · **Dépend de :** US-29 (liens légaux), US-37 (mesure).

---

### US-43 — SEO de contenu via `/aide` (levier organique)

> La doc `/aide` (modèle Notion → SSG, #97) est déjà indexable. L'enrichir comme **levier d'acquisition SEO** (articles « idées de repas de la semaine », « liste de courses rapide »…) avec maillage interne vers l'app.
**Effort :** S (réutilise le pipeline existant) · **Priorité :** moyenne.

---

## Transverse — Fondations freemium (sans billing)

> Décision : freemium **plus tard**. On ne code **pas** le paiement, mais on pose les fondations pour ne pas avoir à refactorer.

### US-44 — Compteur d'usage & point de quota (préparation freemium)

> **En tant que** futur opérateur d'un modèle freemium, je veux pouvoir mesurer et borner l'usage, afin d'introduire des quotas sans refonte.

**Notes d'implémentation :**
- **Pas de paiement.** Juste : (1) un compteur d'usage par utilisateur/foyer (générations, recettes créées) — peut dériver des events analytics (US-37) ou d'une table légère ; (2) un **point d'application de quota** unique côté serveur (ex. wrapper dans `/api/planning/generer`, déjà le point du rate-limit Upstash) prêt à recevoir une limite par tier.
- Garder un **flag `tier`** sur `profiles`/`foyers` (défaut `free`), **inerte** pour l'instant.
- Le rate-limit Upstash existant est le squelette naturel du futur quota.

**Critères d'acceptation :**
- [ ] Colonne `tier` (défaut free) posée, inerte
- [ ] Usage mesurable (events ou table)
- [ ] Point d'application de quota identifié/centralisé, sans limite active

**Effort :** S · **Priorité :** opportuniste (poser le `tier` quand on touche `profiles` pour autre chose).

---

## 7. Lot 1 — Spec d'implémentation détaillée

> Approfondissement du lot RGPD (le plus risqué). Ancré sur le schéma réel (migrations vérifiées le 2026-06-22). À transformer en migration + code au moment du dev.

### 7.1 Faits de schéma déterminants (vérifiés)

| Relation | Règle ON DELETE | Conséquence pour la suppression |
|----------|-----------------|----------------------------------|
| `profiles.user_id → auth.users(id)` (PK) | **CASCADE** | supprimer l'auth user supprime le profil (me retire du foyer) |
| `profiles.foyer_id → foyers(id)` | **RESTRICT** | impossible de supprimer un `foyers` tant qu'un profil le référence → supprimer le profil **avant** le foyer |
| `recette.user_id → auth.users(id)` | **CASCADE** | ⚠️ **danger** : supprime les recettes créées par moi, **y compris dans un foyer partagé** → réattribuer `user_id=NULL` avant |
| `reglages.user_id → auth.users(id)` | **CASCADE** | par-utilisateur → tombe proprement au cascade |
| `recette_ingredient.recette_id`, `planning_slot.planning_id` | **CASCADE** | nettoyés via le parent (`recette`/`planning`) |
| `etat_courses_article`, `planning`, `recette_masquee` | **foyer-scopés, pas de `user_id`** (depuis #56) | à purger explicitement par `foyer_id` (cas solo) |

Tables foyer-scopées (clés depuis #56) : `recette` (+`recette_ingredient`), `recette_masquee (foyer_id, recette_id)`, `planning` (+`planning_slot`), `etat_courses_article (foyer_id, semaine, cle, quantite)`. `reglages` reste **par-utilisateur**.

> ✅ **`user_id=NULL` ne fuite PAS vers le catalogue global (vérifié).** Depuis #56, la policy SELECT de `recette` est `using (foyer_id is null or foyer_id = mon_foyer())` (migration `foyer_scoping`, l'ancienne policy `user_id is null or auth.uid()=user_id` a été **droppée**). La **visibilité est désormais pilotée par `foyer_id`**, pas par `user_id`. On ne touche **que `user_id`** (→ NULL) en laissant `foyer_id` = foyer partagé → la recette reste visible **uniquement de ses membres**. Le « global » reste défini par `foyer_id IS NULL`, jamais atteint. Cohérences : éditabilité = `foyer_id !== null` (membres gardent l'édition, RG-30) ; pas de contrainte `user_id` sur l'UPDATE (le check F-03 #190 ne porte que sur l'INSERT). *Alternative possible si l'on tient à un « propriétaire » : réattribuer à un autre membre du foyer plutôt que NULL — non nécessaire ici, NULL est l'état canonique « sans créateur ».*

### 7.2 RPC `supprimer_mon_compte()` — séquence (pseudo-SQL)

```sql
create or replace function supprimer_mon_compte()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_foyer uuid := mon_foyer();
  v_membres int;
begin
  if v_foyer is null then raise exception 'Aucun foyer'; end if;
  select count(*) into v_membres from profiles where foyer_id = v_foyer;

  if v_membres > 1 then
    -- CAS PARTAGÉ : préserver le foyer, sévérer le cascade des recettes créées par moi.
    update recette set user_id = null
      where foyer_id = v_foyer and user_id = auth.uid();
    delete from reglages where user_id = auth.uid();
    -- mon profil sera supprimé par le cascade de admin.deleteUser (PK user_id),
    -- ce qui me retire du foyer ; le foyer subsiste (autres profils).
  else
    -- CAS SOLO : tout purger, dans l'ordre imposé par les FK.
    delete from etat_courses_article where foyer_id = v_foyer;
    delete from recette_masquee       where foyer_id = v_foyer;
    delete from planning              where foyer_id = v_foyer;   -- slots en cascade
    delete from recette               where foyer_id = v_foyer;   -- ingrédients en cascade
    delete from reglages              where user_id  = auth.uid();
    delete from profiles              where user_id  = auth.uid(); -- AVANT le foyer (RESTRICT)
    delete from foyers                where id = v_foyer;          -- sinon ligne orpheline
  end if;
end; $$;
revoke execute on function supprimer_mon_compte() from public;
grant  execute on function supprimer_mon_compte() to authenticated;
```

> **Idempotence** : un second appel après purge ne trouve plus rien à supprimer (no-op) — sûr pour le retry après échec partiel de l'admin delete. **À valider** comme `quitter_foyer` l'a été : test SQL en transaction `rollback` (impersonation JWT `set local request.jwt.claims`) sur staging, asserant chaque table dans les deux cas (solo / partagé).

### 7.3 Route `app/api/compte/supprimer/route.ts`

1. `const { data: { user } } = await supabase.auth.getUser()` ; rejeter 401 si absent.
2. (option) re-vérif d'un jeton de confirmation / ré-auth récente.
3. `await supabase.rpc('supprimer_mon_compte')` (client session) — purge atomique.
4. Client **service_role** (instancié dans le handler, `SUPABASE_SERVICE_ROLE_KEY`, jamais importé côté client) → `await admin.auth.admin.deleteUser(user.id)`.
5. Sur échec étape 4 : log Sentry + 500 « réessaie » (RPC idempotente). Sur succès : `signOut` local + 200, le client redirige vers une page publique de confirmation.

> **`/api/*` est exempté de la garde onboarding du proxy** (vérifié `proxy.ts:84`) → la route fonctionne même pour un compte non onboardé qui voudrait se supprimer.

### 7.4 Export (US-32) — schéma de sortie

Route `app/api/compte/export/route.ts`, lecture **sous session (RLS)**, pas de service_role. Renvoie un JSON `Content-Disposition: attachment` :

```jsonc
{
  "version": 1,
  "exporte_le": "<ISO>",
  "profil":   { "prenom": "...", "couleur_avatar": "...", "email": "..." },
  "reglages": { /* ligne reglages de l'utilisateur */ },
  "recettes": [ { /* recette du foyer + ingrédients ; globales référencées par id */ } ],
  "plannings":[ { "semaine": "2026-W23", "slots": [ ... ] } ],
  "coches":   [ { "semaine": "...", "cle": "...", "quantite": 1 } ],
  "masquages":[ "<recette_id global>" ]
}
```

### 7.5 Consentement & pages légales (US-29/30)

- **Colonnes `profiles`** (migration) : `cgu_version text`, `cgu_acceptees_le timestamptz`, `consentement_analytics boolean default false`, `optin_relance_hebdo boolean default false`, `optin_produit boolean default false` — toutes au **GRANT colonne** `authenticated` (cf. ADR-09 : le client ne peut écrire que des colonnes whitelistées de `profiles`, pas `foyer_id`). ⚠️ Étendre le `grant update (...) on profiles` existant à ces nouvelles colonnes.
- **Routes publiques** : ajouter `/legal` (et garder `/aide`) hors `protectedRoutes`. ⚠️ La **garde onboarding** du proxy redirige tout connecté non-onboardé vers `/bienvenue` → **exempter aussi `/legal`** (comme `/api`/`/auth`) pour qu'un utilisateur en cours d'onboarding puisse lire les CGU.
- **Signup** : case à cocher non pré-cochée (RG-40), bloque la soumission tant que non cochée ; écrit `cgu_version`/`cgu_acceptees_le`. Pages SSG sous `app/legal/*` (pipeline `react-markdown` réutilisable). **Contenu juridique = relecture humaine** (placeholder + modèle CNIL en attendant).

### 7.6 Plan de test Lot 1

- **Unit** : sérialisation export (schéma stable), garde de longueur mdp (US-25).
- **SQL transactionnel (`rollback`)** : `supprimer_mon_compte` solo **et** partagé — asserter recettes réattribuées `user_id=NULL` (partagé), foyer/lignes purgés (solo), catalogue global intact, données d'un 2ᵉ membre intactes (partagé).
- **e2e (CI, comptes jetables)** : signup avec consentement requis ; suppression de compte solo → login impossible ensuite ; export → fichier non vide. Le cas partagé réutilise le pattern 2 comptes de `foyer-clonage.spec`.

---

## 7B. Lot 2 — Spec d'implémentation détaillée

> Approfondissement email/confirmation. Ancré sur le code réel (`app/signup/page.tsx`, `e2e/auth.setup.ts`, `e2e/helpers.ts`, vérifiés le 2026-06-22).

### 7B.1 Resend & SMTP (US-33)

- **Resend** : créer le domaine d'envoi (ex. `mail.onmangequoi.app`), poser les DNS **SPF / DKIM / DMARC**, attendre la vérification verte.
- **Supabase Auth → SMTP** : renseigner host/port/user/pass Resend (Custom SMTP), sender name/email à la marque. Relever le **rate limit d'envoi** Auth (par défaut bas).
- **Templates** (FR, marque OMQ) : *Confirm signup*, *Reset password*, *Magic Link* (si utilisé), *Change email*. Solde #154 (reset) et l'étend. Liens de redirection : confirmation → `/planning` (proxy renverra vers `/bienvenue` si onboarding non terminé) ; reset → `/auth/reinitialiser` (déjà en place).
- **Secrets** : clés Resend posées **côté Supabase** (pas dans le repo). Région Resend EU (RGPD, US-29).

### 7B.2 Confirmation email & impact e2e (US-34) — décision

**Comportement applicatif (prod = staging) :** Confirm email **ON**. Après `signUp` → `session: null` → l'app affiche un **interstitiel** « Vérifie ta boîte mail ». Le compte n'est actif qu'après clic sur le lien.

**Problème e2e :** confirmation ON ⇒ `grant_type=password` renvoie `400 email_not_confirmed` ⇒ `auth.setup.ts` **et** tous les helpers REST de `e2e/helpers.ts` (nettoyage état/réglages/masquages, `marquerOnboardingCompletDistant`) **et** les specs à signup réel (`onboarding`, `acquisition`, `foyer-clonage`) cassent.

**Décision retenue — auto-confirmation via `service_role` (Option A) :**
- Le setup e2e crée/garantit les comptes **pré-confirmés** via l'**admin API** : soit `POST /auth/v1/admin/users` avec `{ email, password, email_confirm: true }` (création), soit `PUT /auth/v1/admin/users/{id}` avec `email_confirm: true` (compte déjà créé par signup public). Ensuite, `grant_type=password` fonctionne → le reste de la suite est inchangé.
- Les specs qui exercent le **tunnel d'onboarding** (`onboarding`/`acquisition`) créent leur compte jetable **pré-confirmé via admin** puis se connectent par l'UI → elles testent le tunnel sans dépendre de la lecture d'un email.
- Un **petit test UI dédié** vérifie l'**interstitiel** « vérifie ta boîte mail » après un signup via le formulaire (sans confirmer).

**Pourquoi pas les alternatives :**
- *Confirm OFF sur staging* : l'app se comporterait différemment de la prod (le flux signup réel ne serait jamais testé) → divergence dangereuse.
- *Boîte mail programmable (Mailosaur/Inbucket)* : teste le clic réel mais ajoute un vendor + des secrets + de la flakiness → surdimensionné.

**Coût & posture sécurité :** la `service_role` **bypasse toute la RLS** — c'est la clé la plus sensible. Pour limiter le rayon d'explosion :
- **CI ne reçoit QUE la service_role de STAGING** (les e2e tapent staging) → une fuite du secret CI ne compromet que des données jetables, pas la prod. À poser dans **les deux coffres** GitHub (Actions **ET** Dependabot, cf. piège secrets Dependabot).
- **La service_role de PROD vit UNIQUEMENT dans l'env Vercel Production** (route de suppression US-31), **jamais** en CI ni dans le repo.
- Convention de nommage à acter : ex. `STAGING_SUPABASE_SERVICE_ROLE_KEY` (CI) vs `SUPABASE_SERVICE_ROLE_KEY` (Vercel prod). Jamais bundlé client dans les deux cas.

**Bonus :** la service_role staging débloque enfin le **teardown réel des comptes jetables** e2e (dette assumée jusqu'ici).

### 7B.3 Plan de test Lot 2

- **e2e** : signup via formulaire → interstitiel « vérifie ta boîte mail » visible, **pas** de redirection vers `/planning` ; comptes de test toujours utilisables (auto-confirm) → suite verte.
- **Manuel (staging réel)** : recevoir l'email Resend (confirmation + reset), cliquer le lien, vérifier la délivrabilité (SPF/DKIM/DMARC verts, pas en spam).
- **Anti-énumération** : signup d'un email existant → même interstitiel que pour un nouvel email (UI) ; noter le résiduel `identities:[]`.

---

## 7C. Lot 3 — Spec d'implémentation détaillée

> Surtout des décisions ops. Ancré sur le réel (workflow keep-alive, absence de connexion Postgres directe, vérifiés le 2026-06-22).

### 7C.1 Migration des clés API Supabase (#93)

Les clés legacy `anon` / `service_role` (JWT) sont **dépréciées (arrêt annoncé fin 2026)**. Nouveau format : **`sb_publishable_…`** (remplace `anon`, public, côté client) et **`sb_secret_…`** (remplace `service_role`, serveur uniquement). À faire **avant** la montée en charge, et **avant** de poser les nouveaux secrets des Lots 1/2 (pour ne pas les poser deux fois) :
- Générer les nouvelles clés dans le dashboard Supabase (prod **et** staging).
- Remplacer **partout** où la clé vit : `.env.local`, env Vercel (Preview + Production), **secrets GitHub des 2 coffres** (Actions + Dependabot), workflow `supabase-keepalive.yml`, et la génération de `.env.local` en CI (`ci.yml`, mapping `STAGING_SUPABASE_*` → `NEXT_PUBLIC_*`).
- Le code lit déjà la clé via `NEXT_PUBLIC_SUPABASE_ANON_KEY` → **garder le nom de variable**, changer seulement la **valeur** (publishable). Le nouveau **secret** sert pour US-31/34 (`SUPABASE_SERVICE_ROLE_KEY` → valeur `sb_secret_…`).
- Vérifier qu'aucune clé legacy ne traîne avant de les révoquer.

### 7C.2 Domaine custom & URLs de redirection (absorbe #134)

- Brancher le **domaine custom** sur Vercel (prod). Le renommage du projet Vercel (#134) devient secondaire — le domaine propre fait foi.
- **Supabase Auth** : mettre à jour **Site URL** + **Redirect allowlist** (sinon confirmation email / reset / deep-link `/signup?code=` cassent en prod). Inclure le domaine custom et les URLs de preview si besoin.
- **Resend** : domaine d'envoi cohérent avec le domaine custom (sous-domaine `mail.`), DNS sur la même zone.
- Vérifier les URLs absolues éventuelles (OG image `app/opengraph-image.png`, metadata) → pointer sur le domaine custom.

### 7C.3 Sauvegardes & restauration (US-36)

- **Supabase Pro** : backups quotidiens automatiques + **PITR** (point-in-time recovery). Pas de code.
- **Runbook** (à écrire dans l'ADR ou un `RUNBOOK.md`) : fréquence des backups, procédure de restauration (dashboard / PITR), **RPO/RTO** acceptés (ex. RPO 24 h backup quotidien, mieux avec PITR ; RTO quelques minutes), qui agit.
- **Test une fois** : restaurer un backup sur **staging** pour valider la procédure (ne jamais découvrir la restauration le jour de l'incident).
- Rappel : les **comptes jetables e2e** s'accumulent sur staging (assumé) — sans incidence sur les backups prod.

---

## 7D. Palier C — Spec d'implémentation détaillée

> Ancré sur le code réel (`lib/rate-limit.ts`, `app/api/planning/generer/route.ts`, `app/bienvenue/page.tsx`, `lib/profil.ts`, vérifiés le 2026-06-22). Moins risqué que les Lots 1-3 ; ces features se déploient **pendant** la montée en charge.

### 7D.1 Analytics PostHog (US-37) — placement & décisions

**Décision : capture 100 % CLIENT, gatée par le consentement.** Le serveur ne connaît pas le choix de consentement (US-30) → toute capture serveur violerait le RGPD. On sépare nettement : **rate-limit/quota = serveur** (sécurité), **mesure = client** (consenti). Conséquence : l'event `planning_genere` se pose **après résolution du `fetch`** côté client (`app/planning/page.tsx:411`, `app/bienvenue/page.tsx:138`), **pas** dans la route.

**Helper `lib/analytics.ts`** : init PostHog (instance EU) avec `opt_out_capturing_by_default: true` ; `capter(event, props?)` no-op tant que (consentement absent **ou** env absente — même esprit que `lib/rate-limit.ts`). `distinct_id` pseudonymisé (jamais l'email en clair).

**Points d'ancrage vérifiés (events) :**
| Event | Où le poser |
|-------|-------------|
| `signup` | succès `signUp` (`app/signup/page.tsx`) |
| `onboarding_step_1/2` | transitions du tunnel (`app/bienvenue/page.tsx`) |
| `onboarding_complete` | après `terminerOnboarding()` (`lib/profil.ts:111`, appelé depuis `/bienvenue`) |
| `premier_planning_genere` | branche solo de `/bienvenue` après le `fetch` OK |
| `planning_genere` | `app/planning/page.tsx` après le `fetch` OK |
| `liste_courses_ouverte` | montage `/courses` |
| `recette_creee` | succès `creerRecette` (`lib/recettes.ts`) |
| `foyer_rejoint` / `compte_supprime` | `PanneauFoyer` / route suppression (event client après succès) |

KPIs : activation (signup→`premier_planning_genere`), rétention W1/W4 (cohortes PostHog), fréquence de génération. **CSP** : ajouter l'origine PostHog EU à `connect-src` **avant** l'enforcement (Palier B / F-01).

### 7D.2 Emails de cycle de vie (US-40) — déclenchement & ciblage

**Décision : Vercel Cron → route protégée**, pas GitHub Actions. Raison : le `service_role` (US-31) et la clé Resend vivent **uniquement côté Vercel prod** → on évite de les propager à GitHub. Vercel Pro (US-35) débloque les crons fins.

- **Route** `app/api/cron/relance-hebdo/route.ts` (+ activation/bienvenue), protégée par `CRON_SECRET` (header vérifié) — exemptée de la garde proxy (`/api/*` déjà exempté, vérifié `proxy.ts:84`).
- **Ciblage « qui relancer »** = lecture **cross-utilisateurs** → impossible sous RLS (scope un seul user). Deux options : (a) **fonction `SECURITY DEFINER`** `utilisateurs_a_relancer(p_semaine)` renvoyant les emails à relancer ; (b) client **service_role** dans la route. Préférence (a) (surface minimale, logique en base, testable en `rollback`).
  - **Relance hebdo** : profils `optin_relance_hebdo = true` dont le **foyer n'a aucun `planning` pour la semaine prochaine** (le planning est foyer-scopé → relancer sur l'absence côté foyer, pas côté user). Un seul email par foyer suffit (dédupliquer par foyer pour ne pas spammer les co-membres).
  - **Activation** : `onboarding_complete = false` et compte créé il y a 2-3 j, non déjà relancé (drapeau `relance_activation_le`).
- **Bienvenue** : à la complétion de l'onboarding (event → envoi direct via une petite route, ou inclus dans l'email de confirmation Supabase). Garder simple.
- **Opt-out** : colonnes `profiles` (cf. §7.5 : `optin_relance_hebdo`, `optin_produit`) + **lien de désinscription** dans chaque email → route publique avec **token signé** (pas de session) qui bascule l'opt-out. Obligation RGPD (RG-42). Préférences éditables dans `/profil`.
- **Idempotence** : marquer l'envoi (`derniere_relance_hebdo_le`) pour ne pas ré-émettre si le cron repasse.

### 7D.3 Feedback in-app (US-38)

Table `feedback (id, user_id, foyer_id, categorie, message, contexte jsonb, cree_le)` + policy **INSERT** sous RLS (`user_id = auth.uid()`), pas de SELECT client (lecture côté admin/Supabase). Entrée discrète dans `/profil` (ou la nav). Anti-spam : réutiliser `limiteGeneration` généralisé en `limite(prefix, id)`. Acheminement : table consultable au dashboard, ou webhook (email/Discord) en bonus.

### 7D.4 Fondations freemium (US-44) — point de quota

**Le choke point existe déjà** : `limiteGeneration(user.id)` (`app/api/planning/generer/route.ts:38`). C'est **là** que le quota par tier se branchera. Préparation, **sans limite active** :
- Colonne **`tier`** (`profiles` ou `foyers`, défaut `'free'`) — au GRANT colonne si sur `profiles` (cf. ADR-09), **non éditable client** si elle pilote un quota (mieux : sur `foyers`, écrite par RPC).
- Usage **dérivable des events PostHog** (US-37) — pas besoin de table de compteur dédiée au départ.
- Généraliser `lib/rate-limit.ts` pour accepter un **plafond paramétrable** (le sliding window devient le squelette d'un quota quotidien/mensuel par tier). Inerte tant que `tier='free'` = pas de plafond produit.

### 7D.5 Acquisition (US-42/43) & push (US-41) — notes légères

- **Landing (US-42)** : `app/page.tsx` est déjà un hero public → l'étoffer (sections bénéfices, capture, FAQ, CTA). Ajouter `app/sitemap.ts` + `app/robots.ts` + données structurées `SoftwareApplication`. Liens légaux (US-29). Mesurer la conversion (US-37).
- **SEO contenu (US-43)** : réutiliser le pipeline `/aide` (Notion → SSG, #97) pour des articles d'acquisition, maillage interne vers l'app.
- **Push (US-41)** : ⚠️ **rouvre le périmètre PWA** — #71 a livré la PWA **sans service worker** (choix délibéré). Le push web **exige un service worker** (+ abonnement, VAPID, permission UX, iOS ≥ 16.4 app installée). Chantier **L**, **après** les emails (US-40 couvre la relance avec moins de friction). Priorité basse au lancement.

---

## 8. Palier B — Scalabilité technique (cartographié, raffinement ultérieur)

Non raffiné en détail cette session (hors priorité), mais à garder en vue pour la montée en charge :

- **B1 — Garde onboarding du proxy** : 1 read DB `profiles.onboarding_complete` **par navigation connectée** (ADR-09, « coût assumé en perso »). À l'échelle = latence + charge. → migrer vers un **claim JWT / cookie signé** mis à jour à la complétion de l'onboarding.
- **B2 — Rate-limiting global** : aujourd'hui Upstash ne couvre que `/api/planning/generer` et est **no-op** sans secrets. Étendre aux endpoints sensibles (signup/login/reset via les protections Supabase + éventuel proxy), activer les secrets en prod.
- **B3 — Catalogue `ingredient` writable par tout authentifié** (F-06 partiel) : vecteur de spam/vandalisme du catalogue partagé à l'échelle. → restreindre l'insertion (validation, modération, ou scoper).
- **B4 — CSP en enforcement** : passer de `Content-Security-Policy-Report-Only` à `Content-Security-Policy` après observation des violations (F-01).
- **B5 — Perf RLS & index** : `mon_foyer()` (`SECURITY DEFINER` lit `profiles`) évalué par ligne — auditer les index (`foyer_id`, `(foyer_id, semaine)`) et le coût des policies sous charge.
- **B6 — Quotas Realtime** : dimensionner connexions concurrentes / messages (postgres_changes planning + coches + presence) vs le tier Supabase retenu.

---

## 9. Récapitulatif — ce qui doit être vrai pour ouvrir au public

**Checklist « go public » (minimum) :**
- [ ] Pages légales + consentement signup (US-29) · cookies (US-30)
- [ ] Suppression de compte (US-31) · export (US-32)
- [ ] SMTP custom (US-33) · confirmation email + anti-énumération (US-34)
- [ ] Tiers prod Vercel/Supabase + backups (US-35/36)
- [ ] Politique mot de passe (US-25) · robustesse stockage/sync (US-26)
- [ ] Source maps Sentry décidées (US-28/#195)
- [ ] Analytics funnel + feedback en place pour observer le lancement (US-37/38)

Lots 5 (rétention) et 6 (acquisition) se déploient **pendant** la montée vers 1000 users/mois.
