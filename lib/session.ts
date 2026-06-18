// État de connexion côté client (#207, audit #51).
//
// La barre de nav doit masquer les liens applicatifs (Planning/Courses/Recettes
// + avatar) quand l'utilisateur n'est PAS connecté — les pages « / » et « /aide »
// sont publiques (cf. proxy.ts), donc un simple test de route ne suffit pas : il
// faut un vrai signal d'auth.
//
// Mini-store façon lib/profil.ts (useSyncExternalStore + Set d'abonnés, init
// paresseuse au 1er abonnement). Snapshot serveur/initial : `null` (= indéterminé)
// — l'appelant peut alors retomber sur une heuristique sûre (ex. « on est sur une
// route protégée, donc le proxy garantit l'auth ») le temps que Supabase réponde,
// ce qui évite tout scintillement sur le chemin chaud (pages protégées).

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

// null = pas encore déterminé ; true/false = connu.
let connecte: boolean | null = null;
let initialise = false;
const abonnes = new Set<() => void>();

function notifier(): void {
  abonnes.forEach((cb) => cb());
}

function definir(valeur: boolean): void {
  if (connecte === valeur) return;
  connecte = valeur;
  notifier();
}

// Démarre l'écoute de l'état d'auth une seule fois (au 1er abonnement).
function initialiser(): void {
  if (initialise || typeof window === "undefined") return;
  initialise = true;
  const supabase = createClient();
  supabase.auth
    .getSession()
    .then(({ data }) => definir(!!data.session))
    .catch(() => definir(false));
  // INITIAL_SESSION puis SIGNED_IN/SIGNED_OUT : la nav reflète la connexion en direct.
  supabase.auth.onAuthStateChange((_event, session) => definir(!!session));
}

function sAbonner(cb: () => void): () => void {
  initialiser();
  abonnes.add(cb);
  return () => {
    abonnes.delete(cb);
  };
}

/** `true` connecté, `false` déconnecté, `null` tant que non déterminé (SSR/init). */
export function useEstConnecte(): boolean | null {
  return useSyncExternalStore(
    sAbonner,
    () => connecte,
    () => null
  );
}
