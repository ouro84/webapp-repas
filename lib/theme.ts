// Préférence de thème clair / sombre / système (#72, P19).
//
// Mini-store façon lib/stockage.ts (useSyncExternalStore + Set d'abonnés) :
// l'événement `storage` ne notifie pas l'onglet courant, on notifie donc à la
// main. La résolution effective (clair/sombre) est posée sur `data-theme` du
// <html> — le script anti-FOUC d'app/layout.tsx fait la même chose AVANT le
// premier paint ; ici on la rejoue à chaque changement de préférence ou de
// thème OS (quand on est en « système »).

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const CLE = "theme";
const abonnes = new Set<() => void>();

function lireBrut(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(CLE);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function resoudre(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function appliquer(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resoudre(lireBrut());
}

function notifier(): void {
  abonnes.forEach((cb) => cb());
}

export const storeTheme = {
  sAbonner(cb: () => void): () => void {
    abonnes.add(cb);
    return () => {
      abonnes.delete(cb);
    };
  },
  lire: lireBrut,
  // SSR / prérendu : « système » (le script anti-FOUC corrige côté client).
  lireServeur: (): Theme => "system",
};

export function definirTheme(theme: Theme): void {
  try {
    localStorage.setItem(CLE, theme);
  } catch {
    // localStorage indisponible (mode privé strict) : on applique quand même
    // pour la session courante, sans persistance.
  }
  appliquer();
  notifier();
}

// Quand l'utilisateur est en « système », suivre les changements de thème OS.
if (typeof window !== "undefined" && window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (lireBrut() === "system") {
        appliquer();
        notifier();
      }
    });
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    storeTheme.sAbonner,
    storeTheme.lire,
    storeTheme.lireServeur
  );
}
