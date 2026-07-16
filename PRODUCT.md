# Product

## Register

product

## Users

Foyers (1 à N personnes) qui veulent arrêter de se demander « on mange quoi ce soir ? ». Usage mobile-first : consultation/édition en cuisine ou en magasin, pas au bureau devant un grand écran. Contexte réel = mains occupées, connexion parfois faible, décision rapide (choisir un repas, cocher un article, changer une recette en 2 taps). Le foyer peut être partagé (plusieurs membres, même liste de courses, même planning en temps réel) — pas un outil solo strict.

## Product Purpose

Génère automatiquement un planning de repas hebdomadaire (14 créneaux : déjeuner/dîner × 7 jours), personnalisable (temps de préparation, végétarien, saisonnalité, favoris/évités), et en déduit une liste de courses agrégée et catégorisée. Succès = l'utilisateur n'a plus à réfléchir à « quoi cuisiner » ni à « qu'est-ce qu'il manque » — la charge mentale de la planification hebdo est déportée sur l'outil, pas sur lui.

## Brand Personality

Chaleureux, simple, rassurant. Le ton est celui d'un ami qui a déjà réfléchi au repas à ta place — jamais un outil de productivité froid. La rondeur typographique (Fredoka + Nunito), la palette verte/terracotta et le langage 100 % français, sans jargon technique visible côté UI, portent cette chaleur. Simple veut dire : peu de décisions à prendre, des états vides rassurants plutôt qu'anxiogènes, jamais un blocage dur (la génération ne doit jamais échouer — dégradation gracieuse partout).

## Anti-references

Pas de SaaS froid/corporate : pas de bleu/gris générique, pas de grilles de cartes identiques façon dashboard B2B, pas de vocabulaire technique exposé à l'utilisateur (ex. « masquer » une recette catalogue reste invisible, verbe uniforme « Supprimer »). Pas de glassmorphism, pas de gradient text, pas d'eyebrow/numérotation de section décorative — l'app n'a pas de posture « landing page », c'est un outil du quotidien.

## Design Principles

- **Ça ne bloque jamais.** Toute contrainte (temps, végé, saison, mix légumes, variété, préférences) est un biais avec repli, jamais un filtre dur qui ferait échouer la génération. L'UI reflète ce principe : avertissement doux (toast, badge) plutôt qu'erreur bloquante.
- **Chaleureux sans être enfantin.** Rondeur typographique et palette naturelle réservées à la marque + titres de page ; le corps du texte reste sobre et scannable. La couleur a un sens (vert = interactif, terracotta = épice/placard, amber = prudence) — jamais décorative.
- **Fait pour des mains occupées.** Mobile-first, gestes courts (tap pour cocher, changer, marquer restes), feedback immédiat (`active:scale`, toasts, undo transitoire) plutôt que des confirmations qui ralentissent le geste du quotidien.
- **Transparence discrète.** Les mécanismes internes (masquage vs suppression, biais de génération, foyer vs user) restent invisibles côté UX ; l'utilisateur voit un verbe simple et cohérent, jamais l'implémentation qui le sert.
- **Accessible par défaut, pas en option.** Contraste AA (≥4.5:1) vérifié à chaque nouvelle couleur, dark mode par tokens sémantiques (pas un flip de palette), `prefers-reduced-motion` respecté partout — non négociable, pas un chantier « plus tard ».

## Accessibility & Inclusion

Niveau AA (WCAG 2.1) — déjà en place et à maintenir : contrastes texte ≥4.5:1 vérifiés en commentaire de code pour chaque token, dark mode complet via tokens sémantiques (`--color-surface`, `--color-primary`, `--color-danger`), reset global `prefers-reduced-motion` (animations → instantané) en plus des variantes `motion-safe:`/`motion-reduce:` par composant. Pas d'exigence AAA formelle. Toute nouvelle couleur ou animation doit être vérifiée contre ces mêmes seuils avant merge.
