// Squelettes des trois blocs de /profil chargés en différé (#400, RG-09) :
// identité (`EditionIdentite`), foyer (`PanneauFoyer`) et assistants connectés
// (`AssistantsConnectes`). Le reste de la page est déjà rendu : chaque bloc est
// donc sa propre `ZoneChargement` (`section`), qui garde le `h2` réel.
//
// Chaque squelette reprend les classes de boîte ET l'imbrication de l'état
// chargé, pour ne rien décaler au remplacement (CLS, cf. ui.md) :
// - textes fixes (titres, libellés, légendes) = vrai texte ;
// - données (phrase du foyer, noms et dates d'assistants) = `TexteSquelette` ;
// - contrôles (avatar, champs, boutons, sélecteur, pastilles) = `Squelette`.
// Hauteurs calculées sur le chargé, pas devinées : `text-sm` = 20 px de ligne,
// `text-base` = 24 px, champ `py-2.5` + bordure = 46 px, bouton `py-2.5` = 40 px
// (46 px une fois étiré en rangée à partir de `sm:`), pastille `size-9` = 36 px.
//
// Le `h2` est sous le `aria-hidden` de `ZoneChargement` : il disparaît de
// l'arbre d'accessibilité pendant le chargement (la zone annonce « Chargement… »)
// et revient avec le bloc chargé. `aria-labelledby` n'a plus d'objet sur une
// zone `role="status"` : il n'est repris que par l'état chargé.
import { Squelette, TexteSquelette, ZoneChargement } from "@/components/ui/squelette"

// 8 pastilles de couleur : le nombre de `PALETTE_AVATAR`.
const NB_PASTILLES = 8

/** « Mon identité » : avatar, prénom, bouton, palette de couleurs (246 px mobile, 208 px desktop). */
export function SqueletteIdentite() {
  return (
    // Hauteur réservée ≈ section chargée (246 px mobile, 208 px desktop).
    <ZoneChargement as="section" className="mb-8 min-h-[15.4rem] md:min-h-[13rem]">
      <h2 id="section-identite" className="mb-4 text-lg font-semibold text-brand-900">
        Mon identité
      </h2>

      <div className="flex items-center gap-4">
        <Squelette className="size-20 shrink-0 rounded-full" />
        <div className="flex-1">
          <p className="mb-1 block text-sm font-medium text-brand-900">Prénom</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* `sm:flex-1` seulement : en colonne, `flex-1` (base 0) écraserait la hauteur. */}
            <Squelette className="h-[2.875rem] rounded-full sm:flex-1" />
            {/* Étiré en rangée (`sm:h-auto`), pleine largeur en colonne. */}
            <Squelette className="h-10 rounded-full sm:h-auto sm:w-32" />
          </div>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-brand-900">Couleur de l’avatar</legend>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: NB_PASTILLES }, (_, i) => (
            <Squelette key={i} className="size-9 rounded-full" />
          ))}
        </div>
      </fieldset>
    </ZoneChargement>
  )
}

/** « Mon foyer » d'un foyer solo : phrase, carte jour de courses, carte invitation, rejoindre (538 px mobile, 490 px desktop). */
export function SqueletteFoyer() {
  return (
    // Hauteur réservée ≈ panneau chargé d'un foyer solo (538 px mobile, 490 px desktop).
    <ZoneChargement as="section" className="mb-8 min-h-[33.6rem] md:min-h-[30.6rem]">
      <h2 id="section-foyer" className="mb-1 text-lg font-semibold text-brand-900">
        Mon foyer
      </h2>
      <p className="mb-4 text-sm text-brand-700/85">
        <TexteSquelette>
          Tu es seul·e dans ton foyer. Invite quelqu’un pour tout partager : recettes, planning et liste de courses.
        </TexteSquelette>
      </p>

      {/* Jour de courses : carte `bg-surface`, donc teinte « carte ». */}
      <div className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4">
        <h3 className="mb-1 font-medium text-brand-900">Jour de courses</h3>
        <p className="mb-3 text-sm text-brand-700">
          Ta liste de courses couvre 7 jours à partir de ce jour.
        </p>
        {/* Sélecteur : 7 × min-w-9 + p-0.5 + bordure = 258 × 38 px. */}
        <Squelette sur="carte" className="h-[2.375rem] w-[16.125rem] rounded-full" />
      </div>

      {/* Inviter : cette carte n'a pas de `bg-surface` (fond de page), donc teinte « fond ». */}
      <div className="mb-6 rounded-2xl border border-brand-100 p-4">
        <Squelette className="h-10 w-[10.5rem] rounded-full" />
      </div>

      {/* Rejoindre (foyer solo). */}
      <div className="mb-6">
        <p className="mb-2 block text-sm font-medium text-brand-900">Rejoindre un foyer</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Squelette className="h-[2.875rem] rounded-full sm:flex-1" />
          <Squelette className="h-10 rounded-full sm:h-auto sm:w-28" />
        </div>
      </div>
    </ZoneChargement>
  )
}

// Assistants fictifs : deux lignes réservées (une ligne chargée = 38 px, le bouton).
// Noms volontairement génériques : un vrai nom de client (« Claude », « Hermes »)
// ferait trouver le texte transparent par `getByText` dans les tests.
const ASSISTANTS_FICTIFS = ["Assistant IA", "Autre assistant"]

/** « Assistants connectés » : deux lignes de la hauteur d'une ligne chargée. */
export function SqueletteAssistants() {
  return (
    <ZoneChargement as="section" className="mb-8">
      <h2 id="titre-assistants" className="mb-4 text-lg font-semibold text-brand-900">
        Assistants connectés
      </h2>
      <ul className="flex flex-col gap-3">
        {ASSISTANTS_FICTIFS.map((nom) => (
          <li key={nom} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-brand-900">
              <TexteSquelette>{nom}</TexteSquelette>
              <span className="block text-xs font-normal text-brand-700/85">
                <TexteSquelette>autorisé le 14 février 2026</TexteSquelette>
              </span>
            </span>
            {/* Bouton « Déconnecter » : py-2 + ligne 20 px + bordure = 38 px. */}
            <Squelette className="h-[2.375rem] w-28 rounded-full" />
          </li>
        ))}
      </ul>
    </ZoneChargement>
  )
}
