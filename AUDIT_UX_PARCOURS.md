# Audit UX — User journeys « On mange quoi ? »

> Date : 2026-06-18
> Auteur : revue Product Design (mobile)
> Base : 22 screenshots `revueDesign/` + vérification du code
> Épopée de suivi : issue #51 « Audit UI/UX ». Les sujets actionnables sont tracés en issues dédiées (label `ux/ui`).

---

## Méthode

Chaque parcours est décrit comme une **journey map** : pour chaque étape, on note
ce que l'utilisateur **fait**, ce qu'il **ressent** (émotion), son **besoin**
sous-jacent, les **frictions** observées et les **opportunités** de design. Le
ton émotionnel suit une échelle simple : 😀 fluide · 🙂 correct · 😐 neutre ·
😕 friction · 😞 blocage.

Persona implicite (cf. `SPECS_FONCTIONNELLES.md`) : usage **personnel / foyer**,
mobile-first, charge mentale du « qu'est-ce qu'on mange ce soir ? » à supprimer.
La promesse produit est *« la question du soir a enfin sa réponse »* — la
réussite UX se mesure à la **vitesse à laquelle on passe de l'incertitude à un
planning + une liste de courses exploitables**.

---

## J1 — Acquisition & onboarding

**Objectif utilisateur** : passer de « je découvre l'app » à « j'ai mon premier
planning » sans effort.
**Déclencheur** : lien d'invitation d'un proche, ou découverte directe.

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. Login / signup | Saisit email + mot de passe | 🙂 | Entrer vite, sans friction | La **nav applicative (Planning/Courses/Recettes) est affichée alors que déconnecté** → liens morts, repères trompeurs. La bascule thème est déjà visible (hors-sujet ici). |
| 2. Bienvenue — étape 1/2 | Renseigne prénom, nb de personnes, **foyer végétarien** | 😕 | Sentir que l'app se cale sur *moi* | **BUG : l'interrupteur « Foyer végétarien » rend de façon incohérente / cassée** (curseur désynchronisé de la piste). Premier écran interactif → signal « produit pas fini » au pire moment. |
| 3. Bienvenue — étape 2/2 | Choisit « Rejoindre » (code) ou « Démarrer seul·e » | 🙂 | Comprendre l'enjeu du foyer | Texte clair, écriture inclusive cohérente. Bouton « Rejoindre » en vert pâle (désactivé) ≈ couleur active ailleurs → légère ambiguïté d'état. |
| 4. Génération du 1er planning | Attend (solo) ou réhydrate (rejoint) | 😀 | Voir un résultat immédiat | Excellente décision produit : **on n'arrive jamais sur un planning vide** (« aha moment »). |
| 5. Arrivée sur /planning | Découvre sa semaine | 😀 | Validation de la valeur | Réussite : la promesse est tenue en < 2 min. |

**Pic émotionnel positif** : étape 4-5 (planning offert).
**Vallée** : étape 2 (toggle cassé) — d'autant plus dommageable qu'elle précède
le pic.
**Recommandations** : corriger le toggle (composant partagé), assainir la nav en
état déconnecté, clarifier l'état désactivé du bouton « Rejoindre ».

---

## J2 — Génération & ajustement du planning hebdomadaire

**Objectif** : obtenir une semaine de repas qui me convient, et l'ajuster à la marge.
**Fréquence** : hebdomadaire (le cœur de l'usage).

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. Accueil « On mange quoi ? » | Lit le hero, voit 3 cartes d'aperçu, tape « Générer » | 🙂 | Lancer vite | Les 3 cartes sont **factices** (décoratives) mais identiques à de vraies cartes → ambiguïté possible. Écran rarement vu (onboarding génère déjà). |
| 2. Planning généré | Parcourt Lundi→Dimanche, déjeuner + dîner | 😀 | Vue d'ensemble lisible | Cartes riches et claires (badges temps, végé/accompagnement). |
| 3. Évalue un repas | Lit badge temps / végé | 😐 | Jauger la charge de cuisine d'un coup d'œil | **Badges « Normal » et « Long » de même teinte terracotta** → pas de gradient perceptible ; le scan « court→long » ne fonctionne pas. |
| 4. Ajuste un slot | « ↺ changer » / « Sélectionner » / « Restes » / stepper personnes | 😕 | Modifier sans réfléchir | **Affordances hétérogènes** : icône+texte, texte nu, boutons ronds, côte à côte ; cibles tactiles petites/serrées. |
| 5. N'aime pas l'ensemble | Cherche à changer *les règles* (pas juste un slot) | 😞 | Régler temps/végé/saison globalement | **Les réglages de génération sont introuvables depuis ici** : enfouis en bas de `/profil`. L'utilisateur subit les défauts ou multiplie les « ↺ changer ». |
| 6. Régénère | Tape « Regénérer » | 🙂 | Repartir d'une base neuve | Faute : **« Regénérer »** (devrait être « Régénérer »). |
| 7. Navigue entre semaines | Flèches ‹ › | 🙂 | Préparer / consulter | OK. |

**Insight clé** : la **boucle d'ajustement est cassée à l'étape 5**. L'intention
« ce planning ne me ressemble pas » naît sur le planning, mais le levier
correspondant est à 2 niveaux de profondeur ailleurs. → rapprocher les réglages
de l'action (issue dédiée).

---

## J3 — Courses (préparation maison → exécution en magasin)

**Objectif** : transformer le planning en liste de courses fiable, puis cocher en rayon.
**Contexte d'usage** : debout, en mouvement, parfois en extérieur (luminosité forte).

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. Ouvre la liste | Depuis le planning | 🙂 | Liste prête sans effort | Agrégation automatique = forte valeur. |
| 2. Lit l'en-tête | « 3/28 articles · 15 à vérifier » | 😕 | Comprendre où j'en suis | **Titre qui se coupe sur 2 lignes** + chevauche date/compteur ; **« 15 à vérifier » en rouge** (faux signal d'alerte) ; relation 28 / 3 / 15 peu explicite. |
| 3. Coche en rayon | Tape les cases | 😀 | Geste rapide, gros pouce | Cases bien dimensionnées ; rature claire. |
| 4. Termine une catégorie | Tout coché → catégorie glisse en bas | 😀 | Garder le focus sur le reste | **Très bonne micro-UX** (réordonnancement RG-39). |
| 5. Fond de placard | Vérifie épices/condiments | 🙂 | Distinguer « à acheter » de « à vérifier » | Section terracotta dédiée, lisible. Couleur d'alerte de l'en-tête (étape 2) en dissonance avec cette neutralité. |

**Enjeu de contexte** : usage en magasin → **lisibilité au soleil** critique. Le
texte secondaire en `brand-700/70` (sous le seuil de contraste AA probable)
fragilise ce parcours. → issue contraste.

---

## J4 — Gestion des recettes (CRUD)

**Objectif** : enrichir / corriger le vivier de recettes qui nourrit la génération.

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. Liste « Mes recettes » | Recherche, filtre « Végétariennes seulement », « De saison » | 🙂 | Retrouver vite | Filtres clairs, badges informatifs (temps/végé/accompagnement/saison). |
| 2. Crée une recette | Remplit nom/temps/végé/accompagnement/saisons/ingrédients | 🙂 | Saisie guidée | Pré-suggestions (végé/accompagnement) = bonne assistance. Formulaire long mais structuré. |
| 3. Modifie / Duplique / Supprime | Actions par recette | 🙂 | Contrôle | Verbes uniformes (Modifier/Supprimer/Dupliquer) — bon choix (#105). |
| 4. Supprime une recette du catalogue | Undo transitoire (toast) | 🙂 | Réversibilité | Sécurité de l'undo bien pensée. |

**Lecture** : parcours mûr, peu de friction. Surtout des sujets de **densité**
visuelle (beaucoup de badges/actions par ligne) plutôt que de blocage.

---

## J5 — Foyer & partage

**Objectif** : partager planning/recettes/courses avec un proche.

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. /profil → Mon foyer | Lit « Tu es seul·e dans ton foyer » | 🙂 | Comprendre l'état | Message clair et chaleureux. |
| 2. Invite | « Inviter quelqu'un » (code/QR/partage) | 🙂 | Partager sans friction | Web Share + QR = bon niveau. |
| 3. Rejoint | Saisit un code | 🙂 | Rejoindre simplement | Deux points d'entrée (inviter / rejoindre) cohabitent — OK car solo peut faire les deux. Bouton « Rejoindre » désactivé en vert pâle (même remarque d'état que J1). |

**Lecture** : parcours sain. Pas d'issue prioritaire propre (hors cohérence des
états désactivés, traitée transversalement).

---

## J6 — Réglages de génération

**Objectif** : faire que « la génération me ressemble » (temps, végé, légumes, saison, portions).
**Criticité** : élevée — c'est le levier de valeur ; mais parcours **mal amorcé**.

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. Cherche les réglages | … depuis le planning | 😞 | Régler là où le besoin naît | **Aucun accès depuis le planning.** Il faut aller dans /profil. |
| 2. /profil, scrolle tout en bas | Trouve « Réglages de génération → » | 😕 | Trouver | **Lien textuel souligné, en bas, indifférencié** d'« Aide ». Découvrabilité faible. |
| 3. Page réglages | Parcourt 4 segmentés + 4 switches + équilibre + saison + portions | 😕 | Régler sans se noyer | **Mur de réglages** déplié ; repérage difficile ; renforce la sensation « régler = corvée ». |
| 4. Enregistre | « Enregistrer » (actif si modifié + faisable) | 🙂 | Confiance | Garde de faisabilité = bon filet. |

**Insight** : la **valeur la plus structurante du produit est la plus enterrée**.
Double action recommandée : (a) accès contextuel depuis le planning ;
(b) regrouper la page en sections repliables.

---

## J7 — Compte & sécurité

**Objectif** : gérer identité, avatar, mot de passe, déconnexion.

| Étape | Action | Émotion | Besoin | Friction / Observation |
|-------|--------|---------|--------|------------------------|
| 1. /profil — identité | Édite prénom, choisit couleur d'avatar | 😀 | Personnaliser sans effort | Avatar « zéro upload » (initiale + couleur) = excellent compromis. |
| 2. Sécurité | Change le mot de passe (ré-auth) | 🙂 | Sûreté | Ré-authentification avant changement = bonne pratique. |
| 3. Déconnexion | « Se déconnecter » (rouge) | 🙂 | Action claire | Couleur destructive cohérente. |

**Lecture** : parcours solide. Sujet transversal : `/profil` mélange identité,
sécurité, **préférences** (futur foyer du dark mode), et **liens** (réglages,
aide) sans hiérarchie de sections nette — opportunité de structuration.

---

## Synthèse transversale

1. **Hiérarchie des accès mal calibrée** : le cosmétique (dark mode) est
   sur-exposé en nav permanente ; le structurant (réglages de génération) est
   enfoui. → rééquilibrer (échange de proéminence).
2. **Dette de cohérence des composants** : le bug du toggle vient de **deux
   implémentations *bespoke* divergentes** du même interrupteur (onboarding vs
   réglages). → composant partagé.
3. **Affordances & échelles visuelles** : actions de carte hétérogènes ; badges
   de temps sans gradient lisible. → unifier / graduer.
4. **Lisibilité en contexte réel** (magasin, soleil) : contraste du texte
   secondaire à remonter ; couleurs sémantiques à respecter (rouge = erreur
   seulement).
5. **Points forts à préserver** : « jamais de planning vide », réordonnancement
   des courses, avatar zéro-upload, identité de marque.

Les pics émotionnels positifs (planning offert, courses qui s'auto-organisent)
sont réels ; l'enjeu est de **supprimer les vallées évitables** (toggle cassé,
réglages introuvables) qui entourent ces pics.
