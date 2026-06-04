"use client";

// Page Planning — génération et affichage du planning hebdomadaire (US-01, US-04)
//
// États d'interface (RG-09) : vide (avant toute génération), chargement,
// erreur, chargé. Le planning est persisté en localStorage sous la clé
// "planning_courant" (section 5.6) et relu au montage.
//
// localStorage est un système externe à React : il est branché via
// useSyncExternalStore (pattern recommandé par React — la règle ESLint
// react-hooks/set-state-in-effect interdit le setState synchrone dans un
// useEffect au montage). Côté serveur, le snapshot vaut null : la page est
// prérendue en état vide, puis hydratée avec le planning sauvegardé.
//
// Responsive (RG-06 à RG-08) : liste verticale par jour en mobile,
// grille 7 colonnes à partir de md (≥ 768px).

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { genererPlanning, remplacerSlot } from "@/lib/generateur";
import recettesJson from "@/data/recettes.json";
import type {
  Jour,
  JourPlanning,
  Planning,
  Recette,
  TempsPreparation,
} from "@/types";

const RECETTES = recettesJson as Recette[];

const CLE_STORAGE = "planning_courant";

type TypeRepas = "dejeuner" | "diner";

// ============================================================================
// Mini-store localStorage — source de vérité de la persistance (section 5.6)
// ============================================================================

// Abonnés même onglet : l'événement natif "storage" ne se déclenche que dans
// les AUTRES onglets, il faut donc notifier manuellement l'onglet courant.
const abonnes = new Set<() => void>();

function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  window.addEventListener("storage", rappel); // modifications des autres onglets
  return () => {
    abonnes.delete(rappel);
    window.removeEventListener("storage", rappel);
  };
}

function lireSnapshot(): string | null {
  return localStorage.getItem(CLE_STORAGE);
}

// Pas de localStorage côté serveur : le prérendu se fait en état vide.
function lireSnapshotServeur(): null {
  return null;
}

function sauvegarderPlanning(planning: Planning): void {
  localStorage.setItem(CLE_STORAGE, JSON.stringify(planning));
  for (const rappel of abonnes) rappel();
}

// ============================================================================
// Libellés & styles
// ============================================================================

// Libellés des jours : complet pour la liste mobile (RG-08), abrégé pour les
// en-têtes de la grille desktop (RG-07).
const LIBELLES_JOURS: Record<Jour, { complet: string; abrege: string }> = {
  lundi: { complet: "Lundi", abrege: "Lun" },
  mardi: { complet: "Mardi", abrege: "Mar" },
  mercredi: { complet: "Mercredi", abrege: "Mer" },
  jeudi: { complet: "Jeudi", abrege: "Jeu" },
  vendredi: { complet: "Vendredi", abrege: "Ven" },
  samedi: { complet: "Samedi", abrege: "Sam" },
  dimanche: { complet: "Dimanche", abrege: "Dim" },
};

// Badge coloré par temps de préparation : rapide = vert, normal = jaune,
// long = rouge.
const STYLES_BADGE: Record<TempsPreparation, string> = {
  rapide: "bg-green-100 text-green-800",
  normal: "bg-yellow-100 text-yellow-800",
  long: "bg-red-100 text-red-800",
};

const LIBELLES_TEMPS: Record<TempsPreparation, string> = {
  rapide: "Rapide",
  normal: "Normal",
  long: "Long",
};

function cleSlot(jour: Jour, typeRepas: TypeRepas): string {
  return `${jour}-${typeRepas}`;
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner (week-end) puis dîner.
function slotsDuJour(
  jp: JourPlanning
): { typeRepas: TypeRepas; libelle: string; recette: Recette }[] {
  const slots: { typeRepas: TypeRepas; libelle: string; recette: Recette }[] =
    [];
  if (jp.dejeuner) {
    slots.push({ typeRepas: "dejeuner", libelle: "Déjeuner", recette: jp.dejeuner });
  }
  slots.push({ typeRepas: "diner", libelle: "Dîner", recette: jp.diner });
  return slots;
}

// ============================================================================
// Composant page
// ============================================================================

// Transition en cours, par-dessus le planning persisté : repos (rien),
// chargement (génération en cours) ou erreur (génération échouée).
type Transition =
  | { statut: "repos" }
  | { statut: "chargement" }
  | { statut: "erreur"; message: string };

export default function PagePlanning() {
  // Planning persisté (système externe) : null = état vide (RG-09).
  const brut = useSyncExternalStore(sAbonner, lireSnapshot, lireSnapshotServeur);
  const [transition, setTransition] = useState<Transition>({ statut: "repos" });
  // Slot dont le dernier remplacement a échoué (RG-04) : "jour-typeRepas".
  const [slotIndisponible, setSlotIndisponible] = useState<string | null>(null);

  const planning = useMemo<Planning | null>(() => {
    if (brut === null) return null;
    try {
      return JSON.parse(brut) as Planning;
    } catch (erreur) {
      // Donnée corrompue : on la signale et on retombe en état vide.
      // La prochaine génération écrasera la valeur illisible.
      console.error(`localStorage["${CLE_STORAGE}"] illisible.`, erreur);
      return null;
    }
  }, [brut]);

  // Génération (US-01) : un court délai laisse React peindre l'état
  // "chargement" avant le calcul, puis le résultat écrase la sauvegarde.
  function genererNouveauPlanning(): void {
    setTransition({ statut: "chargement" });
    setTimeout(() => {
      try {
        const nouveau = genererPlanning(RECETTES);
        sauvegarderPlanning(nouveau);
        setSlotIndisponible(null);
        setTransition({ statut: "repos" });
      } catch (erreur) {
        setTransition({
          statut: "erreur",
          message:
            erreur instanceof Error
              ? erreur.message
              : "Erreur inattendue pendant la génération.",
        });
      }
    }, 300);
  }

  // Remplacement d'un slot (US-04, RG-04) : si aucune recette éligible
  // n'est disponible, le slot concerné affiche "Pas de recette disponible".
  function changerSlot(jour: Jour, typeRepas: TypeRepas): void {
    if (planning === null) return;
    const nouveau = remplacerSlot(planning, jour, typeRepas, RECETTES);
    if (nouveau === null) {
      setSlotIndisponible(cleSlot(jour, typeRepas));
      return;
    }
    sauvegarderPlanning(nouveau);
    setSlotIndisponible(null);
  }

  // --- État chargement (RG-09) ---
  if (transition.statut === "chargement") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="animate-pulse text-lg text-gray-500">
          Génération du planning…
        </p>
      </main>
    );
  }

  // --- État erreur (RG-09) ---
  if (transition.statut === "erreur") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="font-medium text-red-800">La génération a échoué</p>
          <p className="mt-1 text-sm text-red-600">{transition.message}</p>
        </div>
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="rounded-full bg-black px-6 py-3 font-medium text-white transition-colors hover:bg-gray-800"
        >
          Réessayer
        </button>
      </main>
    );
  }

  // --- État vide (RG-09) : bouton de génération centré (écran 1) ---
  if (planning === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Mon planning de la semaine
          </h1>
          <p className="mt-2 text-gray-500">
            Aucun planning pour l&apos;instant — lance la génération !
          </p>
        </div>
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="rounded-full bg-black px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-gray-800"
        >
          Générer mon planning
        </button>
      </main>
    );
  }

  // --- État chargé : planning affiché ---
  return (
    <main className="min-h-screen p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            Mon planning de la semaine
          </h1>
          <p className="text-sm text-gray-500">Semaine {planning.semaine}</p>
        </div>
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          Regénérer
        </button>
        <Link
          href="/courses"
          className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          Liste de courses →
        </Link>
      </header>

      {/* Vue mobile (RG-08) : liste verticale, un bloc par jour */}
      <ul className="space-y-4 md:hidden">
        {planning.jours.map((jp) => (
          <li
            key={jp.jour}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <h2 className="mb-3 font-semibold text-gray-900">
              {LIBELLES_JOURS[jp.jour].complet}
            </h2>
            <div className="space-y-3">
              {slotsDuJour(jp).map((slot) => (
                <SlotRepas
                  key={slot.typeRepas}
                  libelle={slot.libelle}
                  recette={slot.recette}
                  indisponible={
                    slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                  }
                  onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Vue desktop (RG-07) : grille 7 colonnes, une par jour */}
      <div className="hidden md:grid md:grid-cols-7 md:gap-3">
        {planning.jours.map((jp) => (
          <section key={jp.jour} className="flex flex-col gap-3">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-gray-500">
              {LIBELLES_JOURS[jp.jour].abrege}
            </h2>
            {slotsDuJour(jp).map((slot) => (
              <SlotRepas
                key={slot.typeRepas}
                libelle={slot.libelle}
                recette={slot.recette}
                indisponible={
                  slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                }
                onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
              />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

// Carte d'un repas : label du slot, nom de la recette, badge de temps de
// préparation et bouton de remplacement (US-04). Partagée entre les vues
// mobile et desktop.
function SlotRepas({
  libelle,
  recette,
  indisponible,
  onChanger,
}: {
  libelle: string;
  recette: Recette;
  indisponible: boolean;
  onChanger: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {libelle}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-900">{recette.nom}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES_BADGE[recette.tempsPreparation]}`}
        >
          {LIBELLES_TEMPS[recette.tempsPreparation]}
        </span>
        <button
          type="button"
          onClick={onChanger}
          className="text-xs text-gray-500 underline-offset-2 transition-colors hover:text-gray-900 hover:underline"
        >
          ↺ changer
        </button>
      </div>
      {indisponible && (
        <p className="mt-2 text-xs text-red-600">Pas de recette disponible</p>
      )}
    </div>
  );
}
