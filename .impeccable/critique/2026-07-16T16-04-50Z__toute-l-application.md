---
target: toute l'application
total_score: 32
p0_count: 1
p1_count: 3
timestamp: 2026-07-16T16-04-50Z
slug: toute-l-application
---
Method: dual-agent (A: revue design isolée · B: détecteur + preuve visuelle isolée) + preuve fonctionnelle e2e réelle (suite complète 99 tests, staging, hors protocole standard, à la demande explicite de l'utilisateur).

# Design Health Score

| # | Heuristique | Score | Constat clé |
|---|---|---|---|
| 1 | Visibilité de l'état du système | 3.5/4 | Spinners contextualisés, toast d'annulation, `aria-busy` — bon niveau |
| 2 | Correspondance monde réel | 4/4 | Français naturel de bout en bout, aucun jargon exposé — exemplaire |
| 3 | Contrôle et liberté utilisateur | **2/4** (révisé, voir ci-dessous) | Undo existe dans le code et le copy, mais **cassé en pratique** dans ce run e2e (dialog fantôme bloque le clic « Annuler » 60 s) |
| 4 | Cohérence et standards | 3.5/4 | Design system respecté à la lettre (confirmé par B sur les 28 captures : switch/checkbox/pilule/badges cohérents partout) ; 1 exception : callout `/aide` en accent terracotta hors convention |
| 5 | Prévention des erreurs | 3/4 | Garde de faisabilité avant suppression recette, contrainte créneaux actifs ; pas de récapitulatif avant suppression de compte |
| 6 | Reconnaissance plutôt que rappel | 2.5/4 | Badges compacts (végé/féculent/saison) sans légende visible in situ |
| 7 | Flexibilité et efficacité | 3.5/4 | Réglages fins (plafonds, favoris/évités, saison, vue Cycle) — bon niveau power user |
| 8 | Esthétique et minimalisme | 2.5/4 | `/planning` expose tout déplié (14 repas × badges+3 actions+stepper), ~4200 px de scroll dès l'ouverture |
| 9 | Récupération d'erreurs | 3.5/4 | `role="alert"`, `aria-invalid`, focus renvoyé au champ — vérifié en code |
| 10 | Aide et documentation | 3.5/4 | `/aide` riche et bien structuré, mais aucun raccourci direct une fois connecté |
| **Total** | | **31,5/40** | **Bon** (28-35) — solide, marges d'amélioration ciblées |

Heuristique #3 révisée à la baisse (3→2) après la preuve e2e : l'existence documentée d'un mécanisme d'undo ne suffit pas s'il échoue en usage réel. C'est l'exemple type de « où la preuve automatisée corrige la revue manuelle » (cf. protocole critique.md).

# Verdict AI slop — croisé A + B

**Non.** Aucune des tares habituelles : pas de bordure latérale décorative générique, pas de gradient text, pas de glassmorphism, pas de grille de cartes clonées, pas d'eyebrow/numérotation décorative, pas de jargon technique exposé. Boutons pilule, cartes `rounded-lg`+bordure discrète, Fredoka réservée à la marque/h1 — un vrai système maison cohérent, pas un assemblage de composants par défaut. (A)

**Scan déterministe (`detect.mjs --json app components`)** : 2 findings.
- `app/layout.tsx:62`, couleur `#141815` hors DESIGN.md → **faux positif** (A+B convergent) : c'est le `themeColor` du `viewport` dark (chrome plateforme), pas un token de surface rendue.
- `components/aide/article-markdown.tsx:31`, `border-l-4 border-accent-500` sur les callouts Notion → **vrai positif** (B) : c'est exactement le tell « side-stripe border » banni, et ça viole en plus la règle projet elle-même (accent terracotta réservé à une liste fermée d'usages — un callout de doc n'en fait pas partie).

**Preuve visuelle (28 captures Playwright réelles, lues intégralement par A et B)** : aucune icône emoji, aucun gradient text, aucun hero-metric template, aucun eyebrow décoratif détecté sur l'ensemble des captures. Cohérence de vocabulaire de composants (switch/checkbox/pilule/badges) validée à travers mobile, dark mode et desktop — pas d'incohérence trouvée par B entre les 28 captures.

**Convergence A+B notable** : les deux évaluations, indépendamment, pointent la même faiblesse sur le **desktop** (viewport 1280×800) — contenu cantonné à une colonne étroite centrée, espace latéral inexploité sur accueil/planning/courses. A le lit comme un choix de priorisation mobile-first assumé (cohérent avec ADR/PRODUCT.md) ; B le note comme signal de dette potentielle à trancher côté produit. Les deux s'accordent : pas une régression, un chantier délibérément différé.

# Ce qui marche

1. **Le copy de rassurance sur les actions de foyer est un vrai travail de rédaction produit.** « Tu repartiras avec ta propre copie… Les autres membres, eux, conservent tout » (`panneau-foyer.tsx`) anticipe précisément la peur de l'utilisateur et y répond en une phrase — exactement le ton « ami qui a déjà réfléchi » visé par PRODUCT.md.
2. **La dégradation gracieuse est explicitée dans l'UI, pas seulement dans le code.** Chaque toggle de `/reglages` répète honnêtement « préférence souple… le repas reste généré et tu es prévenu » — construit la confiance plutôt que de la supposer acquise.
3. **`/ce-soir` est une vraie réponse produit à la densité de `/planning`.** Réduit la question à une seule carte, une seule recette, en lecture — la bonne unité d'attention pour l'usage « mains occupées en cuisine ».

# Priority Issues

**[P0] Undo de régénération cassé en usage réel (US-09)**
Constat : `planning-edition.spec.ts:196` — après régénération, le clic sur « Annuler » du toast time-out à 60 s. Log Playwright : un `<dialog aria-labelledby="titre-confirmation">` (ConfirmationModale) apparaît par-dessus et **intercepte les pointer events**, avec l'élément qui se détache/rattache du DOM en boucle (symptôme de re-render en boucle). Ce n'est pas un test flaky au sens habituel du projet (latence réseau) : le blocage est mécanique et persistant sur 60 s complets, pas une histoire de timing ponctuel.
Pourquoi ça compte : l'undo est LE garde-fou documenté contre une régénération accidentelle (RG-19) — s'il échoue, l'utilisateur perd son planning précédent sans recours, à l'exact opposé du principe « ça ne bloque jamais / rassurant ».
Correctif : investiguer pourquoi une `ConfirmationModale` s'ouvre pendant ce parcours (régénération sur semaine courante, pas passée — la garde `confirmerSiPassee` ne devrait pas s'y déclencher) et pourquoi elle intercepte le clic du toast Sonner sans jamais se libérer. Vérifier `app/planning/page.tsx` (state `confirmation`) et l'interaction avec le toast d'annulation.
Hors périmètre `/impeccable` (bug fonctionnel, pas une décision de design) — à traiter par un debugging classique, re-jouer le test une seconde fois pour confirmer la reproductibilité avant d'investiguer.

**[P1] Une décoche d'article ne revient pas au tri alphabétique attendu (RG-11)**
Constat : `courses.spec.ts:155`, avec une fixture **déterministe** (`planningDeterministe()`, pas de hasard) — cocher puis décocher « crème fraîche » devrait la ramener en tête alphabétique de « Produits frais » ; elle se retrouve après « œufs ». Le premier cycle (avant reload) fonctionne, l'échec survient après le cycle coche→reload→décoche.
Pourquoi ça compte : fixture déterministe = pas un coup de latence réseau isolé, plutôt un vrai risque de régression sur le tri post-décoche (RG-11/RG-05).
Correctif : vérifier `trierAvecCoches`/`categorieTerminee` (`lib/coches.ts`) sur le chemin décoche-après-reload — possible clé de tri restée périmée. Re-jouer le test isolément pour confirmer avant d'investiguer plus loin.
Hors périmètre `/impeccable`.

**[P1] `/planning` expose systématiquement toutes les actions de tous les créneaux — page dense dès l'ouverture** (A)
Chaque carte-repas affiche nom + jusqu'à 4 badges + 3 liens (Changer/Sélectionner/Restes) + stepper, répété 14 fois sans compression — ~4200 px de scroll sur mobile dès l'arrivée sur la page la plus visitée de l'app. À l'opposé du principe « peu de décisions » de PRODUCT.md.
Correctif : regrouper Changer/Sélectionner/Restes derrière une action moins exposée (la fiche recette, déjà accessible au clic sur le nom, est le bon endroit), ne garder en permanence sur la carte que nom + 1-2 badges clés + stepper.
Commande suggérée : **`/impeccable distill`**

**[P1] Badges de contexte (végé/féculent/saison) sans légende visible in situ** (A, recoupé par le point Sam de B sur les `aria-label` compacts)
Un premier utilisateur voit une pastille terracotta ou une feuille verte sans repère — le sens n'est explicité que dans `/aide`, jamais sur `/planning` lui-même. Viole « reconnaissance plutôt que rappel » ; fragilise aussi l'accessibilité visuelle non-lecteur-d'écran (l'`aria-label` compact ne sert que VoiceOver/NVDA, pas un utilisateur basse vision qui voit l'icône mais ne la déchiffre pas).
Correctif : un rappel textuel au premier affichage (ou un `title`/tooltip léger au clic sur un badge compact) — pas besoin d'une légende permanente.
Commande suggérée : **`/impeccable clarify`**

## Constats complémentaires (P2-P3)

**[P2] Pas de raccourci aide visible une fois connecté** (A) — Déconnecté, la nav affiche un vrai lien « Aide » ; connecté, il disparaît au profit de l'avatar (souvent « ? » par défaut), relégué en lien texte au bas de `/profil`. Le rond vert visible sur presque tous les écrans connectés *ressemble* à un bouton d'aide sans en être un. → `/impeccable clarify`

**[P2] `/recettes` (~150 items) : liste plate alphabétique, aucun tri alternatif** (A) — Pas de segmentation « Mes recettes / Catalogue », pas de tri par temps de préparation. Chaque ligne porte déjà jusqu'à 4 badges + toggle favori + 2 liens ; parcourir sans connaître le nom exact est fatigant. → `/impeccable layout`

**[P2] Callout `/aide` en `border-l-4 border-accent-500`** (B, détecteur) — Side-stripe border bannie + hors convention de couleur projet (accent réservé badges temps/féculents/placard). Remplacer par une bordure fine pleine ou `border-brand-200`. → `/impeccable polish`

**[P3] Suppression de compte manque la réassurance contextuelle appliquée ailleurs** (A) — Contraste avec « Quitter le foyer » qui détaille précisément les conséquences ; ici le texte reste générique (« irréversible ») sans dire ce qui disparaît concrètement (recettes perso, historique, foyer entier si solo). → `/impeccable clarify`

**[P3] Contraste à vérifier : libellés secondaires `/reglages`** (« N recettes éligibles ») (B) — Gris-vert clair sur fond crème, visuellement faible pour du texte même secondaire ; à mesurer (cible ≥4.5:1 déjà documentée dans CLAUDE.md pour toute couleur). → `/impeccable audit`

# Persona red flags

**Jordan (première utilisation)** : arrive sur un planning frais et voit 14 blocs répétitifs avec pictogrammes non expliqués et deux actions dont la nuance n'est pas évidente au premier coup d'œil (Changer = remplacement aléatoire instantané avec toast, Sélectionner = recherche manuelle — rien ne distingue visuellement les deux avant de cliquer). Bloqué sur un badge, pas de « ? » à portée dans la nav.

**Casey (mobile, mains occupées)** : `/ce-soir` répond bien à son besoin réel, mais la landing par défaut de la nav reste `/planning` — s'il y atterrit par réflexe, 4200 px de scroll pour retrouver le repas du jour au milieu de 13 autres.

**Sam (accessibilité)** : fondamentaux solides (`role="alert"`, `aria-invalid`, focus renvoyé, contraste AA visé, dark mode par tokens — confirmé sur les captures dark par B). Angle mort spécifique : les badges compacts n'ont un filet que pour lecteur d'écran (`aria-label`) — un utilisateur basse vision qui voit mais déchiffre mal les petites icônes n'a aucun repère textuel de proximité.

# Observations mineures

- Sélecteur de jour de courses `/profil` : « L M M J V S D » — deux « M » identiques (Mardi/Mercredi), à confirmer que chaque bouton porte un `aria-label` complet distinct (probable, non vérifié en code).
- Dialog « Ajouter un article » capturé dans le tiers supérieur d'une longue page plutôt qu'ancré en bas — probable artefact de la capture plein-page stitchée (bottom sheet `position: fixed`), à revérifier en usage réel si pas déjà fait.
- Toast Sonner figé au milieu de deux captures (`12`, `15`) — artefact de capture plein-page (position fixe figée au scroll du moment), pas un défaut produit.
- Capture `18-recettes-liste.png` : rapport d'aspect extrême (page de ~150 recettes en une seule image), lecture fine impossible sans segmentation — limite méthodologique, pas un constat produit.
- Capture `03-login-erreur.png` : bouton encore en état « Connexion… » et badge DevTools rouge « 1 Issue » visibles, sans bandeau d'erreur inline capturé — probable timing de capture trop précoce, mais **à vérifier manuellement** que le message d'erreur s'affiche bien et qu'aucune exception JS ne remonte sur ce parcours (ne peut pas être tranché depuis une capture statique seule).

# Suite e2e complète — 97/99 passés (staging, local)

Suite intégrale (99 tests, ~9 min) rejouée en local contre staging à la demande explicite de l'utilisateur, en plus du protocole standard. 2 échecs, détaillés en Priority Issues P0/P1 ci-dessus (undo cassé, tri post-décoche). Tout le reste — temps réel (coches, alerte planning), cycle de courses, foyer (invitation/jonction/clonage/RG-29), onboarding, RGPD (CGU, cookies, DNT), suppression de compte (solo + partagé) — passe. Aucun signe de régression transverse : les 2 échecs sont isolés à leurs mécanismes propres (undo, tri post-décoche), pas symptomatiques d'un problème plus large.

# Questions provocatrices

- `/planning` est généré tout déplié d'entrée — un vrai besoin, ou l'héritage d'une grille qui a grossi fonctionnalité après fonctionnalité (#45, #86, #23, #49, #217…) sans jamais revenir réduire la densité par défaut ?
- `/ce-soir` prouve que l'équipe sait produire un écran minimal et focalisé — pourquoi cette discipline ne s'applique-t-elle qu'à une page annexe et pas à la page d'atterrissage principale ?
- Si l'aide contextuelle justifie une page entière soignée, pourquoi disparaît-elle de la navigation au moment précis où on est en train d'*utiliser* l'app et le plus susceptible d'en avoir besoin ?
- La suppression de compte réutilise le patron « ré-authentification + mot magique » de `ChangerMotDePasse` — est-ce le bon niveau de gravité pour la seule action véritablement irréversible du produit, comparé au soin narratif mis sur « quitter le foyer » ?
