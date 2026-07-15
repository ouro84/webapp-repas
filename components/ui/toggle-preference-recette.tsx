"use client";

// Toggle favori/évité d'une recette (#219, US-49, RG-58/63).
//
// Biais SOUPLE de génération, JAMAIS un filtre dur (RG-59) — bascule directe
// entre 3 états (favorite/evitee/neutre) : cliquer sur l'état déjà actif
// revient au neutre (toggle off) ; cliquer sur l'autre bascule directement
// (RG-63, pas besoin de repasser par neutre).
//
// Composant PRÉSENTATIONNEL : l'appelant porte le chargement/la persistance
// (chargerPreference(s)/definirPreference, lib/preferences.ts) — la fiche
// recette (consultation isolée) et « Mes recettes » (liste, chargement en
// lot) ont des besoins de source différents ; ce composant ne préjuge pas.

import { Ban, Heart } from "lucide-react";
import type { RecettePreference } from "@/lib/generateur";

export function TogglePreferenceRecette({
  preference,
  onChange,
  className,
}: {
  preference: RecettePreference | null;
  onChange: (nouvelle: RecettePreference | null) => void;
  className?: string;
}) {
  const base =
    "relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <button
        type="button"
        aria-pressed={preference === "favorite"}
        aria-label={
          preference === "favorite" ? "Retirer des favoris" : "Marquer comme favorite"
        }
        onClick={() => onChange(preference === "favorite" ? null : "favorite")}
        className={`${base} ${
          preference === "favorite"
            ? "bg-primary text-white"
            : "text-brand-700 hover:bg-brand-50"
        }`}
      >
        <Heart
          aria-hidden="true"
          className="size-4"
          fill={preference === "favorite" ? "currentColor" : "none"}
        />
      </button>
      <button
        type="button"
        aria-pressed={preference === "evitee"}
        aria-label={preference === "evitee" ? "Ne plus éviter" : "Marquer comme évitée"}
        onClick={() => onChange(preference === "evitee" ? null : "evitee")}
        className={`${base} ${
          preference === "evitee"
            ? "bg-primary text-white"
            : "text-brand-700 hover:bg-brand-50"
        }`}
      >
        <Ban aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
