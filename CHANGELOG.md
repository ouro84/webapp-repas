# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Monitoring d'erreurs Sentry (`@sentry/nextjs`) : erreurs client, serveur (RSC/route handlers via `onRequestError`) et edge ; sans tracing ni session replay pour préserver le quota gratuit. DSN via `NEXT_PUBLIC_SENTRY_DSN`
- Migrations Supabase CLI : `supabase` en devDependency, `supabase/config.toml`, baseline `20260606225900_init.sql` vérifiée contre le schéma prod ; historique de migrations marqué sur prod et staging
- `scripts/query-supabase.mjs` : exécution de SQL distant via l'API de management (contourne le blocage Avast du CLI Go en local)
- CI : application automatique des migrations — staging avant les e2e de chaque PR, prod via le job `migrate-prod` sur push `main` (après tests verts)
- Workflow keep-alive Supabase (`.github/workflows/supabase-keepalive.yml`) : ping REST de la prod et du staging lundi et jeudi 8h UTC pour éviter la mise en pause automatique du tier gratuit ; secrets `SUPABASE_URL` / `SUPABASE_ANON_KEY` ajoutés au coffre Actions (#15)
- Liste de courses cochable en magasin (US-05, RG-10 à RG-14, #19) : cocher/décocher un article (rayé + fin de catégorie, animation View Transitions avec repli `prefers-reduced-motion`), persistance locale des coches avec invalidation par quantité au remplacement d'un slot et réinitialisation à la regénération, compteur de progression « n/N » (fond de placard cochable mais hors compteur), bouton « Tout décocher », sections repliables
- Mini-stores localStorage partagés dans `lib/stockage.ts` (`storePlanning`, `storeCoches`) — le pattern `useSyncExternalStore` de la page planning est extrait et réutilisé par la page courses
- Sélection manuelle d'une recette pour un slot du planning (US-06, RG-15, #14) : sélecteur `<dialog>` natif (bottom sheet mobile / modale desktop) avec recherche insensible à la casse et aux accents, badge « déjà au planning », by-pass des contraintes de temps et d'unicité (choix éclairé) ; coches de la liste de courses conservées
- Nombre de personnes par repas (US-07, RG-16/17, #34) : stepper − / + sur chaque card du planning (défaut 2, borné [1;12]), la liste de courses met les quantités à l'échelle ×N/2 avec arrondi par type d'unité ; le réglage est conservé au changement de recette et réinitialisé à la regénération ; les plannings persistés antérieurs se relisent sans migration (champ `personnes` absent = 2)
- Accord en nombre des libellés de la liste de courses (US-08, RG-18, #33) : le nom des ingrédients à la pièce s'accorde selon la quantité (« 1 carotte » / « 3 carottes »), le libellé des unités conteneur aussi (« 2 sachets ») ; pluriel régulier conscient des connecteurs (« blancs de poulet ») + table d'exceptions (formes au pluriel, composés irréguliers, invariants) ; noms de masse jamais accordés (`lib/pluriels.ts`)
- Recettes en base de données — lecture (#2, PR1) : la source de vérité des recettes passe de `data/recettes.json` à Supabase, avec un catalogue **global** (74 recettes de base, lecture seule) amorcé par migration + des recettes **personnelles** à venir (CRUD en PR2/3). La génération du planning se fait désormais côté serveur (`/api/planning/generer`, lit les recettes sous RLS) ; le sélecteur et le remplacement aléatoire chargent la liste via `lib/recettes.ts`. Migration `..._recettes_globales.sql` (policies SELECT globales + seed idempotent), générée par `scripts/generer-seed-recettes.mjs`
- Recettes en base de données — création & édition (#2, PR2) : page `/recettes` (protégée) listant le catalogue global (lecture seule) et les recettes personnelles, avec recherche ; formulaire de création/édition (nom, temps, lignes d'ingrédients) déclenché par « Enregistrer » (RG-02) ; find-or-create des ingrédients (dédup nom + catégorie + fond de placard) ; l'édition d'une recette présente au planning courant met à jour la liste de courses immédiatement (RG-03) ; entrée de navigation « Recettes »
- Recettes en base de données — suppression & bonus (#2, PR3) : suppression d'une recette personnelle avec confirmation (RG-01) et garde-fou si elle est dans le planning courant ; duplication de n'importe quelle recette (y compris du catalogue, pour la personnaliser) ; alerte « vivier insuffisant » prévenant qu'il manque des recettes pour générer une semaine. Clôture #2.
- Annuler une regénération de planning (US-09, RG-19, #62) : un toast « Planning regénéré — Annuler » (~5 s) restaure le planning **et** les coches de la liste de courses à l'identique (inverse l'effacement RG-13). Snapshot mono-niveau persistant en `localStorage` (`planning_snapshot`, expire ~6 s) — survit donc à la navigation et au rechargement. La même mécanique couvre le remplacement de slot et la sélection manuelle ; raccourci clavier Ctrl/Cmd+Z (hors champs de saisie)
- Fiche d'identité d'une recette (US-10, RG-20, #32) : un clic sur le **nom du plat** d'une card du planning ouvre une fiche `<dialog>` (titre, badge temps, ingrédients) — la recette est déjà dans le slot, aucun appel réseau. Quantités **à l'échelle du slot** (même calcul RG-17 que la liste de courses) avec mention « pour N personnes » ; ingrédients scindés « à acheter » / « fond de placard ». Raccourci « Modifier » pour les recettes perso uniquement (deep-link `/recettes?edition=<id>`). Formatage quantité/unité extrait dans `lib/unites.ts` (partagé avec la liste de courses). *Saisonnalité hors périmètre tant que #P12 n'a pas livré la donnée.*
- Synchronisation multi-device — sync des coches (#6, US-13, PR3/3) : l'**état coché/décoché** de la liste de courses est désormais persisté en base et synchronisé entre appareils (même mécanique dirty-first / horloge serveur que le planning, dans `lib/sync.ts`) ; l'effacement à la regénération (RG-13) se propage aussi. Le hook `useSyncPlanning` devient `useSync` (planning + coches). **Clôture de #6.** e2e : scénario multi-device des coches.
- Synchronisation multi-device — sync du planning (#6, US-13, PR2/3) : le planning est désormais **persisté en base et synchronisé entre appareils** — la base est la source de vérité, `localStorage` un cache. Écriture poussée à chaque changement (génération, remplacement, personnes, restes, undo) via un gestionnaire centralisé (`lib/sync.ts`, abonné au store) ; hydratation au chargement (pages planning **et** courses) en **last-write-wins horodaté** ; **file de rejeu hors-ligne** + **indicateur de synchro** discret (bonus). Un device au cache vide récupère le planning depuis la base. La sync des **coches** arrive en PR3. e2e : nettoyage de l'état distant du compte de test en `beforeEach` + scénario multi-device.
- Synchronisation multi-device — socle de persistance (#6, US-13, PR1/3) : migration `..._sync_planning_coches` (colonnes `personnes`/`restes` sur `planning_slot`, `updated_at` sur `planning`, nouvelle table `etat_courses` pour les coches en JSONB, RLS propriétaire) + couche d'accès `lib/persistance.ts` (charger/sauvegarder planning et coches) et adaptateurs DB→domaine (`dbPlanningToDomain`). La base devient la source de vérité (localStorage = cache), avec résolution last-write-wins — **câblage hydratation/écriture à venir en PR2 (planning) et PR3 (coches)**. ADR-02 révisé (lève la dette « persistance hors périmètre »).
- Gestion des restes (US-12, RG-22, #81) : marquer un slot repas comme « Restes » (bouton sur la card **ou** option « Restes » dans le sélecteur) → ce repas n'est pas cuisiné et **disparaît de la liste de courses**. Card atténuée sans badge de temps ni stepper ni fiche, icône dédiée ; bouton « Cuisiner » pour revenir (la recette planifiée est conservée). Flag par slot (`JourPlanning.restes`) ; remplacer/choisir une recette efface le flag ; la (re)génération repart sans restes. Réversible via l'undo (#62).
- Générer un planning pour une semaine future (US-11, RG-21, #55) : sélecteur de semaine cible (stepper ‹ › borné de la semaine courante à +6) sur la page planning ; la génération vise la semaine choisie. Défaut intelligent : **semaine prochaine le week-end** (JTBD « courses du week-end d'avant »). Libellés relatifs (« Cette semaine / Semaine prochaine / Dans N semaines ») + toast contextualisé (« Planning généré — Semaine du … »). Plage **validée côté serveur** dans `POST /api/planning/generer`. Mono-actif : générer une autre semaine remplace le planning courant (réversible via undo, #62) — l'historique multi-semaines reste pour #P08. Logique calendaire centralisée dans `lib/semaines.ts` (`semaineISO`, `formaterSemaine` extraits + helpers).
- Déjeuners en semaine — 14 repas (US-01/US-02, RG-01, #3) : le planning génère désormais un **déjeuner ET un dîner chaque jour** (14 repas au lieu de 9). Éligibilité par slot (jour × type de repas) : dîner de semaine = "rapide", déjeuner de semaine = "rapide"/"normal", week-end = toutes recettes ; les déjeuners de semaine sont remplaçables/sélectionnables/consultables comme les autres slots. Table d'éligibilité `tempsEligibles` centralisée (prépare #P09). Alerte de vivier enrichie par palier (≥ 14 recettes, dont ≥ 10 rapide/normal, dont ≥ 5 rapide). Sur mobile, les deux repas d'un jour s'affichent côte à côte dès `sm`. Les plannings persistés à 9 repas restent lisibles (champ `dejeuner` gardé optionnel).

### Modifié

- Les tests e2e en CI utilisent l'instance Supabase staging (secrets `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`) au lieu de la prod
- Lot de corrections issues de l'audit UI/UX (#51) :
  - Messages d'erreur d'auth traduits en français et actionnables (#58) : `lib/messages-auth.ts` mappe les codes/messages Supabase, repli générique — plus de texte anglais brut
  - Badges de temps aux tokens du design system (#61) : rapide = `brand`, normal/long = `accent` (terracotta), fin du rouge réservé aux erreurs ; icône horloge sur « long », texte `accent-700` (nouveau token, contraste AA) — le sens n'est plus porté par la couleur seule
  - Génération du planning synchrone sans écran de chargement plein (#63) : la mise en page reste stable, suppression du `setTimeout(300)` artificiel
  - Grille planning desktop à partir de `lg` (≥ 1024px) au lieu de `md` (#64) : liste verticale sur tablette, plus de cellules compressées vers 1000px
  - Header planning empilé sur mobile (#65) : le titre prend toute la largeur (≤ 2 lignes), actions sur une rangée dédiée — le premier repas remonte au-dessus de la ligne de flottaison
- Pages login/signup alignées sur le design system (#57) et formulaire d'auth accessible (#60) : composant partagé `FormulaireAuth` aux couleurs brand (boutons `rounded-full bg-brand-600`, inputs `border-brand-200`, focus `outline-brand-600`), autocomplete email + mot de passe, toggle afficher/masquer le mot de passe, erreur en `role="alert"` avec retour du focus, bouton en chargement avec spinner + `aria-busy`, `<main id="contenu">` pour le skip link

## [1.0.1] - 2026-06-06

### Modifié

- Remplacement du jeu de démonstration par 74 vraies recettes dans `data/recettes.json` ; ancien jeu conservé en référence dans `data/recettes_25random.json` (#43)
- Découplage des tests du dataset réel : fixtures figées (`tests/fixtures/recettes.ts`) pour Vitest et Playwright, le dataset peut évoluer sans casser de test (#43)
- Mises à jour de dépendances (Dependabot) : `actions/checkout` v6, `actions/setup-node` v6, `actions/upload-artifact` v7, `react`/`react-dom` 19.2.7, `typescript` 6.0.3, `@types/node` 25 (#36–#42)

### Ajouté

- Configuration Dependabot : surveillance hebdomadaire npm + GitHub Actions, groupage des mises à jour non-majeures (#35)
- Validation structurelle du dataset de recettes (`tests/recettes-dataset.test.ts`) : ids uniques, énumérations valides, vivier générable (#43)
- Étape ESLint dans le workflow CI — le lint n'était couvert ni par le build ni par les tests (#44)
- Règle de mise à jour de `CLAUDE.md` : le fichier est un critère de merge (#47)

### Corrigé

- Retour à ESLint 9 : ESLint 10 est incompatible avec `eslint-plugin-react` 7.x embarqué par `eslint-config-next` ; les majeures d'eslint sont ignorées par Dependabot jusqu'au support de la v10 (#44)

## [1.0.0] - 2026-06-05

### Ajouté

- Génération automatique d'un planning de 7 repas
- Algorithme avec contraintes de temps (RG-01 à RG-04, slots contraints en premier)
- Remplacement individuel d'un repas (régénération partielle)
- Liste de courses agrégée depuis le planning (RG-05, fond de placard)
- Authentification Supabase (email/password)
- Design system Tailwind v4 (palette brand/accent/canvas)
- CI GitHub Actions (Vitest + Playwright)
- Déploiement Vercel avec preview deployments

[Unreleased]: https://github.com/ouro84/webapp-repas/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ouro84/webapp-repas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ouro84/webapp-repas/releases/tag/v1.0.0
