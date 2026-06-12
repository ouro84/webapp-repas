# Spécifications fonctionnelles — Webapp Repas de la semaine

> Version : 1.1  
> Date : 2026-06-02  
> Statut : **Validé** (Phase 1 — Conception produit)

---

## 1. Contexte & objectif

> **Identité produit (#59) :** l'app s'appelle **« On mange quoi ? »** (abrégée « OMQ »), baseline **« La question du soir a enfin sa réponse »**. Logo : assiette + fourchette en négatif, aux couleurs `brand`.

### Problème

Chaque semaine, planifier les repas et établir la liste de courses est chronophage et répétitif. Le manque d'inspiration entraîne des repas qui reviennent trop souvent.

### Solution

Une webapp qui génère automatiquement un planning de repas pour la semaine à partir d'une liste de recettes connues, et produit la liste de courses associée, agrégée et prête à l'emploi.

### Objectif produit

Réduire à zéro l'effort de planification hebdomadaire des repas, du choix des recettes jusqu'à la liste de courses.

---

## 2. Persona & Job-to-be-done

### Persona

**Arnaud — Cuisinier actif en couple**

- Cuisine pour 2 personnes en semaine
- Le week-end : invités fréquents ou cuisine en double portion pour les restes
- Répertoire de ~30 recettes maîtrisées
- Fait les courses une fois par semaine
- Usage : **mobile-first** — toutes les étapes (planification, consultation, courses) sont effectuées principalement sur smartphone

### Job-to-be-done

> *"Quand je dois préparer ma semaine, je veux générer un planning repas varié depuis mes recettes, avec la liste de courses adaptée, pour arriver aux courses sans effort de planification."*

---

## 3. Périmètre

### MVP — ce qu'on construit

| # | Feature | Description |
|---|---------|-------------|
| F-01 | Liste de recettes | ~30 recettes stockées dans `/data/recettes.json` |
| F-02 | Temps de préparation | Chaque recette est classée : Rapide / Normal / Long |
| F-03 | Flag "fond de placard" | Chaque ingrédient peut être marqué comme fond de placard (sel, huile, épices…) |
| F-04 | Génération du planning | Génère, pour la semaine choisie (courante → +6), un planning sur 7 jours : un déjeuner **et** un dîner chaque jour (14 repas) |
| F-05 | Éligibilité par slot | Éligibilité selon le jour **et** le type de repas (RG-01) : dîner de semaine = Rapide ; déjeuner de semaine = Rapide/Normal ; tous les repas de week-end = toutes recettes |
| F-06 | Pas de répétition | Une même recette n'apparaît pas deux fois dans la même semaine |
| F-07 | Remplacement d'un repas | Remplacer un slot individuel sans modifier le reste du planning |
| F-08 | Liste de courses agrégée | Ingrédients regroupés par catégorie, quantités additionnées si doublons |
| F-09 | Section fond de placard | Ingrédients flaggués affichés à part avec mention "à vérifier avant d'acheter" |
| F-10 | Responsive (mobile-first) | L'app est mobile-first. Vue desktop disponible (grille 7 colonnes) |
| F-11 | Persistance du planning | Le planning généré est sauvegardé localement (localStorage) — survit à la fermeture de l'app |
| F-12 | Liste de courses cochable | Cocher/décocher les articles en magasin : rayé + fin de catégorie, progression, persistance locale (#19) |

### Nice-to-have — backlog futur

> **Note :** cette liste est indicative et sera amenée à évoluer en fonction de l'usage réel. Elle est gérée dans GitHub Projects (configuré en Phase 3). Les priorités peuvent être révisées à tout moment.

| Feature | Note |
|---------|------|
| CRUD recettes | Saisir / modifier / supprimer des recettes via l'interface |
| Gestion des portions dynamiques | Adapter les quantités selon le nombre de personnes |
| Restes / double portion | Cuire pour 4 afin d'avoir des restes |
| Historique des plannings | Consulter les plannings des semaines passées |
| Comptes utilisateurs / auth | Données personnalisées par utilisateur, sync multi-device |
| Partage de la liste de courses | Export, envoi par email ou lien |

---

## 4. User stories (format BDD)

### US-01 — Générer un planning

> **En tant qu'** utilisateur, je veux générer un planning de repas pour la semaine, afin de ne pas avoir à réfléchir à ce que je vais cuisiner chaque jour.

**Comportement :**
> **Given** l'utilisateur est sur la page d'accueil  
> **When** il clique sur "Générer mon planning"  
> **Then** l'app affiche un planning de 7 jours : un déjeuner **et** un dîner chaque jour du lundi au dimanche (14 repas) — sans répétition de recette dans la semaine

---

### US-02 — Contrainte temps de préparation

> **En tant qu'** utilisateur, je veux que les repas de semaine soient rapides à préparer, afin de ne pas me retrouver avec un bœuf bourguignon un mardi soir.

**Comportement :**
> **Given** un planning est en cours de génération  
> **When** le slot concerné est un **dîner** de semaine (lundi → vendredi)  
> **Then** seules les recettes "Rapide" sont éligibles (le soir, en semaine, on va au plus court)

> **Given** un planning est en cours de génération  
> **When** le slot concerné est un **déjeuner** de semaine (lundi → vendredi)  
> **Then** les recettes "Rapide" ou "Normal" sont éligibles

> **Given** un planning est en cours de génération  
> **When** le slot concerné est un repas de week-end (samedi ou dimanche), déjeuner ou dîner  
> **Then** toutes les recettes sont éligibles, y compris "Long"

---

### US-03 — Générer la liste de courses

> **En tant qu'** utilisateur, je veux obtenir la liste de courses issue de mon planning, afin de faire mes courses sans réfléchir et sans allers-retours dans le magasin.

**Comportement :**
> **Given** un planning a été généré  
> **When** l'utilisateur clique sur "Voir la liste de courses"  
> **Then** l'app affiche les ingrédients regroupés par catégorie, avec les quantités additionnées en cas de doublon, et une section séparée pour les ingrédients "fond de placard"

---

### US-04 — Remplacer un repas

> **En tant qu'** utilisateur, je veux pouvoir remplacer un repas spécifique du planning, afin de ne pas devoir tout regénérer si un seul repas ne me convient pas.

**Comportement :**
> **Given** un planning est affiché  
> **When** l'utilisateur clique sur "↺ changer" sur un slot donné  
> **Then** l'app remplace ce repas par une autre recette éligible (même contrainte de temps de préparation selon le jour **et** le type de repas, RG-01), sans modifier les autres slots du planning

> **Given** l'utilisateur clique sur "↺ changer"  
> **When** toutes les recettes éligibles sont déjà utilisées dans la semaine  
> **Then** l'app affiche le message : "Pas de recette disponible"

---

### US-05 — Cocher les articles de la liste de courses

> **En tant qu'** utilisateur en train de faire mes courses, je veux pouvoir identifier les articles que j'ai chez moi ou mis dans mon chariot, afin de ne pas les ajouter en doublon ou en oublier.

**Comportement :**
> **Given** je suis sur la liste de courses  
> **When** je clique sur un article non coché  
> **Then** il se raye, se grise et passe en fin de liste de sa catégorie (transition animée, `prefers-reduced-motion` respecté)

> **Given** un article est coché  
> **When** je clique dessus  
> **Then** il se dé-raye et reprend sa place alphabétique parmi les articles non cochés de sa catégorie

> **Given** des articles sont cochés  
> **When** je recharge la page ou rouvre le navigateur  
> **Then** les coches sont conservées

> **Given** des articles sont cochés  
> **When** je remplace un repas du planning  
> **Then** seules les coches des articles dont la quantité a changé (ou qui ont disparu) sont invalidées

> **Given** des articles sont cochés  
> **When** je regénère entièrement le planning  
> **Then** toutes les coches sont réinitialisées

> **Given** au moins un article est coché  
> **When** je clique sur « Tout décocher »  
> **Then** toutes les coches (y compris fond de placard) sont retirées

> **Given** je suis sur la liste de courses  
> **When** je clique sur l'en-tête d'une catégorie  
> **Then** la section se replie/déplie (état non persisté)

---

### US-06 — Sélectionner manuellement une recette

> **En tant qu'** utilisateur, je veux pouvoir modifier le repas d'un slot généré, afin de sélectionner une recette spécifique dont j'ai envie.

**Comportement :**
> **Given** je suis sur le planning  
> **When** je clique sur « Sélectionner » sur un slot  
> **Then** un sélecteur s'ouvre (bottom sheet mobile / modale desktop), titré du slot visé, avec un champ de recherche en tête et la liste alphabétique complète des recettes, chacune avec son badge de temps

> **Given** le sélecteur est ouvert  
> **When** je tape dans le champ de recherche  
> **Then** la liste est filtrée en direct, insensible à la casse et aux accents

> **Given** le sélecteur est ouvert  
> **When** je choisis une recette  
> **Then** le slot visé est remplacé, les autres slots inchangés, le sélecteur se ferme — les coches de la liste de courses sont conservées (RG-12)

> **Given** une recette est déjà présente dans le planning  
> **When** le sélecteur l'affiche  
> **Then** elle porte un badge « déjà au planning » et reste sélectionnable (RG-15)

> **Given** le sélecteur est ouvert  
> **When** je presse Échap, clique sur le fond ou sur le bouton de fermeture  
> **Then** il se ferme sans modifier le planning, le focus revient au bouton d'origine

---

### US-07 — Nombre de personnes par repas

> **En tant qu'** utilisateur, je veux modifier le nombre de personnes par repas, afin d'avoir une liste de courses correcte si je reçois du monde un jour.

**Comportement :**
> **Given** je suis sur le planning  
> **When** je modifie le nombre de personnes d'un repas via le stepper de sa card (− / +)  
> **Then** le nombre est visible sur la card et la liste de courses reflète immédiatement les quantités mises à l'échelle

> **Given** un repas est à 1 personne (ou 12)  
> **When** je tente de descendre (ou monter) encore  
> **Then** le bouton est inactif — le nombre reste dans [1 ; 12]

> **Given** un repas est réglé à 4 personnes  
> **When** je change sa recette (aléatoire ou sélection manuelle)  
> **Then** le repas reste à 4 personnes (RG-16)

> **Given** je (re)génère entièrement le planning  
> **When** le nouveau planning s'affiche  
> **Then** tous les repas sont à 2 personnes (RG-16)

> **Given** un article de la liste de courses est coché  
> **When** je modifie le nombre de personnes d'un repas qui contribue à cet article  
> **Then** sa quantité agrégée change et sa coche est invalidée (RG-12) — les autres coches sont conservées

---

### US-08 — Accord en nombre des libellés de courses

> **En tant qu'** utilisateur, je veux que les libellés de la liste de courses s'accordent en nombre selon la quantité, afin d'avoir une liste lisible et naturelle.

**Comportement :**
> **Given** je visualise la liste de courses  
> **When** un ingrédient vendu à la pièce a une quantité ≥ 2  
> **Then** son nom est au pluriel (« 3 carottes »)

> **Given** un ingrédient vendu à la pièce a une quantité < 2  
> **When** je visualise la liste  
> **Then** son nom est au singulier (« 1 carotte »)

> **Given** un ingrédient mesuré (g, ml, c.à.s…) ou un nom de masse  
> **When** la quantité varie  
> **Then** son nom reste invariable (« 200 g de beurre »)

### US-09 — Annuler une regénération

> **En tant qu'** utilisateur ayant regénéré par erreur, je veux pouvoir annuler afin de retrouver mon planning précédent à l'identique.

**Comportement :**
> **Given** un planning existant (éventuellement ajusté slot par slot, avec des coches faites sur la liste de courses)  
> **When** je clique sur « Regénérer »  
> **Then** un toast « Planning regénéré — Annuler » s'affiche ~5 s

> **Given** ce toast est affiché  
> **When** je clique « Annuler » (ou je fais Ctrl/Cmd+Z)  
> **Then** le planning **et** les coches sont restaurés à l'identique (RG-19) et le toast disparaît

> **Given** la première génération (aucun planning préalable)  
> **When** je génère  
> **Then** aucun undo n'est proposé — il n'y a rien à restaurer

> **Note :** la même mécanique d'annulation couvre aussi un remplacement de slot (US-04) ou une sélection manuelle (US-06) — cf. RG-19.

### US-10 — Consulter la fiche d'une recette

> **En tant qu'** utilisateur, je veux consulter les ingrédients d'une recette afin de savoir si je peux la faire sans rien avoir à acheter.

**Comportement :**
> **Given** je suis sur la page planning  
> **When** je clique sur le nom du plat d'un slot  
> **Then** la fiche d'identité de la recette s'affiche (titre, temps, ingrédients), sans quitter la page

> **Given** la fiche est ouverte sur un slot réglé à N personnes  
> **When** je lis les quantités  
> **Then** elles sont mises à l'échelle pour N personnes (RG-20), cohérentes avec la liste de courses

> **Given** la fiche d'une recette **personnelle**  
> **When** je veux la modifier  
> **Then** un raccourci « Modifier » ouvre son édition ; pour une recette du catalogue global (lecture seule), ce raccourci est absent

### US-11 — Générer pour une semaine future

> **En tant qu'** utilisateur, je veux générer le planning d'une semaine à venir, afin d'anticiper mes courses (les faire le week-end précédant la semaine planifiée).

**Comportement :**
> **Given** je suis sur la page planning  
> **When** je choisis une semaine cible (de la semaine courante jusqu'à 6 semaines plus tard) puis je clique sur « Générer »  
> **Then** le planning généré porte cette semaine et devient le planning actif (RG-21)

> **Given** un planning actif existe pour une autre semaine  
> **When** je génère pour une nouvelle semaine cible  
> **Then** il remplace l'actif (réversible via l'annulation, US-09) — une seule semaine est active à la fois

> **Given** je suis un samedi ou un dimanche  
> **When** j'arrive sur la page planning sans planning actif  
> **Then** la semaine cible proposée par défaut est la **semaine prochaine** (RG-21)

### US-12 — Marquer un repas en « restes »

> **En tant qu'** utilisateur ayant des restes au frigo, je veux marquer un repas comme « restes » afin de ne pas le cuisiner ni l'ajouter à ma liste de courses.

**Comportement :**
> **Given** un planning est affiché  
> **When** je marque un slot comme « Restes » (bouton de la card ou option du sélecteur)  
> **Then** ce slot affiche « Restes », n'est pas cuisiné et ses ingrédients **n'apparaissent pas** dans la liste de courses (RG-22)

> **Given** un slot est en « Restes »  
> **When** je clique « Cuisiner » (ou je choisis/remplace une recette)  
> **Then** le slot redevient un repas cuisiné normal

### US-13 — Synchronisation multi-device

> **En tant qu'** utilisateur connecté, je veux retrouver mon planning et ma liste de courses (avec l'état coché) quel que soit l'appareil, afin de planifier sur ordinateur et faire mes courses sur smartphone.

**Comportement :**
> **Given** j'ai généré ou édité un planning sur un appareil  
> **When** je me connecte sur un autre appareil  
> **Then** j'y retrouve le même planning (la base fait foi ; le dernier changement gagne, RG-23)

> **Given** je coche des articles de ma liste de courses sur un appareil  
> **When** je consulte la liste sur un autre appareil  
> **Then** j'y retrouve le même état coché/décoché

### US-14 — Naviguer entre les semaines (historique)

> **En tant qu'** utilisateur, je veux naviguer entre les semaines (passées et futures) afin de consulter un planning antérieur (s'inspirer, vérifier) ou préparer une semaine à venir.

**Comportement :**
> **Given** je suis sur la page planning  
> **When** je clique sur « semaine précédente » / « semaine suivante »  
> **Then** le planning de cette semaine s'affiche (ou un état vide à générer), avec sa liste de courses associée (RG-24)

> **Given** je navigue  
> **When** j'observe le navigateur  
> **Then** la **semaine courante** est visuellement identifiable parmi les autres (RG-24)

> **Given** j'ai généré un planning pour une semaine  
> **When** je quitte l'app puis y reviens (déconnexion/reconnexion)  
> **Then** ce planning et ses coches sont retrouvés à l'identique (déjà couvert par US-13)

> **Given** j'affiche une semaine **passée** qui a déjà un planning  
> **When** je régénère le planning ou modifie un de ses repas  
> **Then** une **confirmation** m'est demandée avant d'écraser ce planning enregistré (RG-24)

---

### US-15 — Paramétrer ses règles de génération (#45, P09)

> **En tant qu'** utilisateur, je veux définir mes propres règles de génération afin que l'app respecte mes contraintes personnelles, sans impacter les autres utilisateurs.

**Comportement :**
> **Given** je suis sur la page de réglages  
> **When** j'enregistre de nouveaux paramètres (bouton explicite, pas d'enregistrement à la volée)  
> **Then** la prochaine génération — complète **ou** unitaire — les applique (RG-25)

> **Given** je n'ai jamais touché à mes réglages  
> **When** j'ouvre la page  
> **Then** ils sont préremplis avec les valeurs par défaut historiques (RG-25)

---

### US-16 — Repas végétariens (#86, P10)

> **En tant qu'** utilisateur, je veux identifier les recettes végétariennes et privilégier des repas végés sur certains créneaux afin d'améliorer mon mode de vie.

**Comportement :**
> **Given** je crée ou édite une recette  
> **When** je la marque « végétarienne »  
> **Then** le flag est enregistré et affiché (fiche, liste, card du planning) (RG-26)

> **Given** je consulte la liste des recettes  
> **When** j'active le filtre « végétariennes seulement »  
> **Then** seules les recettes végétariennes sont listées (RG-26)

> **Given** j'ai réglé « privilégier le végétarien » sur un créneau (page Réglages)  
> **When** je génère un planning (ou remplace un repas via « ↺ changer »)  
> **Then** ces créneaux reçoivent en priorité des recettes végétariennes ; si le vivier végé est insuffisant, la génération aboutit quand même et **m'avertit** (RG-26)

---

### US-17 — Accompagnement & au moins un légume par jour (#49, P11)

> **En tant qu'** utilisateur, je veux identifier l'accompagnement de mes recettes (féculents / légumes) et garantir au moins un repas « légumes » par jour afin d'avoir une alimentation équilibrée.

**Comportement (volet recette — PR1) :**
> **Given** je crée ou édite une recette  
> **When** je choisis son accompagnement (« Féculents », « Légumes » ou « Aucun / non précisé »)  
> **Then** le choix est enregistré et affiché (fiche, liste, card du planning) (RG-27)

> **Given** je crée une recette  
> **When** le formulaire s'ouvre  
> **Then** l'accompagnement est **pré-suggéré par heuristique** (nom des ingrédients), suggestion que je peux corriger ou effacer (RG-27)

**Comportement (volet génération) :**
> **Given** j'ai activé « au moins un repas légumes par jour » (page Réglages)  
> **When** je génère un planning (ou remplace un repas via « ↺ changer »)  
> **Then** chaque jour reçoit si possible au moins un repas « légumes » ; si le vivier est insuffisant, la génération aboutit quand même et **m'avertit** du nombre de jours non honorés (RG-27)

---

### US-18 — Recettes de saison (#23, P12)

> **En tant qu'** utilisateur, je veux que le planning privilégie les fruits et légumes de saison afin de consommer de façon responsable.

**Comportement (volet recette — PR1) :**
> **Given** je crée ou édite une recette  
> **When** je sélectionne ses saisons (printemps / été / automne / hiver, plusieurs possibles — RG-01)  
> **Then** elles sont enregistrées et affichées (fiche, liste, card) ; laisser vide = toute l'année (RG-28)

> **Given** je crée une recette  
> **When** le formulaire s'ouvre  
> **Then** les saisons sont **pré-suggérées par heuristique** (à partir des ingrédients), suggestion que je peux corriger (RG-28)

> **Given** je consulte la liste des recettes  
> **When** je filtre par saison  
> **Then** seules les recettes de cette saison (saison incluse ou toute-l'année) sont listées (RG-28)

**Comportement (volet génération) :**
> **Given** la saisonnalité est activée (réglage, ON par défaut)  
> **When** je génère (ou régénère, ou « ↺ change » un repas) pour une semaine donnée  
> **Then** seules les recettes de la saison de cette semaine sont proposées ; si le vivier de saison est insuffisant, le planning est complété hors-saison et **je suis averti** (RG-28)

> **Given** j'ouvre le sélecteur manuel d'une recette (US-06)  
> **When** je choisis une recette  
> **Then** **toutes** les recettes restent proposées, hors saison comprises (RG-03 de #23 → RG-28)

### US-19 — Partager son foyer : inviter / rejoindre / quitter (#56, P24)

> **En tant qu'** utilisateur, je veux partager recettes, planning et liste de courses avec les autres membres de mon foyer, afin que nous organisions les repas ensemble.

**Comportement (inviter) :**
> **Given** je suis dans mon foyer  
> **When** je génère un **code d'invitation** et le partage (copier, lien, QR ou partage natif)  
> **Then** tout membre peut le (re)générer (gouvernance plate, RG-30) ; il est **valable 7 jours** et **réutilisable** jusqu'à expiration (RG-29)

**Comportement (rejoindre) :**
> **Given** je suis **seul** dans mon foyer  
> **When** je saisis un code d'invitation valide  
> **Then** je rejoins le foyer cible, **mes recettes personnelles y sont fusionnées** (collisions de noms conservées, RG-33), et un **assistant de dédoublonnage** m'est proposé

> **Given** je suis déjà dans un foyer **partagé**  
> **When** je tente d'en rejoindre un autre  
> **Then** c'est **refusé** : je dois d'abord quitter le mien (un seul foyer à la fois, RG-29)

**Comportement (quitter) :**
> **Given** je suis dans un foyer partagé  
> **When** je quitte le foyer  
> **Then** je repars avec une **copie** de mes données (RG-34) et les autres membres **conservent tout**

### US-20 — Liste de courses en temps réel (#56, P24)

> **En tant que** membre d'un foyer faisant les courses, je veux voir en direct les articles cochés par les autres, afin de ne pas acheter deux fois la même chose.

> **Given** un autre membre coche ou décoche un article pendant que je consulte la liste  
> **When** il valide son action  
> **Then** je la vois apparaître **sans recharger** (RG-32)

> **Given** deux membres cochent des articles **différents** en même temps  
> **When** les deux actions partent  
> **Then** **aucune n'écrase l'autre** (suivi par article, RG-32)

> **Given** un autre membre est aussi sur la liste de courses  
> **When** je consulte la page  
> **Then** un indicateur **discret et anonyme** me le signale (RG-31)

### US-21 — Alerte de modification du planning (#56, P24)

> **En tant que** membre faisant les courses, je veux être alerté si quelqu'un modifie le planning à la maison, afin de ne pas acheter selon un planning périmé.

> **Given** je consulte ma liste de courses (ou le planning)  
> **When** un autre membre modifie le planning de la **semaine affichée**  
> **Then** je reçois une **alerte bloquante** et ma liste de courses est **automatiquement réactualisée** (RG-32)

> **Given** c'est **moi** qui modifie le planning  
> **When** ma modification est enregistrée  
> **Then** je ne reçois **aucune** alerte (l'écho de ma propre écriture est ignoré, RG-32)

---

## 5. Modèle de données

> Les structures ci-dessous sont exprimées en TypeScript à titre documentaire. Le fichier de données réel est `/data/recettes.json` — format JSON lisible et éditable sans connaissance technique.

### 5.1 Recette

```ts
type Recette = {
  id: string                      // identifiant unique, ex: "poulet-roti"
  nom: string                     // ex: "Poulet rôti aux herbes"
  tempsPreparation: "rapide"      // < 20 min
                  | "normal"      // 20–45 min
                  | "long"        // > 45 min
  vegetarien?: boolean            // #86 — flag végétarien (absent = false)
  accompagnement?: "feculents"    // #49 — accompagnement dominant ; optionnel :
                  | "legumes"     // absent = non caractérisé (plat unique,
                                  // viande seule…). Cf. RG-27.
  saisons?: ("ete" | "automne"    // #23 — saisons de la recette (RG-01 multi) ;
          | "hiver" | "printemps")[] // optionnel : absent/vide = toute l'année.
  ingredients: Ingredient[]       // Cf. RG-28.
}
```

### 5.2 Ingrédient

```ts
type Ingredient = {
  nom: string                     // ex: "Pommes de terre"
  quantite: number                // ex: 1
  unite: Unite                    // ex: "kg"
  categorie: CategorieIngredient
  fondDePlacard: boolean          // true = sel, huile, épices, farine…
}
```

> **Note discipline :** `categorie` et `fondDePlacard` sont définis par occurrence d'ingrédient dans une recette. Si "sel" apparaît dans 10 recettes, il doit avoir le même flag et la même catégorie dans les 10. Cette cohérence est une responsabilité à la saisie, pas une contrainte technique pour le MVP.

### 5.3 Unités disponibles

```ts
type Unite =
  | "g"           // grammes
  | "kg"          // kilogrammes
  | "ml"          // millilitres
  | "cl"          // centilitres
  | "l"           // litres
  | "piece"       // pièce(s)
  | "briquette"   // briquette(s)
  | "bouteille"   // bouteille(s)
  | "boite"       // boîte(s)
  | "sachet"      // sachet(s)
  | "cas"         // cuillère(s) à soupe
  | "cac"         // cuillère(s) à café
  | "autre"       // unité non listée — à préciser dans le nom de l'ingrédient
```

### 5.4 Catégories d'ingrédients

```ts
type CategorieIngredient =
  | "viandes-poissons"    // Viandes, poissons, charcuterie
  | "legumes-fruits"      // Légumes frais et fruits
  | "produits-frais"      // Produits laitiers, œufs, pâtes fraîches
  | "epicerie"            // Féculents secs, conserves, sauces, boissons
  | "boulangerie"         // Pain, viennoiseries
  | "surgeles"            // Produits surgelés
  | "autre"               // Catégorie non listée — à compléter à l'usage
```

> **Note :** cette liste sera complétée lors de la saisie des ~30 recettes initiales (Phase 3).

### 5.5 Planning (structure générée)

```ts
type JourPlanning = {
  jour: "lundi" | "mardi" | "mercredi" | "jeudi" | "vendredi" | "samedi" | "dimanche"
  dejeuner?: Recette     // peuplé chaque jour à la génération ; champ gardé optionnel
                         // pour relire sans migration les plannings antérieurs (9 repas)
  diner: Recette
  // Nombre de personnes par slot (US-07, RG-16). Optionnel : champ absent = 2
  // (défaut), ce qui rend les plannings persistés antérieurs relisables sans migration.
  personnes?: { dejeuner?: number; diner?: number }
  // Slots marqués « restes » (US-12, RG-22) : pas cuisinés, exclus de la liste
  // de courses. Optionnel : champ/valeur absent = repas cuisiné normal.
  restes?: { dejeuner?: boolean; diner?: boolean }
}

type Planning = {
  semaine: string        // ex: "2026-W23"
  jours: JourPlanning[]  // 7 entrées
}
```

### 5.6 Persistance

Le planning généré est sauvegardé en `localStorage` sous la clé `planning_courant`. Il est écrasé à chaque nouvelle génération.

**Synchronisation multi-device (US-13, #6) + historique (US-14, #5) :** la **base Supabase est la source de vérité** du planning **et des coches**, **par semaine** ; `localStorage` cache la **semaine affichée** (clé `semaine_affichee`). Chaque donnée est poussée en base à chaque changement et hydratée selon un **last-write-wins horodaté**, avec **file de rejeu** hors-ligne. Naviguer change la semaine affichée : on **flushe** d'abord les écritures en attente (sinon perte) puis on charge la semaine cible. Clés de cache : planning (`planning_courant`, `planning_courant_maj`, `planning_dirty`) et coches (`courses_cochees`, `courses_cochees_maj`, `courses_dirty`). (Cf. RG-23/RG-24, tables `planning`/`planning_slot`/`etat_courses_article` clé-vées par `(foyer, semaine)` depuis #56 — cf. 5.7.)

Les coches de la liste de courses (US-05) sont sauvegardées sous la clé `courses_cochees` : un objet `{ [nom|unité]: quantité au moment du cochage }` (cf. RG-12). La clé est effacée à chaque génération complète de planning (RG-13).

Un snapshot d'annulation (US-09) est conservé sous la clé `planning_snapshot` : `{ planning, coches, horodatage }`, figeant `planning_courant` et `courses_cochees` avant une action destructive. Transitoire et mono-niveau, il expire après la fenêtre d'undo (cf. RG-19).

> **Depuis #56 (P24)**, les données partagées sont scopées au **foyer** (et non plus à l'utilisateur), et les coches sont stockées **par article** (cf. 5.7). Les tables `planning`/`planning_slot`/`etat_courses_article` sont clé-vées par `(foyer, semaine)` ; la sync coches devient **par article + temps réel** (RG-31/RG-32).

### 5.7 Foyer & propriété des données (#56, P24)

- **Foyer** = unité de partage. Toute donnée partagée appartient à un foyer (`foyer_id`), pas à un compte. Tables `foyers` et `profiles` (un profil par compte, rattaché à un foyer). **Modèle « foyer de 1 systématique »** : chaque compte naît dans son propre foyer (créé à l'inscription) — il n'y a donc pas d'action « créer un foyer », on **invite** ou on **rejoint** (US-19).
- **Scope foyer** : `recette` (avec `foyer_id IS NULL` = **catalogue global** en lecture seule), `recette_ingredient`, `planning`/`planning_slot`, `etat_courses_article`, `recette_masquee`. **`reglages` reste par-utilisateur** (chaque membre a ses propres règles de génération).
- **Coches par article** : table `etat_courses_article (foyer_id, semaine, cle, quantite)` — **une ligne par article** (remplace l'ancien blob `etat_courses`), condition d'un temps réel sans écrasement mutuel (RG-32).
- **Isolation** : chaque membre ne voit que les données de son foyer (+ le catalogue global). Les écritures partagées sensibles (planning, jonction, sortie) passent par des **fonctions serveur transactionnelles** (atomicité + dérivation du foyer côté serveur).

---

## 6. Règles métier du générateur

### RG-01 — Éligibilité par slot (jour × type de repas)

L'éligibilité dépend du **jour** (semaine vs week-end) **et** du **type de repas** (déjeuner vs dîner) :

| Jour | Slot | Recettes éligibles |
|------|------|--------------------|
| Lundi → Vendredi | Déjeuner | `"rapide"` ou `"normal"` |
| Lundi → Vendredi | Dîner | `"rapide"` |
| Samedi / Dimanche | Déjeuner | Toutes (`"rapide"`, `"normal"`, `"long"`) |
| Samedi / Dimanche | Dîner | Toutes |

> **Ordre de remplissage :** les slots les plus contraints sont servis d'abord (dîners de semaine = rapide uniquement, puis déjeuners de semaine = rapide/normal, puis week-end = tout). Comme toute recette éligible sur un slot contraint l'est aussi sur un slot plus permissif, cet ordre évite d'épuiser à tort le vivier restreint et de faire échouer un slot alors qu'une solution existe.

> **Vivier minimal pour générer une semaine (14 slots distincts, RG-02) :** au moins **14 recettes**, dont **≥ 10 rapide/normal** (les 10 slots de semaine) dont **≥ 5 rapide** (les 5 dîners de semaine). Les 4 slots de week-end absorbent le reste (recettes "long" comprises). En deçà, la génération échoue explicitement (RG-09) — l'alerte de vivier le signale en amont.

### RG-02 — Pas de répétition dans la semaine

Une recette ne peut apparaître qu'une seule fois dans un planning de 7 jours (14 slots), quel que soit le slot (déjeuner ou dîner).

### RG-03 — Sélection aléatoire

Parmi les recettes éligibles (RG-01 + RG-02), la sélection est aléatoire à chaque génération.

### RG-04 — Remplacement individuel

Lors d'un remplacement (US-04), la nouvelle recette doit respecter RG-01 et RG-02. Si aucune recette éligible n'est disponible, afficher : *"Pas de recette disponible"*.

### RG-05 — Agrégation de la liste de courses

Pour construire la liste de courses depuis un planning :
1. Collecter tous les ingrédients de toutes les recettes du planning
2. Regrouper par `nom` d'ingrédient (insensible à la casse)
3. Additionner les `quantite` pour les ingrédients de même nom **et** même `unite`
4. Séparer les ingrédients avec `fondDePlacard: true` dans une section distincte
5. Trier par `categorie`, puis par nom dans chaque catégorie

> **Cas limite :** si le même ingrédient apparaît dans deux recettes avec des unités différentes (ex: 200g et 1 pièce), les afficher sur deux lignes distinctes sans tenter de conversion.

### RG-15 — Sélection manuelle d'une recette (US-06)

> Les RG-10 à RG-14 (liste de courses cochable) sont en section 7.

La sélection manuelle by-passe **RG-01** (une recette « long » est permise un soir de semaine) et **RG-02** (le doublon est permis) : l'utilisateur arbitre, informé par le badge temps et le badge « déjà au planning ». Elle constitue un remplacement individuel : les coches de la liste de courses sont conservées (RG-12/RG-13) et l'opération ne peut pas échouer — le cas « Pas de recette disponible » (RG-04) n'existe pas dans ce mode, et un message d'indisponibilité affiché précédemment sur le slot est nettoyé après une sélection réussie.

### RG-16 — Nombre de personnes par repas (US-07)

Le nombre de personnes est porté par chaque slot du planning (section 5.5), avec une valeur par défaut de **2** et borné à **[1 ; 12]**. Il est **conservé** lors d'un remplacement de recette (US-04, US-06) et **réinitialisé à 2** par une génération complète (cohérent avec RG-13). Les plannings persistés antérieurs à cette feature se relisent sans migration : un champ `personnes` absent vaut 2.

### RG-17 — Mise à l'échelle des quantités (US-07)

Les recettes sont données pour 2 personnes. Pour un slot réglé à `N` personnes, chaque quantité d'ingrédient est multipliée par `N / 2` **à la collecte** (RG-05, étape 1), avant agrégation. L'arrondi est appliqué **après** agrégation, par type d'unité :

| Unités | Arrondi |
|--------|---------|
| `piece`, `briquette`, `bouteille`, `boite`, `sachet`, `autre` (comptables) | entier supérieur |
| `g`, `ml`, `cl` (mesures fines) | entier le plus proche |
| `kg`, `l` (grosses mesures) | 1 décimale |
| `cas`, `cac` (cuillères) | au 0,5 près |

> Arrondir après agrégation évite d'accumuler les erreurs d'arrondi quand un même ingrédient provient de plusieurs repas mis à l'échelle différemment.

### RG-18 — Accord en nombre des libellés de courses (US-08)

L'accord se fait à l'affichage uniquement (le nom stocké est inchangé), et selon ce qui est compté :
- **unité `piece`** : le **nom** s'accorde — singulier si quantité < 2, pluriel si ≥ 2. Implémenté par un pluriel régulier conscient des connecteurs (« de / à / en… » : seule la tête s'accorde, ex. « blancs de poulet ») complété d'une **table d'exceptions** (formes déjà au pluriel dans le dataset, composés irréguliers, mots à trait d'union, invariants : marques, variétés, noms de masse vendus à la pièce).
- **unités conteneur** (`sachet`, `boite`, `bouteille`, `briquette`) : c'est le **libellé d'unité** qui s'accorde (« 2 sachets »), pas le nom (contenu).
- **mesures** (`g`, `kg`, `ml`, `cl`, `l`, `cas`, `cac`) : noms de masse, jamais accordés.

> Hors table d'exceptions et hors règle régulière sûre, la forme est laissée **inchangée** — ne jamais risquer une faute d'accord.

---

## 7. Règles d'affichage & responsive

### RG-06 — Mobile-first

L'app est conçue pour mobile en priorité. Tous les écrans doivent être utilisables d'une main, en mode portrait.

### RG-07 — Vue desktop (≥ 768px)

Le planning s'affiche en grille 7 colonnes (une par jour). Chaque cellule contient le ou les slots du jour avec le nom de la recette, le badge de temps de préparation, et le bouton de remplacement.

### RG-08 — Vue mobile (< 768px)

Le planning s'affiche en liste verticale : une ligne par jour, avec les slots empilés verticalement pour le week-end.

### RG-09 — États de l'interface

Chaque écran doit gérer trois états :
- **Loading** : pendant la génération du planning
- **Error** : si la génération échoue (ex: pas assez de recettes éligibles)
- **Empty** : état initial avant toute génération

### RG-10 — Bascule cocher/décocher (US-05)

Un clic sur un article de la liste de courses bascule son état coché/non coché. La zone cliquable est la ligne entière (hauteur ≥ 44 px).

### RG-11 — Affichage des articles cochés

Un article coché est rayé, grisé et affiché en fin de sa catégorie (ordre alphabétique entre articles cochés). Décoché, il reprend sa place alphabétique (RG-05).

### RG-12 — Persistance et invalidation des coches

Les coches sont persistées en `localStorage` (clé `courses_cochees`), accrochées à la clé d'agrégation `nom|unité` (RG-05) avec la quantité de l'article au moment du cochage. Une coche n'est valide que si la quantité actuelle de l'article est identique — sinon elle est silencieusement ignorée (protège des remplacements de slots, US-04).

### RG-13 — Cycle de vie des coches

Une génération complète de planning réinitialise toutes les coches. Un remplacement de slot individuel ne déclenche aucune réinitialisation globale : l'invalidation par quantité (RG-12) suffit. Cette réinitialisation est **réversible** le temps de la fenêtre d'undo : une annulation restaure les coches effacées (cf. RG-19).

### RG-14 — Fond de placard cochable, hors progression

Les articles du fond de placard sont cochables (même comportement visuel) mais exclus du compteur de progression « n/N », qui ne porte que sur les articles à acheter.

### RG-19 — Snapshot d'annulation (US-09)

Avant toute action destructive sur le planning — regénération (US-09), remplacement de slot (US-04) ou sélection manuelle (US-06) — un snapshot **mono-niveau** est capturé en `localStorage` (clé `planning_snapshot`, cf. 5.6) : il fige à la fois `planning_courant` **et** `courses_cochees`. L'annulation réécrit les deux clés à l'identique — elle **inverse donc l'effacement des coches de RG-13**. Règles :

- **Un seul cran d'undo** : chaque nouvelle action écrase le snapshot précédent ; on ne recule que d'un pas.
- **Expiration** : le snapshot est horodaté et n'est plus restaurable au-delà de la fenêtre d'undo (~6 s, marge sur les ~5 s du toast). Au-delà, l'undo n'est plus proposé.
- **Première génération exclue** : aucun snapshot n'est offert quand il n'existait pas de planning préalable (rien à restaurer).
- **Déclencheurs** : le bouton « Annuler » du toast (sonner) et le raccourci clavier Ctrl/Cmd+Z sur la page planning.

### RG-20 — Contenu et échelle de la fiche de recette (US-10)

La fiche affiche **tout ce que l'on connaît** de la recette : titre, temps de préparation (badge) et liste des ingrédients. Règles :

- **Déclencheur** : le clic sur le **nom du plat** dans la card du planning (pas la card entière, qui porte déjà des contrôles : changer, sélectionner, stepper). La fiche s'ouvre en place (dialog), sans navigation ni appel réseau — la recette est déjà dans le slot du planning.
- **Échelle** : les quantités sont mises à l'échelle pour le nombre de personnes du slot ouvert, via le même calcul que la liste de courses (RG-17 : ×N/2 puis arrondi par type d'unité) — cohérence garantie. La fiche mentionne « pour N personnes ».
- **Groupement** : les ingrédients sont scindés en « à acheter » et « fond de placard (à vérifier) » (cf. RG-14), pour répondre au besoin « puis-je la faire sans rien acheter ».
- **Édition** : un raccourci « Modifier » n'apparaît que pour une recette **personnelle** (éditable, cf. RLS) ; absent pour le catalogue global.
- **Saisonnalité : hors périmètre** tant que la donnée n'existe pas (cf. backlog #P12). La fiche n'invente pas de champ ; elle l'affichera quand le modèle le portera.

### RG-21 — Sélection de la semaine cible (US-11) — absorbée par RG-24

> **Mise à jour #5 :** le sélecteur de semaine cible de #55 est **remplacé par le navigateur de semaines** (RG-24). La génération vise désormais la **semaine affichée** ; la plage de validation serveur passe de « courante → +6 » à « −12 → +6 » (cf. RG-24), et le « mono-actif » est levé (multi-semaines).

Historique (conservé pour mémoire) : la génération visait une semaine cible (courante → +6), validée côté serveur ; défaut = semaine courante, ou prochaine le week-end (logique reprise par le navigateur).

### RG-24 — Navigation entre semaines & historique (US-14)

- **Navigateur** : sur la page planning, un stepper ‹ semaine précédente / suivante › change la **semaine affichée**. La liste de courses suit la même semaine (n° de semaine affiché en tête de `/courses`, même format que le planning).
- **Plage** : de **−12 semaines** (rétention) à **+6 semaines** ; validée côté serveur à la génération. La **semaine courante** (offset 0) est **visuellement marquée** (fond brand + libellé « Cette semaine »).
- **Défaut affiché** : la semaine courante, ou la **prochaine le week-end** (reprise de l'ancien RG-21). Au rechargement complet, on revient à ce défaut (on ne reste pas bloqué sur une semaine parcourue).
- **Multi-semaines** : chaque semaine a son planning et ses coches en base (`(user, semaine)`). Changer de semaine **flushe** d'abord les écritures en attente (sinon perte), puis charge la cible. **Rétention** : au chargement de session, les semaines **au-delà de −12** sont **purgées** en base (planning + coches), aligné sur la borne passée du navigateur.
- **Confirmations** : régénérer ou modifier un slot (changer / sélectionner / restes) d'une semaine **passée** (offset < 0) **disposant d'un planning** demande **confirmation** avant écrasement. Générer une semaine passée **vide** n'en demande pas (rien à écraser). Le **stepper personnes** en est exclu (réglage mineur et fréquent).

### RG-25 — Règles de génération personnalisables (US-15, #45)

- **Par utilisateur** : chaque utilisateur connecté a ses réglages (table `reglages`, RLS propriétaire) ; ils n'impactent personne d'autre. Ligne absente = **valeurs par défaut** (= comportement historique, aucune régression).
- **Règles modifiables** : le **nombre de personnes par défaut** (borné [1;12], appliqué aux slots fraîchement générés — la base recette reste 2, RG-16) et le **temps de préparation maximum** (« plafond ») de chacun des **4 créneaux** : déjeuner de semaine, dîner de semaine, déjeuner de week-end, dîner de week-end.
- **Modèle « plafond »** : « durée max » = catégorie plafond parmi `rapide < normal < long` (le modèle de recette est catégoriel, pas en minutes). L'éligibilité d'un slot = recettes de temps **≤ plafond**. Défauts : déjeuner semaine `normal`, dîner semaine `rapide`, week-end `long`.
- **Prise en compte** : la **prochaine** génération (complète **ou** unitaire « ↺ changer ») applique les réglages — les plannings déjà générés ne sont pas rejoués. Génération complète = lecture serveur (route `/api/planning/generer`) ; remplacement unitaire = lecture client.
- **Enregistrement explicite** : un bouton « Enregistrer » (pas de sauvegarde à la volée). Une configuration rendant la génération **infaisable** (vivier insuffisant pour 14 slots distincts sous ces plafonds) est **refusée à la sauvegarde** (garde de faisabilité, cf. `analyserVivier`).

### RG-26 — Recettes végétariennes (US-16, #86)

- **Attribut de recette** : chaque recette porte un flag `vegetarien` (booléen, défaut `false`). Pour une recette **perso**, il est piloté par le formulaire (case « Recette végétarienne ») ; à la création, il est **pré-coché par heuristique** (aucun ingrédient en catégorie `viandes-poissons`), suggestion que l'utilisateur peut corriger.
- **Catalogue global** : les recettes globales (`user_id IS NULL`, non éditables) sont **auto-taguées** par la même heuristique dans la migration (imparfait — ex. sauce poisson — mais bon défaut).
- **Affichage** : un badge « Végétarien » (feuille) signale les recettes végé sur la fiche, la liste des recettes et la card du planning.
- **Filtre** : la liste des recettes propose un filtre « végétariennes seulement ».
- **Préférence de génération** : l'utilisateur peut **privilégier le végétarien** par créneau (page Réglages, à côté des plafonds — RG-25, 4 interrupteurs). C'est une préférence **souple** : la génération complète **et** le remplacement unitaire « ↺ changer » biaisent le tirage vers les recettes végé sur ces créneaux, sans jamais bloquer. Le biais reste dans le même palier de temps → la faisabilité (et donc l'analyse de vivier RG-25) est inchangée. Si le vivier végé est insuffisant, le repas est tout de même généré et l'utilisateur est **averti** du nombre de repas non honorés.

### RG-27 — Accompagnement & au moins un légume par jour (US-17, #49)

- **Attribut de recette** : chaque recette porte un accompagnement optionnel `accompagnement` ∈ { `feculents`, `legumes` } (absent = **non caractérisé** : plat unique, viande seule, ambigu…). Pour une recette **perso**, il est piloté par le formulaire (select « Féculents / Légumes / Aucun ») ; à la création, il est **pré-suggéré par heuristique** sur le **nom des ingrédients** (priorité au féculent : un plat « riz + tomates » est tagué féculent), suggestion que l'utilisateur peut corriger.
- **Catalogue global** : les recettes globales (`user_id IS NULL`, non éditables) sont **auto-taguées** par la même heuristique dans la migration (imparfaite et « à compléter » — faute de catégorie « féculents » et parce que `legumes-fruits` mêle légumes, aromates et fruits — mais bon défaut).
- **Affichage** : un badge signale l'accompagnement sur la fiche, la liste des recettes et la card du planning — **Féculents** (épi de blé, ton terracotta) et **Légumes** (carotte, ton vert), aux couleurs du design system.
- **Préférence de génération** : l'utilisateur peut activer **« au moins un repas légumes par jour »** (page Réglages, un seul interrupteur pour toute la semaine — RG-25). Préférence **souple** et **jointe par jour** : la génération complète **et** le remplacement unitaire « ↺ changer » biaisent pour qu'au moins un des deux repas de chaque journée soit « légumes », sans jamais bloquer. Mécanique : on biaise le premier slot non encore pourvu d'un jour vers « légumes », et — une fois la journée pourvue — on **anti-biaise** son second slot (préférence non-légume) pour **préserver le vivier de légumes aux jours non encore servis**. Le biais reste dans le même palier de temps → la faisabilité (analyse de vivier RG-25) est inchangée. Si le vivier ne le permet pas, le planning aboutit quand même et l'utilisateur est **averti** du nombre de jours non honorés.

### RG-28 — Saisonnalité des recettes (US-18, #23)

- **Mapping mois → saison** : Été = juin–septembre ; Automne = octobre–novembre ; Hiver = décembre–mars ; Printemps = avril–mai. La saison d'une **semaine** est celle de son **jeudi** (jour d'ancrage ISO).
- **Attribut de recette** : `saisons` (liste, RG-01 : plusieurs saisons possibles) ; **absent/vide = disponible toute l'année** (pâtes, viandes… → aucune contrainte, pas de régression). Recette **perso** : saisie au formulaire (cases printemps/été/automne/hiver), **pré-suggérée par heuristique** à la création.
- **Catalogue global** : auto-tagué par heuristique dans la migration — table **produit → saisons** (~26 produits), saison recette = **intersection** des saisons de ses produits saisonniers (aromates / produits de garde = toute l'année, ne contraignent pas) ; intersection vide (produits incompatibles) ⇒ toute l'année. Imparfaite, « à compléter ».
- **Affichage** : un badge saison (icônes par saison) sur la fiche, la liste et la card du planning ; filtre par saison sur la page Recettes.
- **Génération** : pilotée par un **interrupteur** sur la page Réglages (« ne proposer que des recettes de saison »), **activé par défaut**. Quand il est actif, la génération complète **et** le remplacement « ↺ changer » ne proposent que des recettes de la saison de la **semaine cible**. **Dégradation gracieuse** : si le vivier de saison ne suffit pas à remplir la semaine, on complète avec des recettes hors-saison (la génération **n'échoue jamais**) et l'utilisateur est **averti** du nombre de repas hors-saison. La faisabilité ne dépend donc pas de la saison.
- **Sélection manuelle non filtrée (RG-03 de #23)** : le sélecteur de recette (US-06) continue de proposer **toutes** les recettes, hors saison comprises — l'utilisateur arbitre.

### RG-22 — Repas en « restes » (US-12)

Un slot peut être marqué **« restes »** (flag par slot, `restes.dejeuner` / `restes.diner`, cf. 5.5) : l'utilisateur mangera ce qu'il a au frigo, sans cuisiner. Règles :

- **Exclu de la liste de courses** : les ingrédients d'un slot en restes ne sont pas collectés (RG-05) — ce repas ne génère aucun article.
- **Pas de cuisine affichée** : la card montre « Restes », sans badge de temps, sans réglage du nombre de personnes, sans fiche de recette.
- **Réversible** : marquer/annuler « restes » est une bascule ; remplacer la recette d'un slot (US-04/US-06) **efface** le flag (on recuisine). La recette sous-jacente est conservée tant que le slot est en restes — l'annulation la restitue.
- **Génération** : la (re)génération produit un planning entièrement cuisiné (aucun restes) ; le marquage est purement manuel et postérieur.
- **Plusieurs slots** peuvent être en restes simultanément (aucune contrainte d'unicité, RG-02 ne s'applique qu'aux recettes).

### RG-23 — Synchronisation et source de vérité (US-13)

- La **base Supabase est la source de vérité** du planning actif **et des coches** ; `localStorage` est un cache pour la réactivité et le hors-ligne.
- **Last-write-wins horodaté** : au chargement, la version la plus récente entre base et cache local gagne (comparaison `updated_at` / `planning_courant_maj`). Un cache **sans horodatage** (planning antérieur à la feature, ou injecté en test) est considéré comme le plus frais — on ne l'écrase pas ; un device au cache **vide** récupère donc le planning distant.
- **Écriture à chaque changement** (débounce), avec **rejeu** au retour réseau (`planning_dirty`). Pas de temps réel : la propagation se fait au prochain chargement.
- **Mono-actif** : un seul planning persisté par utilisateur (l'historique multi-semaines est #P08). Le **snapshot d'annulation** (US-09) reste **local**, non synchronisé.

> **Évolution #56 (P24)** : depuis le foyer partagé, la source de vérité est par **foyer** (et non plus par utilisateur), l'historique multi-semaines est livré (#5), et la sync des **coches** passe en **temps réel** (cf. RG-31/RG-32). Le last-write-wins horodaté reste la règle pour le **planning**.

### RG-29 — Un seul foyer à la fois & code d'invitation (US-19, #56)

- **Foyer de 1 systématique** : tout compte appartient toujours à un foyer (créé à l'inscription). Pas d'action « créer » ; on **invite** (le sien devient partagé) ou on **rejoint**.
- **Rejoindre exige d'être seul** : pour passer d'un foyer partagé à un autre, il faut **quitter** d'abord (US-19).
- **Code d'invitation** : 8 caractères d'un alphabet sans caractères ambigus, généré **à la demande** (pas à l'inscription), **valable 7 jours**, **réutilisable** jusqu'à expiration (multi-jonction, pas usage unique).

### RG-30 — Gouvernance plate (US-19, #56)

Tous les membres ont **les mêmes droits** : générer/régénérer le code d'invitation, créer/éditer/supprimer les recettes **du foyer**, modifier le planning et les coches. **Pas de rôle « propriétaire »** ni d'administration différenciée.

### RG-31 — Présence anonyme « en magasin » (US-20, #56)

Quand au moins un **autre** membre consulte la liste de courses en même temps, un indicateur **discret** le signale. La présence est **anonyme** (aucun nom) : seul le fait qu'« un autre membre est là » est exposé.

### RG-32 — Temps réel & anti-écrasement (US-20, US-21, #56)

- **Coches suivies par article** (une entrée par `(foyer, semaine, article)`) : deux membres qui cochent des articles **différents** ne s'écrasent pas ; sur un **même** article, le dernier écrit gagne (acceptable).
- **Propagation en temps réel** des coches : un changement distant apparaît **sans recharger**.
- **Alerte planning (US-21)** : une modification distante du planning de la **semaine affichée** déclenche une **alerte bloquante** chez les autres membres et **réactualise** leur liste de courses ; **l'écho de sa propre écriture est ignoré** (discriminé par l'horodatage serveur).

### RG-33 — Fusion des catalogues à la jonction (US-19, #56)

En rejoignant un foyer, les **recettes personnelles** du membre sont rattachées au foyer cible. Les **collisions de noms sont conservées** (pas de fusion automatique, aucune perte) ; un **assistant de dédoublonnage** est proposé juste après pour nettoyer manuellement (suppression réelle pour une recette du foyer, masquage pour une globale, cf. #105).

### RG-34 — Sortie sans perte (US-19, #56)

Quitter un foyer **clone** vers le nouveau foyer solo du partant une **copie** de tout ce qu'il partageait : recettes (+ ingrédients), masquages, plannings (+ slots, tout l'historique) et coches. On **clone, on ne déplace pas** : les membres restants conservent **100 %** des données (pérennité) et les deux foyers deviennent **indépendants immédiatement** (étanchéité). Opération **transactionnelle** côté serveur (tout ou rien).

---

## 8. Wireframes de référence

Les wireframes low-fi validés lors de la Phase 1 couvrent :

- **Écran 1** — Accueil : bouton "Générer mon planning"
- **Écran 2a** — Planning desktop : grille 7 colonnes avec badges et boutons de remplacement
- **Écran 2b** — Planning mobile : liste verticale par jour
- **Écran 3** — Liste de courses mobile-first : catégories + section fond de placard

---

## 9. Explicitement hors scope (toutes versions)

> Ces features ne sont pas prévues dans la roadmap actuelle. Contrairement au backlog (section 3), elles ne seront pas reconsidérées sans une évolution significative du besoin.

- Gestion des allergies ou régimes alimentaires
- Suggestions basées sur les saisons ou le marché
- Notation ou commentaire des recettes
- Synchronisation avec un calendrier externe (Google Calendar…)
- Mode collaboratif temps réel (couple qui planifie simultanément)
