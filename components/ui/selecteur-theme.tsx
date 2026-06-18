"use client";

// Sélecteur de thème (#205, audit #51) — contrôle segmenté Système / Clair /
// Sombre pour la section « Préférences » de /profil.
//
// Remplace l'ex-bouton cyclique de la nav (BasculeTheme) : dans un contexte de
// réglages, un segmenté expose les 3 options d'un coup (plus découvrable qu'un
// bouton qui cycle). Même store que partout : useTheme()/definirTheme()
// (lib/theme.ts). Le rendu effectif clair/sombre est posé par le store sur
// <html data-theme> (script anti-FOUC inchangé).

import { Monitor, Moon, Sun } from "lucide-react";
import { definirTheme, useTheme, type Theme } from "@/lib/theme";

const OPTIONS: { valeur: Theme; libelle: string; Icone: typeof Monitor }[] = [
  { valeur: "system", libelle: "Système", Icone: Monitor },
  { valeur: "light", libelle: "Clair", Icone: Sun },
  { valeur: "dark", libelle: "Sombre", Icone: Moon },
];

export function SelecteurTheme() {
  const theme = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Thème de l’application"
      className="inline-flex rounded-full border border-brand-200 bg-surface p-0.5"
    >
      {OPTIONS.map(({ valeur, libelle, Icone }) => {
        const actif = theme === valeur;
        return (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => definirTheme(valeur)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              actif ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"
            }`}
          >
            <Icone className="size-4" aria-hidden="true" />
            {libelle}
          </button>
        );
      })}
    </div>
  );
}
