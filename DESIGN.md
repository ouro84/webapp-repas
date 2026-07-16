---
name: On mange quoi ?
description: Génère ton planning de repas de la semaine et la liste de courses qui va avec.
colors:
  herbe-fraiche-50: "#edf7ee"
  herbe-fraiche-100: "#d4ecd6"
  herbe-fraiche-200: "#aad9ae"
  herbe-fraiche-500: "#4a9454"
  herbe-fraiche-600: "#3d7a44"
  herbe-fraiche-700: "#2e5e34"
  herbe-fraiche-900: "#1a3820"
  terracotta-50: "#fef0ec"
  terracotta-100: "#fdddd3"
  terracotta-500: "#d4683a"
  terracotta-600: "#b85530"
  terracotta-700: "#8a3f20"
  terracotta-800: "#5f2c15"
  creme: "#fafaf5"
  surface: "#ffffff"
  danger: "#dc2626"
  danger-hover: "#b91c1c"
typography:
  display:
    fontFamily: "Fredoka, ui-rounded, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Nunito, Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Nunito, Arial, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  mono:
    fontFamily: "Geist Mono, monospace"
rounded:
  badge: "9999px"
  pill: "9999px"
  card: "8px"
  dialog: "16px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.herbe-fraiche-600}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.herbe-fraiche-700}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.herbe-fraiche-700}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
  badge-temps-rapide:
    backgroundColor: "{colors.herbe-fraiche-50}"
    textColor: "{colors.herbe-fraiche-700}"
    rounded: "{rounded.badge}"
  badge-temps-long:
    backgroundColor: "{colors.terracotta-100}"
    textColor: "{colors.terracotta-700}"
    rounded: "{rounded.badge}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.dialog}"
---

# Design System: On mange quoi ?

## 1. Overview

**Creative North Star: "Le compagnon de frigo"**

« On mange quoi ? » n'est pas un outil de productivité qu'on ouvre en pensant à un tableau de bord — c'est le pote qui a déjà réfléchi au repas à ta place et qui te le glisse sans en faire un événement. L'interface se pense pour des mains occupées (en cuisine, dans les rayons du magasin), pas pour un écran de bureau : gestes courts, feedback immédiat, jamais de blocage. La rondeur du pairing Fredoka/Nunito, la palette vert herbe fraîche + terracotta épicée, et le refus systématique du jargon technique visible portent cette complicité décontractée plutôt qu'une froideur d'outil.

Ce système rejette explicitement l'esthétique SaaS/corporate : pas de bleu-gris générique, pas de grilles de cartes identiques façon dashboard B2B, pas de glassmorphism ni de texte en dégradé, pas d'eyebrow ou de numérotation décorative de section. Ce n'est pas une landing page qui vend — c'est un objet du quotidien qu'on ouvre trois fois par semaine, en 30 secondes, sans réfléchir à l'UI elle-même.

**Key Characteristics:**
- Rondeur partout où c'est tactile (boutons, switches, badges en pilule), jamais anguleux
- Couleur porteuse de sens (vert = interactif, terracotta = épice/placard, amber = prudence), jamais décorative
- Plat structuré par la bordure + une ombre discrète, pas de profondeur marquée
- Aucune contrainte de génération n'est jamais bloquante — l'UI reflète ce filet de sécurité par des avertissements doux, jamais des erreurs dures

## 2. Colors

Une palette naturelle à deux voix : le vert porte tout ce qui est interactif, le terracotta est réservé aux touches d'épice (temps de cuisson, placard, féculents). Le fond crème remplace le blanc/gris froid habituel des interfaces produit.

### Primary
- **Herbe fraîche** (#3d7a44) : couleur d'action — boutons principaux (`bg-primary`), liens actifs de nav, anneaux de focus. C'est LA couleur interactive de l'app ; rien d'autre n'hérite ce rôle.

### Secondary
- **Terracotta épicée** (#b85530 / accent-600) : l'épice de la marque, réservée à des touches précises — badges de temps « normal »/« long », badge féculents, section « Fond de placard » de la liste de courses. Jamais utilisée pour un hover générique.

### Neutral
- **Crème** (#fafaf5) : fond de page (`canvas`) — chaleureux, jamais blanc pur ni gris froid.
- **Surface** (#ffffff) : fond des cartes, dialogs, nav, inputs.
- **Vert profond** (#1a3820, brand-900) : texte fort / titres — remplace le noir pur, plus chaleureux.
- **Vert tendre** (#edf7ee / #d4ecd6, brand-50/100) : fonds légers de hover, bordures de séparation.

### Named Rules
**La règle du vert unique.** Le vert est la seule couleur interactive de l'app (hovers, liens, boutons, focus). Ne jamais teinter un hover générique en terracotta — cette couleur est réservée à l'épice de marque, pas à l'action.

**La règle de la couleur qui ne suffit jamais seule.** Aucune information n'est portée par la couleur seule (ex. temps « normal »/« long » partagent le terracotta → une horloge graduée en icône + le libellé texte lèvent l'ambiguïté). Vérifier ce doublon à chaque nouveau badge.

## 3. Typography

**Display Font:** Fredoka (avec fallback `ui-rounded, sans-serif`)
**Body Font:** Nunito (avec fallback `Arial, Helvetica, sans-serif`)
**Label/Mono Font:** Geist Mono — usage unique et volontairement restreint au digest d'erreur technique

**Character:** Un pairing rond et chaleureux — Fredoka porte la marque et les titres de page avec une présence ludique mais jamais criarde (toujours en `font-semibold`, jamais 700 : les rondes paraissent lourdes en gras plein) ; Nunito porte tout le reste avec une lisibilité neutre et sans prétention.

### Hierarchy
- **Display** (600, 1.875rem/`text-3xl`, 1.2) : wordmark de nav, hero d'accueil, et **uniquement** les `h1` de page (planning, courses, réglages, recettes, profil, formulaires auth). Jamais sur un `h2` de section ou de dialog.
- **Title** (700, `text-lg`, 1.3) : `h2` de section et titres de dialog — reste en corps (Nunito) pour la scannabilité, pas en display.
- **Body** (400, 1rem, 1.5) : texte courant, description, contenu de fiche recette.
- **Label** (500, 0.75rem, `text-xs`) : badges, labels de formulaire, texte de switch.

### Named Rules
**La règle de la marque, pas du contenu.** Fredoka s'applique à la marque + aux titres de page (`h1`), jamais aux `h2` fonctionnels de section/dialog. Une display sur un `h2` est une dérive de la convention, pas une variante acceptable.

## 4. Elevation

Système plat structuré par la bordure : la hiérarchie visuelle vient d'abord de `border border-brand-100` et du contraste `surface` sur `canvas`, jamais d'une ombre marquée. Une `shadow-sm` très discrète accompagne certaines cartes (aperçus, encadrés d'état) comme un liseré doux, pas comme un effet de profondeur. Les dialogs (bottom sheets, confirmations) seuls portent une `shadow-xl` réelle — logique : ils flottent au-dessus du contenu et le `backdrop:bg-black/50` doit se lire comme un vrai changement de plan.

### Shadow Vocabulary
- **Discrète** (`shadow-sm`) : cartes de planning, encadrés d'aperçu — un soutien visuel léger, jamais la source de la hiérarchie.
- **Flottante** (`shadow-xl`) : dialogs natifs (`<dialog>` + `backdrop:bg-black/50`) — le seul cas de vraie élévation dans le système.

### Named Rules
**La règle du plat-par-défaut.** Au repos, toute surface (carte, bouton, badge) est plate — bordure ou fond coloré, pas d'ombre. L'ombre n'apparaît que pour un élément qui flotte réellement au-dessus du contenu (dialog), jamais en décoration d'une carte statique.

## 5. Components

Doux et accueillant : coins très ronds partout où c'est tactile, jamais anguleux — cohérent avec le pairing rond Fredoka/Nunito.

### Buttons
- **Shape:** `rounded-full` (pilule complète) — sans exception sur les CTA et actions.
- **Primary:** `bg-primary` (#3d7a44) / texte blanc, `px-5 py-2.5`, `font-semibold`.
- **Hover / Focus:** `hover:bg-primary-hover` (#2e5e34) ; `focus-visible:outline-2 outline-offset-2 outline-brand-600` ; feedback tactile `active:scale-[0.97]` (désactivé sous `motion-reduce`).
- **Secondary / Ghost:** fond `surface`, texte `brand-700`, `border border-brand-200`, même forme pilule.
- **Danger:** `bg-danger` (#dc2626) / `hover:bg-danger-hover`, réservé aux actions destructives (suppression de compte, suppression de recette).

### Badges (chips)
- **Style:** `rounded-full` pilule, `px-2 py-0.5`, `text-xs font-medium`. Icône lucide + libellé texte systématique — jamais l'icône seule sauf en variante `compact` explicitement documentée avec `aria-label`.
- **State:** pas de variante sélectionnée/désélectionnée — les badges sont informatifs (temps, végétarien, accompagnement, saison), pas des filtres cliquables.

### Cards / Containers
- **Corner Style:** `rounded-lg` (8px) pour les cartes de contenu (planning, aperçus) ; `rounded-2xl`/`rounded-t-2xl` (16px) pour les dialogs/bottom sheets.
- **Background:** `bg-surface` sur `bg-canvas` — jamais `bg-white` littéral (le token `surface` porte le dark mode).
- **Shadow Strategy:** voir Elévation — `shadow-sm` discrète pour les cartes, `shadow-xl` pour les dialogs.
- **Border:** `border border-brand-100` quasi systématique sur les cartes de contenu.
- **Internal Padding:** `p-3` à `p-4` sur les cartes, `p-6` sur le corps des dialogs.

### Inputs / Fields
- **Style:** `rounded-lg`, `border border-brand-200`, fond `bg-surface`, `px-3 py-2.5 text-sm`.
- **Focus:** `focus:outline-2 outline-offset-1 outline-brand-600` — pas de glow, un contour net.
- **Error / Disabled:** encadrés `red-*`/`amber-*` dédiés (jamais l'accent terracotta pour un état d'erreur ou d'avertissement).

### Switch (Interrupteur)
Composant partagé unique (`components/ui/interrupteur.tsx`) pour tous les switches de l'app. Piste `h-6 w-11 rounded-full` : `bg-primary` actif / `bg-brand-200` inactif. Curseur `size-5 rounded-full bg-surface`, `translate-x-5` actif / `translate-x-0.5` inactif, `shadow` léger. Jamais de positionnement absolu bespoke — toujours ce composant.

### Navigation
`sticky top-0` avec `bg-surface/90 backdrop-blur-sm`. Liens en pilule (`rounded-full px-4 py-1.5`), état actif = fond `bg-primary` + texte blanc pour les liens de section, pastille `bg-brand-50` pour le logo/accueil. Zone tactile étendue verticalement via un pseudo-élément `after:` (`-inset-y-2`) pour rester ≥44px sans agrandir le visuel. Mobile : wordmark masqué, seul le mark (logo) + pastille active restent visibles.

### Toast (annulation, avertissement)
Via `sonner` — feedback léger et non bloquant pour les avertissements de génération (« récent non honoré », etc.) et l'annulation transitoire (undo). Cohérent avec le principe « ça ne bloque jamais » : jamais une modale pour un avertissement, toujours un toast.

## 6. Do's and Don'ts

### Do:
- **Do** garder le vert (#3d7a44 / `bg-primary`) comme unique couleur interactive — hovers, liens, boutons, focus.
- **Do** utiliser `rounded-full` sur tout élément tactile (boutons, badges, switches, liens de nav) — la rondeur est la signature du système.
- **Do** faire porter le sens par icône lucide + libellé texte ensemble, jamais la couleur seule (le terracotta « normal »/« long » partage la même teinte).
- **Do** utiliser les tokens sémantiques (`bg-surface`, `bg-primary`, `bg-danger`) plutôt que les valeurs brutes `bg-white`/`bg-green-600`/`bg-red-600` — c'est ce qui fait fonctionner le dark mode.
- **Do** réserver le terracotta (accent) aux touches précises de marque : temps de cuisson long, féculents, fond de placard.

### Don't:
- **Don't** utiliser de bleu/gris générique façon SaaS corporate — la palette est vert herbe fraîche + terracotta, point.
- **Don't** faire des grilles de cartes identiques façon dashboard B2B — varier l'affordance selon ce qu'elle sert réellement.
- **Don't** utiliser de gradient text, de glassmorphism décoratif, ou d'eyebrow/numérotation de section — l'app n'a pas de posture landing page.
- **Don't** utiliser d'emoji ou de glyphe Unicode comme icône — SVG inline ou `lucide-react` uniquement.
- **Don't** ajouter une ombre marquée à une carte statique au repos — l'élévation réelle (`shadow-xl`) est réservée aux éléments qui flottent (dialogs).
- **Don't** appliquer `font-display` à un `h2` de section ou de dialog — réservé à la marque et aux `h1` de page.
- **Don't** repeindre les encadrés `amber-*` (prudence) ou `red-*` (erreur) en terracotta — ce sont des rôles sémantiques distincts de l'accent de marque.
