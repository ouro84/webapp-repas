// Interrupteur on/off accessible (switch) — composant PARTAGÉ (#204).
//
// Source unique de vérité pour tous les switches de l'app. Avant #204, deux
// implémentations bespoke divergeaient (/bienvenue vs /reglages) : la variante
// onboarding (positionnement `absolute` + translate arbitraire + `bg-white`)
// rendait un curseur désynchronisé/cassé, notamment en dark mode. On reprend ici
// le markup sain (`inline-flex items-center`, token `bg-surface`, `translate-x-5`)
// pour neutraliser le bug ET sa classe (plus de divergence possible).
//
// Le composant ne rend QUE le contrôle (piste + curseur), pas le libellé : chaque
// appelant fournit son intitulé soit via `libelleId` (aria-labelledby, ex.
// /reglages où le label porte un id), soit via `label` (aria-label, ex. l'écran
// d'onboarding où le texte est dans un <label> englobant).

type Props = {
  actif: boolean;
  onChange: (actif: boolean) => void;
  /** id de l'élément qui décrit le switch (aria-labelledby). */
  libelleId?: string;
  /** libellé accessible direct (aria-label), si pas de libelleId. */
  label?: string;
};

export function Interrupteur({ actif, onChange, libelleId, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-labelledby={libelleId}
      aria-label={label}
      onClick={() => onChange(!actif)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        actif ? "bg-primary" : "bg-brand-200"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-surface shadow transition-transform ${
          actif ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
