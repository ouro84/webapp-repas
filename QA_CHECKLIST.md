# Checklist QA — avant chaque déploiement en production

> **Comment l'utiliser**
> 1. Copier-coller la checklist complète dans la description de la PR à déployer (ou travailler directement dans ce fichier).
> 2. Dérouler chaque section sur l'**URL de preview Vercel** de la branche (jamais sur la prod — ADR-08), en commençant par mobile.
> 3. Cocher les cases `[x]` au fur et à mesure. Tout échec = correction avant merge.
> 4. Committer la checklist cochée avec la PR (trace de la validation), puis remettre les cases à `[ ]` après le déploiement.

---

## 1. Fonctionnel

### Authentification
- [ ] Connexion avec identifiants valides → arrivée directe sur `/planning`
- [ ] Connexion avec mauvais mot de passe → message d'erreur explicite, pas de redirection
- [ ] Accès à `/planning` ou `/courses` sans session → redirection vers `/login`
- [ ] Accès à `/login` avec une session active → redirection vers `/planning`

### Génération du planning (US-01)
- [ ] "Générer mon planning" produit 7 jours, lundi → dimanche
- [ ] Un déjeuner **et** un dîner chaque jour (14 repas)
- [ ] Dîner de semaine = "Rapide" uniquement ; déjeuner de semaine = "Rapide"/"Normal" ; week-end = toutes recettes (RG-01)
- [ ] Aucune recette ne se répète dans la semaine (RG-02)
- [ ] Deux générations successives donnent des plannings différents (RG-03)
- [ ] "Regénérer" écrase le planning précédent
- [ ] Toast "Planning généré" affiché
- [ ] Le numéro de semaine est lisible ("Semaine du 1 juin 2026")

### Remplacement d'un repas (US-04)
- [ ] "↺ changer" remplace uniquement le slot ciblé, les autres restent intacts
- [ ] La recette de remplacement respecte la contrainte du slot (jour × type de repas, RG-01)
- [ ] Toast "Recette remplacée" affiché
- [ ] Si plus aucune recette éligible : message "Pas de recette disponible" dans le slot + toast d'erreur (RG-04)

### Liste de courses (US-03)
- [ ] "Liste de courses →" affiche la liste issue du planning courant
- [ ] Les quantités d'un même ingrédient (même unité) sont additionnées (RG-05)
- [ ] Un ingrédient présent en deux unités différentes apparaît sur deux lignes, sans conversion
- [ ] Les ingrédients fond de placard sont dans leur section, avec la mention "À vérifier avant d'acheter" (F-09)
- [ ] Le compteur d'articles correspond au contenu affiché
- [ ] "← Planning" ramène au planning sans le modifier
- [ ] Un repas marqué "Restes" (bouton card ou sélecteur) affiche "Restes", sans badge ni stepper, et ses ingrédients disparaissent de la liste de courses ; "Cuisiner" le restaure (US-12)

### Persistance (F-11)
- [ ] Fermer puis rouvrir l'app : le planning généré est toujours là
- [ ] Un remplacement de repas survit aussi au rechargement
- [ ] Sans planning : `/courses` affiche l'invite "Génère d'abord un planning" avec le lien
- [ ] Sync multi-device (US-13) : générer/éditer **et cocher** sur un appareil → se connecter sur un autre (ou vider le cache local) → le même planning **et le même état coché** sont retrouvés depuis la base ; indicateur "Sauvegarde…/Hors-ligne" cohérent
- [ ] Historique (US-14) : navigateur ‹ ← / → › change la semaine (passé/futur) ; semaine courante marquée ; la liste de courses suit la semaine (n° affiché) ; revenir sur une semaine générée la retrouve intacte
- [ ] Confirmation semaine passée (US-14, RG-24) : régénérer ou modifier un repas (changer/sélectionner/restes) d'une **semaine passée** déjà planifiée ouvre une confirmation ; Annuler laisse intact, Confirmer applique. Générer une semaine passée **vide** ne demande rien ; le stepper personnes non plus
- [ ] Rétention (US-14, RG-24) : les semaines de plus de 12 semaines ne s'accumulent pas indéfiniment en base (purge au chargement de session)
- [ ] Réglages (US-15, RG-25) : l'engrenage de la nav ouvre `/reglages` ; on règle le plafond de chaque créneau (segmenté Rapide/Normal/Long) et le nombre de personnes par défaut
- [ ] Réglages — enregistrement explicite : « Enregistrer » est désactivé tant que rien ne change ; un changement non enregistré est perdu au rechargement ; après enregistrement, la valeur persiste (rechargement / autre appareil)
- [ ] Réglages — effet : la génération complète **et** le « ↺ changer » respectent les plafonds ; un planning généré porte le nombre de personnes par défaut choisi
- [ ] Réglages — bonus : « Réinitialiser » repositionne sur les défauts (sans sauver) ; l'aperçu « N recettes éligibles » se met à jour ; une config infaisable bloque l'enregistrement avec un message

### Recettes végétariennes (US-16, RG-26)
- [ ] Création/édition : la case « Recette végétarienne » est **pré-cochée** quand aucun ingrédient n'est « viandes-poissons » ; on peut la corriger manuellement ; le flag persiste (rechargement / round-trip base)
- [ ] Affichage : un badge « Végétarien » (feuille) apparaît sur la fiche, la liste des recettes et la card du planning pour les recettes végé
- [ ] Filtre : « végétariennes seulement » dans la liste ne laisse que les recettes végé
- [ ] Catalogue global : les recettes globales sans viande/poisson portent le badge (auto-tag heuristique)
- [ ] Préférence de génération (RG-26) : sur `/reglages`, activer « privilégier le végétarien » sur un créneau, enregistrer → après génération, ce créneau reçoit des recettes végé en priorité ; l'aperçu « N recettes végétariennes éligibles » s'affiche quand l'interrupteur est actif ; le réglage persiste (rechargement)
- [ ] Avertissement végé souple : avec trop peu de recettes végé, la génération aboutit quand même et un toast signale le nombre de repas non végé ; « ↺ changer » sur un créneau végé sans recette végé disponible remplace quand même et prévient

## 2. UI / Responsive

### Mobile (< 768 px — tester en premier, RG-06)
- [ ] Planning en liste verticale, un bloc par jour (RG-08)
- [ ] Tout est utilisable d'une main en portrait ; aucun défilement horizontal
- [ ] Les boutons "↺ changer" se tapent facilement au doigt (zone ≥ 44 px)
- [ ] Liste de courses lisible : nom à gauche, quantité à droite

### Desktop (≥ 768 px)
- [ ] Planning en grille 7 colonnes avec en-têtes Lun → Dim (RG-07)
- [ ] Largeur de la liste de courses plafonnée (pas de lignes interminables)

### États d'interface (RG-09 — sur chaque écran)
- [ ] État vide : message + action claire (planning ET courses)
- [ ] État chargement : "Génération du planning…" / "Chargement…" visibles
- [ ] État erreur : message explicite + bouton "Réessayer"

### Design system & accessibilité
- [ ] Badges temps de préparation : Rapide = vert, Normal = jaune, Long = rouge, avec libellé texte
- [ ] NavBar : lien actif mis en évidence, navigation Planning/Courses fonctionnelle
- [ ] Identité de marque (#59) : logo SVG (nav + hero) au vert brand, nom « On mange quoi ? » + baseline ; aucun emoji (🥗 supprimé) ; bouton « changer » avec icône Lucide (plus de glyphe ↺) ; favicon et image OG affichés
- [ ] Navigation au clavier : skip link "Aller au contenu" au premier Tab, focus visible partout
- [ ] Toasts affichés en bas au centre, lisibles, disparaissent seuls

## 3. Données

- [ ] `data/recettes.json` : JSON valide, ~25 recettes minimum
- [ ] Chaque recette a un `id` unique, un `nom`, un `tempsPreparation` du référentiel (rapide/normal/long)
- [ ] Toutes les unités et catégories appartiennent aux référentiels de la section 5 des specs
- [ ] Toutes les quantités sont strictement positives
- [ ] Discipline de saisie (section 5.2) : un même ingrédient garde le même flag `fondDePlacard` et la même `categorie` dans toutes les recettes
- [ ] Assez de recettes pour 14 slots : ≥ 14 au total, dont ≥ 10 "rapide"/"normal", dont ≥ 5 "rapide" (+ marge de remplacement)

## 4. Régressions

- [ ] `npm run test:run` — tests unitaires verts (130 attendus)
- [ ] `npm run test:e2e` — tests e2e verts
- [ ] `npx tsc --noEmit` — zéro erreur TypeScript
- [ ] `npm run lint` — zéro erreur ESLint
- [ ] `npm run build` — build de production vert
- [ ] Preview Vercel de la branche validée avant merge (ADR-08)
- [ ] Parcours complet sur la preview : login → génération → remplacement → courses → rechargement
- [ ] Avant la **toute première** mise en production : réactiver la confirmation email Supabase (Authentication → Providers → Email → "Confirm email" — note ADR-02)
