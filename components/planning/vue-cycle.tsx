"use client";

// Vue planning calée sur le CYCLE de courses (#260, PR3 de l'épopée #257).
//
// Bonus « lecture d'abord » (design §8) : visualiser « ce que j'ai prévu jusqu'à
// quand », aligné sur la fenêtre de la liste de courses (même ancre + longueur).
//
// ÉDITION À PARITÉ AVEC LA VUE SEMAINE (retour utilisateur post-merge #281) :
// changer/sélection manuelle/personnes/restes sont désormais disponibles ici.
// La contrainte d'origine (#260 §8, réaffirmée en #279) était : un cycle non
// calendaire chevauche 1-2 semaines ISO → éditer un slot d'une semaine qui
// n'est pas la « semaine affichée » sortirait du modèle MONO-SEMAINE de
// storePlanning/useSync (persistance + undo + temps réel). On lève cette
// contrainte en écrivant DIRECTEMENT en base pour la semaine ISO du jour
// édité (modifierSlotDistant, lib/sync.ts — mirroir de la génération #259,
// RPC sauvegarder_slots), sans jamais passer par storePlanning. Deux garde-
// fous nécessaires, câblés dans modifierSlotDistant : (1) les deux bookkeeping
// anti-écho existants (majPlanningCycle #259, planning_courant_maj #56 PR5)
// sont tenus à jour pour ne jamais déclencher l'alerte intrusive sur sa
// propre édition ; (2) si le jour édité appartient à la semaine actuellement
// affichée en vue Semaine, le cache storePlanning est patché en direct. Undo
// dédié et léger (toast « Annuler » qui rejoue l'ancien JourPlanning), pas de
// réutilisation du snapshot localStorage de la vue Semaine (inutile ici).
//
// Le lien « Liste de courses → » vit aussi ici (passe l'ancre affichée en
// query param, #279).
//
// Projection : on lit les plannings des 1-2 semaines ISO que le cycle touche
// (chargerPlanningDistant, base = source de vérité) et on rend chaque JOUR du
// cycle (date concrète) via lib/cycles (fonctions pures).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ancreParDefaut,
  cycleDecale,
  dateVersSemaineJour,
  joursDuCycle,
  libelleCycle,
  LONGUEUR_DEFAUT,
} from "@/lib/cycles";
import { modifierPersonnes, personnesDuSlot } from "@/lib/personnes";
import { estRestes, marquerRestes } from "@/lib/restes";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { chargerLongueurCycle, chargerPlanningDistant } from "@/lib/persistance";
import {
  creneauActif,
  recettesUtilisees,
  remplacerSlot,
  remplacerSlotManuel,
  type PreferencesRecettes,
} from "@/lib/generateur";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { definirCycleAffiche, modifierSlotDistant, useGenerationCycle } from "@/lib/sync";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { chargerPreferences } from "@/lib/preferences";
import { messagesAvertissementGeneration } from "@/lib/avertissements-generation";
import { SlotRepas } from "@/components/planning/slot-repas";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import { ConfirmationModale } from "@/components/ui/confirmation";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { JourPlanning, Planning, Recette, ReglagesGeneration } from "@/types";

type TypeRepas = "dejeuner" | "diner";

// « jeudi 9 juil. » avec majuscule initiale (les jours du cycle sont des dates
// concrètes, pas des jours de semaine abstraits comme dans la vue semaine).
function libelleJourDate(dateISO: string): string {
  const [a, m, j] = dateISO.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  const s = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner puis dîner. `recette`
// est absente si le slot n'a jamais été généré (planning antérieur/créneau
// jamais rempli) OU si son créneau est désactivé (« Aucun », #217, RG-44/46)
// — même filtre live que la vue Semaine, appliqué ici par slot (cette vue
// projette des dates de plusieurs semaines, pas un `Planning` unique, donc pas
// de `retirerCreneauxDesactives` direct).
function slotsDuJour(
  jp: JourPlanning,
  reglages: ReglagesGeneration
): { typeRepas: TypeRepas; libelle: string; recette: Recette | undefined }[] {
  return [
    {
      typeRepas: "dejeuner" as const,
      libelle: "Déjeuner",
      recette: creneauActif(jp.jour, "dejeuner", reglages) ? jp.dejeuner : undefined,
    },
    {
      typeRepas: "diner" as const,
      libelle: "Dîner",
      recette: creneauActif(jp.jour, "diner", reglages) ? jp.diner : undefined,
    },
  ];
}

export function VuePlanningCycle({
  idsModifiables,
}: {
  // Ids des recettes du catalogue chargé (#137) : pour ceux-là, la fiche propose
  // « Modifier » (deep-link /recettes?edition). Fourni par la page (déjà chargé).
  idsModifiables: ReadonlySet<string>;
}) {
  const [ancre, setAncre] = useState<string | null>(null);
  const [longueur, setLongueur] = useState<number>(LONGUEUR_DEFAUT);
  // Plannings des semaines ISO touchées, indexés par semaine.
  const [parSemaine, setParSemaine] = useState<Map<string, Planning>>(new Map());
  const [chargement, setChargement] = useState(true);
  const [ficheOuverte, setFicheOuverte] = useState<{
    recette: Recette;
    personnes: number;
  } | null>(null);
  // Slot en cours de sélection manuelle (US-06) — porte tout le contexte
  // nécessaire pour appliquer/persister le choix (date pour la garde "semaine
  // passée", semaine ISO pour la persistance, jour+typeRepas pour le calcul).
  const [slotEnSelection, setSlotEnSelection] = useState<{
    dateISO: string;
    semaine: string;
    jour: JourPlanning["jour"];
    typeRepas: TypeRepas;
  } | null>(null);
  // Confirmation avant d'éditer un jour PASSÉ (US-14, RG-24) — même garde que la
  // vue Semaine, mais jugée par jour édité (comparaison de date directe, pas
  // d'offsetAffiche : la vue Cycle n'a pas de notion de "semaine affichée" unique).
  const [confirmation, setConfirmation] = useState<{ executer: () => void } | null>(null);
  // Réglages (#217) : pilotent le filtre live des créneaux désactivés. Défaut
  // tant que non chargés = comportement antérieur (tout actif).
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);

  useEffect(() => {
    let actif = true;
    chargerReglages()
      .then((r) => {
        if (actif) setReglages(r);
      })
      .catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  // Recettes + préférences (#219) : nécessaires pour « Changer » (aléatoire, biaisé
  // par les préférences) et « Sélectionner » (liste complète), même chargement que
  // la vue Semaine (app/planning/page.tsx).
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  const [preferences, setPreferences] = useState<PreferencesRecettes>(new Map());

  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (actif) setRecettesGerees(liste);
      })
      .catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
      });
    chargerPreferences()
      .then((p) => {
        if (actif) setPreferences(p);
      })
      .catch((erreur) => {
        console.error("Chargement des préférences échoué (biais ignoré).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  const recettes = recettesGerees.map((r) => r.recette);

  function estPasse(dateISO: string): boolean {
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const [a, m, j] = dateISO.split("-").map(Number);
    return new Date(a, m - 1, j) < aujourdhui;
  }

  function confirmerSiPasse(dateISO: string, executer: () => void): boolean {
    if (estPasse(dateISO)) {
      setConfirmation({ executer });
      return true;
    }
    return false;
  }

  // Génération partagée (#279, D2) : accessible directement depuis cette vue,
  // sans passer par /courses. Le mécanisme (#259) persiste par RPC
  // sauvegarder_slots, indépendamment de storePlanning/useSync (mono-semaine)
  // — ne contredit donc pas la lecture seule de l'ÉDITION de slot (cf.
  // en-tête de ce fichier).
  const { enGeneration, genererCycle } = useGenerationCycle(
    ancre !== null ? { ancre, longueur } : null
  );

  async function genererMonCycle(): Promise<void> {
    if (enGeneration) return;
    try {
      const { vegeNonHonore, mixNonHonore, saisonNonHonore } = await genererCycle();
      toast.success("Cycle généré");
      for (const message of messagesAvertissementGeneration({
        vegeNonHonore,
        mixNonHonore,
        saisonNonHonore,
      })) {
        toast.warning(message);
      }
      // Recharge la projection affichée pour refléter le nouveau contenu.
      if (ancre !== null) void chargerCycle(ancre);
    } catch (erreur) {
      console.error("Génération du cycle échouée.", erreur);
      toast.error(
        erreur instanceof Error
          ? erreur.message
          : "Impossible de générer le cycle. Vérifie ta connexion et réessaie."
      );
    }
  }

  const ID_TOAST_ANNULATION_CYCLE = "annulation-slot-cycle";

  // Annule la dernière édition en rejouant l'ANCIEN JourPlanning par le même
  // chemin d'écriture — pas de snapshot persistant (contrairement à la vue
  // Semaine) : la fermeture du toast (~5 s) borne naturellement la fenêtre.
  function toastAnnulable(message: string, semaine: string, ancienJour: JourPlanning): void {
    toast(message, {
      id: ID_TOAST_ANNULATION_CYCLE,
      action: {
        label: "Annuler",
        onClick: () => {
          void modifierSlotDistant(semaine, ancienJour).then(() => {
            if (ancre !== null) void chargerCycle(ancre);
          });
        },
      },
      duration: 5000,
    });
  }

  async function appliquerEdition(
    semaine: string,
    ancienJourPlanning: JourPlanning,
    nouveauJourPlanning: JourPlanning,
    messageToast: string | null
  ): Promise<void> {
    try {
      await modifierSlotDistant(semaine, nouveauJourPlanning);
      if (ancre !== null) void chargerCycle(ancre);
      if (messageToast) toastAnnulable(messageToast, semaine, ancienJourPlanning);
    } catch (erreur) {
      console.error("Édition du slot échouée.", erreur);
      toast.error("Impossible d'enregistrer la modification. Réessaie.");
    }
  }

  function planningDeLaSemaine(semaine: string): Planning | null {
    return parSemaine.get(semaine) ?? null;
  }

  // Changer (aléatoire, US-04) : réutilise remplacerSlot (pur, biaisé par
  // préférences/réglages) — même logique que la vue Semaine, seule la
  // persistance change (écriture directe, cf. modifierSlotDistant).
  function changerSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    force = false
  ): void {
    if (!force && confirmerSiPasse(dateISO, () => changerSlot(dateISO, semaine, jour, typeRepas, true))) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === jour);
    if (!ancienJourPlanning) return;
    const nouveauPlanning = remplacerSlot(planningSemaine, jour, typeRepas, recettes, reglages, undefined, preferences);
    if (nouveauPlanning === null) {
      toast.error("Pas de recette disponible");
      return;
    }
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    void appliquerEdition(semaine, ancienJourPlanning, nouveauJourPlanning, "Recette remplacée");
  }

  // Sélection manuelle (US-06) : remplace le slot par la recette choisie —
  // by-pass RG-01/RG-02, ne peut pas échouer depuis l'UI.
  function selectionnerRecette(recette: Recette): void {
    if (slotEnSelection === null) return;
    const cible = slotEnSelection;
    setSlotEnSelection(null);
    const executer = () => {
      const planningSemaine = planningDeLaSemaine(cible.semaine);
      if (!planningSemaine) return;
      const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === cible.jour);
      if (!ancienJourPlanning) return;
      const nouveauPlanning = remplacerSlotManuel(planningSemaine, cible.jour, cible.typeRepas, recette);
      if (nouveauPlanning === null) return;
      const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === cible.jour)!;
      void appliquerEdition(cible.semaine, ancienJourPlanning, nouveauJourPlanning, "Recette remplacée");
    };
    if (confirmerSiPasse(cible.dateISO, executer)) return;
    executer();
  }

  // Nombre de personnes (US-07) — action mineure, non undoable (même
  // comportement que la vue Semaine, cf. app/planning/page.tsx#changerPersonnes).
  function changerPersonnesSlot(
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    personnes: number
  ): void {
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const nouveauPlanning = modifierPersonnes(planningSemaine, jour, typeRepas, personnes);
    if (nouveauPlanning === null) return;
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    void modifierSlotDistant(semaine, nouveauJourPlanning).then(() => {
      if (ancre !== null) void chargerCycle(ancre);
    });
  }

  // Marquer/démarquer « restes » (US-12, RG-22).
  function changerRestesSlot(
    dateISO: string,
    semaine: string,
    jour: JourPlanning["jour"],
    typeRepas: TypeRepas,
    valeur: boolean,
    force = false
  ): void {
    if (
      !force &&
      confirmerSiPasse(dateISO, () => changerRestesSlot(dateISO, semaine, jour, typeRepas, valeur, true))
    ) {
      return;
    }
    const planningSemaine = planningDeLaSemaine(semaine);
    if (!planningSemaine) return;
    const ancienJourPlanning = planningSemaine.jours.find((jp) => jp.jour === jour);
    if (!ancienJourPlanning) return;
    const nouveauPlanning = marquerRestes(planningSemaine, jour, typeRepas, valeur);
    if (nouveauPlanning === null) return;
    const nouveauJourPlanning = nouveauPlanning.jours.find((jp) => jp.jour === jour)!;
    void appliquerEdition(
      semaine,
      ancienJourPlanning,
      nouveauJourPlanning,
      valeur ? "Repas marqué « Restes »" : "Repas à cuisiner"
    );
  }

  // Charge (ou recharge) le cycle d'ancre donnée : lit les 1-2 semaines touchées.
  const chargerCycle = useCallback(async (ancreCible: string) => {
    setChargement(true);
    try {
      const long = await chargerLongueurCycle(ancreCible).catch(() => LONGUEUR_DEFAUT);
      const semaines = Array.from(
        new Set(
          joursDuCycle(ancreCible, long).map((d) => dateVersSemaineJour(d).semaine)
        )
      );
      const resultats = await Promise.all(
        semaines.map((s) => chargerPlanningDistant(s).catch(() => null))
      );
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const r = resultats[i];
        if (r) map.set(s, r.planning);
      });
      setLongueur(long);
      setParSemaine(map);
      setAncre(ancreCible);
      // Répercute dans le store partagé (#279) : nécessaire pour que la
      // génération (ci-dessous) et le lien « Liste de courses → » ciblent le
      // MÊME cycle que celui affiché ici. Écriture localStorage pure, sans
      // effet de bord coches/réaltime (cf. definirCycleAffiche).
      definirCycleAffiche(ancreCible, long);
    } finally {
      setChargement(false);
    }
  }, []);

  // Montage : ancre par défaut dérivée du jour de courses du foyer (même règle
  // que /courses, ancreParDefaut → décalage week-end inclus).
  useEffect(() => {
    let actif = true;
    chargerJourCoursesFoyer()
      .catch(() => 1)
      .then((jour) => {
        if (actif) void chargerCycle(ancreParDefaut(new Date(), jour));
      });
    return () => {
      actif = false;
    };
  }, [chargerCycle]);

  if (chargement || ancre === null) {
    return (
      <p role="status" className="animate-pulse py-12 text-center text-brand-700/85">
        Chargement…
      </p>
    );
  }

  const jours = joursDuCycle(ancre, longueur);
  // Chaque date → le JourPlanning correspondant (ou null si non planifié).
  const cellules = jours.map((dateISO) => {
    const { semaine, jour } = dateVersSemaineJour(dateISO);
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour) ?? null;
    return { dateISO, jp };
  });
  const aDesRepas = cellules.some((c) => c.jp !== null);

  return (
    <div>
      {/* Navigateur de cycle (miroir de /courses) + libellé de la fenêtre +
          actions (#279 : génération + accès courses, directement ici). */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Cycle précédent"
          onClick={() => void chargerCycle(cycleDecale(ancre, -1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-[12rem] text-center text-sm font-medium text-brand-900"
        >
          {libelleCycle(ancre, longueur)}
        </span>
        <button
          type="button"
          aria-label="Cycle suivant"
          onClick={() => void chargerCycle(cycleDecale(ancre, 1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void genererMonCycle()}
          disabled={enGeneration}
          className="relative inline-flex items-center gap-1.5 rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          {enGeneration ? "Génération…" : "Générer mon cycle"}
        </button>
        <Link
          href={`/courses?ancre=${ancre}`}
          className="relative rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Liste de courses →
        </Link>
      </div>

      {!aDesRepas ? (
        <p className="py-12 text-center text-brand-700/85">
          Aucun repas planifié sur ce cycle.
        </p>
      ) : (
        <ul className="space-y-4">
          {cellules.map(({ dateISO, jp }) => (
            <li
              key={dateISO}
              className="rounded-lg border border-brand-100 bg-surface p-4"
            >
              <h2 className="mb-3 font-semibold text-brand-900">
                {libelleJourDate(dateISO)}
              </h2>
              {jp === null ? (
                <p className="text-sm text-brand-700/70">Rien de prévu.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {slotsDuJour(jp, reglages).map((slot) => {
                    const { semaine } = dateVersSemaineJour(dateISO);
                    return (
                      <SlotRepas
                        key={slot.typeRepas}
                        libelle={slot.libelle}
                        jourLabel={libelleJourDate(dateISO)}
                        recette={slot.recette}
                        indisponible={false}
                        personnes={personnesDuSlot(jp, slot.typeRepas)}
                        restes={estRestes(jp, slot.typeRepas)}
                        onChanger={() => changerSlot(dateISO, semaine, jp.jour, slot.typeRepas)}
                        onSelectionner={() =>
                          setSlotEnSelection({ dateISO, semaine, jour: jp.jour, typeRepas: slot.typeRepas })
                        }
                        onChangerPersonnes={(p) => changerPersonnesSlot(semaine, jp.jour, slot.typeRepas, p)}
                        onChangerRestes={(v) => changerRestesSlot(dateISO, semaine, jp.jour, slot.typeRepas, v)}
                        onVoir={() =>
                          slot.recette &&
                          setFicheOuverte({
                            recette: slot.recette,
                            personnes: personnesDuSlot(jp, slot.typeRepas),
                          })
                        }
                      />
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Fiche recette (US-10) — consultation depuis la vue cycle aussi. */}
      {ficheOuverte && (
        <FicheRecette
          recette={ficheOuverte.recette}
          personnes={ficheOuverte.personnes}
          modifiable={idsModifiables.has(ficheOuverte.recette.id)}
          onFermer={() => setFicheOuverte(null)}
        />
      )}

      {/* Sélecteur de recette (US-06) — monté seulement pendant la sélection. */}
      {slotEnSelection && (
        <SelecteurRecette
          titre={`${slotEnSelection.typeRepas === "diner" ? "Dîner" : "Déjeuner"} de ${libelleJourDate(slotEnSelection.dateISO).toLowerCase()}`}
          recettes={recettes}
          idsAuPlanning={recettesUtilisees(
            planningDeLaSemaine(slotEnSelection.semaine) ?? { semaine: slotEnSelection.semaine, jours: [] }
          )}
          onSelectionner={selectionnerRecette}
          onRestes={() =>
            changerRestesSlot(
              slotEnSelection.dateISO,
              slotEnSelection.semaine,
              slotEnSelection.jour,
              slotEnSelection.typeRepas,
              true
            )
          }
          onFermer={() => setSlotEnSelection(null)}
        />
      )}

      {/* Confirmation avant de modifier un jour PASSÉ (US-14, RG-24). */}
      {confirmation && (
        <ConfirmationModale
          titre="Modifier un jour passé ?"
          message="Ce jour est déjà passé. Veux-tu vraiment modifier ce planning enregistré ?"
          libelleConfirmer="Modifier"
          onConfirmer={() => {
            const action = confirmation.executer;
            setConfirmation(null);
            action();
          }}
          onAnnuler={() => setConfirmation(null)}
        />
      )}
    </div>
  );
}
