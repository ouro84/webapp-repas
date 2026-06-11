"use client";

// Bascule de thème (#72, P19) — bouton qui cycle système → clair → sombre.
// L'icône reflète la préférence SÉLECTIONNÉE (pas la résolution effective) :
// Monitor = système, Sun = clair, Moon = sombre. Même style que l'engrenage
// Réglages de la nav (taille, zone tactile, feedback active:scale #69).

import { Monitor, Moon, Sun } from "lucide-react";
import { definirTheme, useTheme, type Theme } from "@/lib/theme";

const SUIVANT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LIBELLE: Record<Theme, string> = {
  system: "système",
  light: "clair",
  dark: "sombre",
};

const ICONE = { system: Monitor, light: Sun, dark: Moon };

export function BasculeTheme() {
  const theme = useTheme();
  const Icone = ICONE[theme];
  return (
    <button
      type="button"
      onClick={() => definirTheme(SUIVANT[theme])}
      aria-label={`Thème : ${LIBELLE[theme]}. Cliquer pour passer en ${LIBELLE[SUIVANT[theme]]}.`}
      title={`Thème : ${LIBELLE[theme]}`}
      className="relative flex size-9 items-center justify-center rounded-full text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
    >
      <Icone className="size-5" aria-hidden="true" />
    </button>
  );
}
