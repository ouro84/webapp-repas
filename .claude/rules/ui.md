---
paths:
  - "app/**/*.tsx"
  - "app/globals.css"
  - "app/manifest.ts"
  - "components/**/*.tsx"
---

# UI : design system, thème, nav, composants partagés

## Tailwind v4 : configuration dans `app/globals.css`

Toute la config vit dans `app/globals.css` via `@theme` ; chaque token `--color-X-Y` devient `bg-X-Y` / `text-X-Y` / `border-X-Y`. Un `tailwind.config.js` serait ignoré silencieusement. Les utilitaires compilent en `var(--color-*)`, ce qui rend possible le dark mode par override de tokens.

## Couleurs : palettes maison et sémantique

- Palettes : `brand-*` (vert), `accent-*` (terracotta, `50/100/500/600/700/800`), `canvas` (fond crème). La palette Tailwind standard (`green-600`…) casse la cohérence.
- **Vert = couleur interactive** (hovers, liens, boutons). **Accent terracotta = épice de marque**, réservé aux badges temps « normal »/« long », au badge accompagnement féculents et à la section « Fond de placard » de `/courses`.
- **États sémantiques** en palettes Tailwind standard : `red-*` = erreur, `amber-*` = avertissement/prudence (distinct de l'accent de marque).
- **Tokens sémantiques** à utiliser à la place des steps bruts :
  - `bg-surface` à la place de `bg-white` ;
  - `bg-primary` / `hover:bg-primary-hover` pour les boutons d'action ;
  - `bg-danger` / `-hover` pour le bouton destructif ;
  - `backdrop:bg-black/50` pour les backdrops de dialog.
  Pourquoi : l'échelle brand sert à la fois de texte (`text-brand-700`) et de fond de bouton (`bg-brand-600`) ; le dark mode redéfinit les valeurs des tokens au lieu de flipper la rampe, qui casserait les boutons.
- Toute nouvelle couleur se définit pour les **deux modes** (bloc `:root[data-theme="dark"]`, avec variantes sombres dédiées pour `red-*`/`amber-*`) et vise un contraste ≥ 4.5:1.

## Thème clair/sombre

Store `lib/theme.ts` (`useSyncExternalStore`, clé localStorage `theme` ∈ clair/sombre/système). Contrôle : `components/ui/selecteur-theme.tsx`, dans la section « Préférences » de `/profil` (un réglage cosmétique rare n'occupe pas la nav). Un script anti-FOUC, premier enfant du `<body>` de `app/layout.tsx` (`<html suppressHydrationWarning>`), pose `data-theme` avant le paint.

## Typographie

`next/font/google` dans `app/layout.tsx` : **Nunito** = corps (`--font-sans`), **Fredoka** = display (`font-display`), **Geist_Mono** = mono, utilisé seulement par le digest d'erreur de `app/error.tsx`. La display s'applique au wordmark de la nav, au hero d'accueil et aux **`h1`**, en `font-semibold`. Les `h2` de section et de dialog restent en police de corps, pour la scannabilité.

## Marque et icônes

- Nom « On mange quoi ? », baseline « La question du soir a enfin sa réponse ». Logo `components/ui/logo.tsx` : `fill="currentColor"`, `aria-hidden`, couleur via `text-brand-*`. Favicon `app/icon.svg` (couleurs en dur, hors contexte CSS).
- **Logo Chronodrive** (`components/ui/logo-chronodrive.tsx`) : symbole « app » du sprite officiel de l’enseigne, monochrome, SVG inline en `currentColor` + `aria-hidden`, couleur via `text-*` du parent ; il remplace une icône générique dans le titre de la carte Panier Chronodrive. Ne pas redessiner sa géométrie : elle vient du sprite (`var(--icon-color)` → `currentColor`). Pourquoi : un logo de marque tiers reste fidèle à l’original, et `currentColor` le suit en dark mode sans variante dédiée.
- **Icônes : SVG inline ou `lucide-react`**, jamais d'emoji ni de glyphe Unicode (y compris `↑↓`).
- Icônes déjà prises, à éviter pour un nouvel usage : `Leaf` (végé), `TreeDeciduous` (automne), `Wheat`/`Carrot` (accompagnement), `CookingPot` (restes), `RefreshCw`/`Search`/`MoreHorizontal` (actions de slot), `SlidersHorizontal` (réglages), `HelpCircle` (aide), `Heart`/`Ban` (préférences), `CalendarDays`/`ShoppingCart`/`BookOpen`/`Clock` (nav), `Eye`/`PenLine` (droits du consentement OAuth).

## Nav (`components/ui/nav.tsx`)

- **État actif via `estActif(pathname, href)`** : `/` en égalité stricte, les sections en `startsWith` (sinon le logo paraîtrait actif partout). Logo actif : pastille `bg-brand-50` + `aria-current="page"`.
- **Nav applicative réservée aux connectés** : sinon (login, signup, `/`, `/aide`) elle se réduit au logo + « Aide », pour éviter des liens qui rebondissent vers `/login`. Signal : `useEstConnecte()` (`lib/session.ts`, snapshot initial `null`) ; tant qu'il vaut `null`, on retombe sur `ROUTES_PROTEGEES` (le proxy y garantit la session), d'où pas de scintillement.
- **Nav masquée sur `/bienvenue` et `/oauth/*`** (parcours focalisés : onboarding, consentement OAuth #305). Ces écrans portent le logo en tête pour l'ancrage de marque.
- **Budget de largeur mobile saturé.** Les liens de section passent par `LienSection` : icône seule sous `sm:`, libellé à partir de `sm:`. Pourquoi : sans `flex-wrap` ni `overflow-x: hidden` global (volontaire, un débordement doit rester visible), 4 libellés texte faisaient déborder le `body` à 390 px.
  - `aria-label={label}` reste posé en permanence : le libellé masqué par `hidden` sort de l'arbre d'accessibilité. Le nom accessible est donc identique aux deux paliers, et les e2e `getByRole("link", { name })` en dépendent.
  - Tout nouveau lien de nav passe par `LienSection` avec une icône et se re-mesure à **320 px** (marge ~20 px).

## Animations et micro-interactions

- Tokens `--animate-apparition` / `--animate-crossfade` / `--animate-spin-once` dans `globals.css`, **transform/opacity uniquement** (pas de reflow).
- Reset global `@media (prefers-reduced-motion: reduce)` dans `globals.css`, plus `motion-safe:` / `motion-reduce:` dans les composants. Ce reset en `*` n'atteint pas les `::view-transition-*` (cf. `courses-cycle.md`).
- **Stagger de `/planning` rejoué par un nonce** : la génération ne vide pas l'écran, donc les `<li key={jour}>` ne se remontent pas. `genNonce` (state), bumpé seulement dans `genererNouveauPlanning`, sert de `key` aux deux grilles (mobile + desktop). Un remplacement de slot ou un changement de personnes ne le bumpe pas, sinon toute la grille re-animerait à chaque édition.
- Feedback `active:scale` : utilitaire **`transition`** (couleur + transform), sur les boutons d'action (CTA, actions de slot, steppers, modales, submit). Les switches, liens de nav et lignes de liste en sont exclus.

## Texte JSX

- **Une phrase qui commence par `{expression}` suivie de texte se compose en chaîne** (`{`${nom} pourra…`}`) ou avec un `{" "}` explicite. Pourquoi : sur `/oauth/consent`, le compilateur Next a mangé l'espace (« Claudepourra ») alors que Vitest le rendait correctement ; seul l'e2e l'a vu.

## Composants partagés

- **Switch on/off = `components/ui/interrupteur.tsx`** (`<Interrupteur actif onChange libelleId? label? />`) pour tout `role="switch"`. L'appelant fournit l'intitulé (`libelleId` ou `label`). Pourquoi : des switches inline divergents avaient un curseur désynchronisé de la piste et faux en dark mode ; `tests/interrupteur.test.tsx` verrouille la cohérence.
- **Confirmation** : `components/ui/confirmation.tsx` (`ConfirmationModale`, prop `sansAnnuler` pour une action unique).
- **Bottom sheet + clavier mobile** (cf. `SelecteurRecette`), deux parades complémentaires : `viewport.interactiveWidget: "resizes-content"` dans `app/layout.tsx` (Android/Chrome) **et** `useClavierVirtuel()` de `lib/clavier.ts` (iOS/Safari, `visualViewport`) qui applique `marginBottom` + `maxHeight` inline. `dvh` suit la chrome du navigateur, pas le clavier. Calcul pur testable : `hauteurOccultee()`.
- **Hero d'accueil** : `components/ui/apercu-planning.tsx` affiche 3 cartes factices, `aria-hidden` et non interactives, qui réutilisent `BadgeTemps` / `BadgeVegetarien` pour rester fidèles au rendu réel.
- **Badges** : `badge-vegetarien.tsx` (`Leaf`), `badge-accompagnement.tsx` (`Wheat` accent / `Carrot` brand), `badge-saison.tsx` (style outline, automne = `TreeDeciduous` pour ne pas se confondre avec `Leaf`). Prop `compact` = icône seule + `aria-label`.
- **Bandeau cookies dans le flux normal** (`app/layout.tsx`, `body` en `flex flex-col`), jamais en `fixed`/`sticky`. Pourquoi : en `fixed`, il interceptait les clics sur les boutons de bas de page (ex. « Se déconnecter » de `/profil`) ; dans le flux, les zones `flex-1` se réduisent et le chevauchement devient impossible.

## Carte de slot du planning (`components/planning/slot-repas.tsx`)

- Les actions Changer / Sélectionner / Restes sont repliées derrière un bouton « Plus d'actions » (`aria-expanded`, `MoreHorizontal`), replié par défaut à chaque montage. Les variantes « restes » et « créneau désactivé » n'ont pas ce toggle.
- La légende des badges est affichée **une fois** en tête de `/planning`, pas par carte.
- Déclencheur de la fiche recette = le **nom du plat** (`<button>`), pas la carte entière, pour éviter d'imbriquer des interactifs.

## PWA

`app/manifest.ts` est servi en `/manifest.webmanifest`, `<link rel="manifest">` auto-injecté par Next. `theme_color` passe par `viewport.themeColor`. Trois `purpose` : `any`, `maskable`, `monochrome` (mark blanc sur transparent). iOS ignore le manifest : `app/apple-icon.png` + `metadata.appleWebApp` font foi. Pas de service worker (choix volontaire, l'offline complet est un chantier séparé).
