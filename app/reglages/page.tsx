"use client";

// Page Réglages — règles de génération personnalisées (#45, P09, US-15).
//
// L'utilisateur configure le temps de préparation MAXIMUM autorisé par créneau
// (déjeuner/dîner × semaine/week-end) et le nombre de personnes par défaut.
// Enregistrement EXPLICITE (RG-25) : pas de sauvegarde à la volée. La prochaine
// génération (complète côté serveur, unitaire côté client) applique les règles.
//
// États (RG-09) : chargement, erreur, chargé (les valeurs par défaut tiennent
// lieu de contenu quand l'utilisateur n'a jamais rien enregistré).
//
// Bonus : B1 réinitialiser aux défauts (sans auto-save), B2 aperçu du nombre de
// recettes éligibles par créneau, B3 refus de sauvegarde si la configuration
// rend la génération infaisable (garde de faisabilité analyserVivier).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { chargerReglages, sauvegarderReglages } from "@/lib/reglages-data";
import { chargerRecettes } from "@/lib/recettes";
import { ORDRE_TEMPS, rangTemps, REGLAGES_DEFAUT } from "@/lib/reglages";
import { analyserVivier } from "@/lib/generateur";
import { PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes";
import type { Recette, ReglagesGeneration, TempsPreparation } from "@/types";

const LIBELLE_TEMPS: Record<TempsPreparation, string> = {
  rapide: "Rapide",
  normal: "Normal",
  long: "Long",
};

// Les 4 créneaux paramétrables, dans l'ordre d'affichage. Organisés en section
// pour accueillir les futurs réglages (#P10/#P11/#P13) sans refonte.
type CleCreneau = keyof ReglagesGeneration["plafonds"];
const CRENEAUX: { cle: CleCreneau; libelle: string }[] = [
  { cle: "dejeunerSemaine", libelle: "Déjeuner en semaine" },
  { cle: "dinerSemaine", libelle: "Dîner en semaine" },
  { cle: "dejeunerWeekend", libelle: "Déjeuner le week-end" },
  { cle: "dinerWeekend", libelle: "Dîner le week-end" },
];

// Contrôle segmenté (radiogroup) : Rapide / Normal / Long.
function SegmentPlafond({
  libelleId,
  valeur,
  onChange,
}: {
  libelleId: string;
  valeur: TempsPreparation;
  onChange: (temps: TempsPreparation) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={libelleId}
      className="inline-flex rounded-full border border-brand-200 bg-white p-0.5"
    >
      {ORDRE_TEMPS.map((t) => {
        const actif = t === valeur;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => onChange(t)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              actif ? "bg-brand-600 text-white" : "text-brand-700 hover:bg-brand-50"
            }`}
          >
            {LIBELLE_TEMPS[t]}
          </button>
        );
      })}
    </div>
  );
}

// Interrupteur on/off (switch accessible) — préférence « privilégier végé ».
function Bascule({
  libelleId,
  actif,
  onChange,
}: {
  libelleId: string;
  actif: boolean;
  onChange: (actif: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-labelledby={libelleId}
      onClick={() => onChange(!actif)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        actif ? "bg-brand-600" : "bg-brand-200"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
          actif ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// Stepper − / + borné [1;12], réutilise le motif de la page planning.
function StepperPersonnes({
  valeur,
  onChange,
}: {
  valeur: number;
  onChange: (n: number) => void;
}) {
  const styleBouton =
    "flex size-9 items-center justify-center rounded-full border border-brand-200 text-lg leading-none text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        aria-label="Moins de personnes"
        disabled={valeur <= PERSONNES_MIN}
        onClick={() => onChange(valeur - 1)}
        className={styleBouton}
      >
        −
      </button>
      <span aria-live="polite" className="w-16 text-center text-sm font-medium text-brand-900">
        {valeur} pers.
      </span>
      <button
        type="button"
        aria-label="Plus de personnes"
        disabled={valeur >= PERSONNES_MAX}
        onClick={() => onChange(valeur + 1)}
        className={styleBouton}
      >
        +
      </button>
    </div>
  );
}

export default function PageReglages() {
  // `initiaux` = dernier état enregistré (référence pour « dirty ») ; `form` =
  // état éditable. Séparés pour n'activer « Enregistrer » qu'en cas de changement.
  const [initiaux, setInitiaux] = useState<ReglagesGeneration | null>(null);
  const [form, setForm] = useState<ReglagesGeneration | null>(null);
  const [recettes, setRecettes] = useState<Recette[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  useEffect(() => {
    let actif = true;
    // setState dans la promesse (pas synchrone au montage) → conforme à
    // react-hooks/set-state-in-effect.
    Promise.all([chargerReglages(), chargerRecettes()])
      .then(([r, rec]) => {
        if (!actif) return;
        setInitiaux(r);
        setForm(r);
        setRecettes(rec);
      })
      .catch(
        (e) =>
          actif &&
          setErreur(e instanceof Error ? e.message : "Chargement impossible.")
      );
    return () => {
      actif = false;
    };
  }, []);

  const modifie = useMemo(
    () =>
      !!(form && initiaux && JSON.stringify(form) !== JSON.stringify(initiaux)),
    [form, initiaux]
  );

  // B3 — garde de faisabilité : la config doit permettre de remplir 14 slots
  // distincts. Si le vivier n'est pas encore chargé, on n'empêche pas (faisable).
  const analyse = useMemo(
    () => (form && recettes ? analyserVivier(recettes, form) : null),
    [form, recettes]
  );
  const faisable = analyse ? analyse.suffisant : true;

  function definirPlafond(cle: CleCreneau, temps: TempsPreparation): void {
    setForm((f) =>
      f ? { ...f, plafonds: { ...f.plafonds, [cle]: temps } } : f
    );
  }

  // B2 — nombre de recettes du vivier éligibles à un plafond (temps ≤ plafond).
  function nbEligibles(plafond: TempsPreparation): number | null {
    if (recettes === null) return null;
    const max = rangTemps(plafond);
    return recettes.filter((r) => rangTemps(r.tempsPreparation) <= max).length;
  }

  // Préférence végé d'un créneau (#86 PR2) — absente = false.
  function vegeActif(cle: CleCreneau): boolean {
    return form?.vegetarienPrefere?.[cle] ?? false;
  }

  function definirVegePrefere(cle: CleCreneau, valeur: boolean): void {
    setForm((f) => {
      if (!f) return f;
      const base = f.vegetarienPrefere ?? {
        dejeunerSemaine: false,
        dinerSemaine: false,
        dejeunerWeekend: false,
        dinerWeekend: false,
      };
      return { ...f, vegetarienPrefere: { ...base, [cle]: valeur } };
    });
  }

  // B2 (végé) — recettes végétariennes éligibles à un plafond (temps ≤ plafond).
  function nbVegeEligibles(plafond: TempsPreparation): number | null {
    if (recettes === null) return null;
    const max = rangTemps(plafond);
    return recettes.filter(
      (r) => r.vegetarien === true && rangTemps(r.tempsPreparation) <= max
    ).length;
  }

  async function enregistrer(): Promise<void> {
    if (form === null || !modifie || !faisable) return;
    setEnregistrement(true);
    try {
      await sauvegarderReglages(form);
      setInitiaux(form); // l'état enregistré devient la nouvelle référence
      toast.success("Réglages enregistrés");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnregistrement(false);
    }
  }

  if (erreur !== null) {
    return (
      <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
        <h1 className="mb-4 text-2xl font-bold text-brand-900">Réglages</h1>
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      </main>
    );
  }

  if (form === null) {
    return (
      <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
        <h1 className="mb-4 text-2xl font-bold text-brand-900">Réglages</h1>
        <p role="status" className="animate-pulse text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <h1 className="mb-2 text-2xl font-bold text-brand-900">
        Réglages de génération
      </h1>
      <p className="mb-6 text-sm text-brand-700/85">
        Ces règles s’appliquent à la prochaine génération (complète ou d’un seul
        repas). Pense à enregistrer.
      </p>

      {/* Section — temps de préparation maximum par créneau */}
      <section className="mb-8" aria-labelledby="section-temps">
        <h2 id="section-temps" className="mb-1 text-lg font-semibold text-brand-900">
          Temps de préparation maximum
        </h2>
        <p className="mb-4 text-sm text-brand-700/85">
          Le temps le plus long autorisé pour chaque type de repas.
        </p>
        <div className="flex flex-col gap-5">
          {CRENEAUX.map(({ cle, libelle }) => {
            const eligibles = nbEligibles(form.plafonds[cle]);
            return (
              <div
                key={cle}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span
                    id={`plafond-${cle}`}
                    className="text-sm font-medium text-brand-900"
                  >
                    {libelle}
                  </span>
                  {eligibles !== null && (
                    <span className="text-xs text-brand-700/70">
                      {eligibles} recette{eligibles > 1 ? "s" : ""} éligible
                      {eligibles > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <SegmentPlafond
                  libelleId={`plafond-${cle}`}
                  valeur={form.plafonds[cle]}
                  onChange={(t) => definirPlafond(cle, t)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Section — privilégier le végétarien par créneau (#86 PR2, RG-26) */}
      <section className="mb-8" aria-labelledby="section-vege">
        <h2 id="section-vege" className="mb-1 text-lg font-semibold text-brand-900">
          Privilégier les repas végétariens
        </h2>
        <p className="mb-4 text-sm text-brand-700/85">
          Préférence souple : la génération choisit en priorité des recettes
          végétariennes sur ces créneaux. Si le vivier végé est insuffisant, le
          repas reste généré et tu es prévenu.
        </p>
        <div className="flex flex-col gap-5">
          {CRENEAUX.map(({ cle, libelle }) => {
            const actif = vegeActif(cle);
            const eligibles = actif ? nbVegeEligibles(form.plafonds[cle]) : null;
            return (
              <div
                key={cle}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span
                    id={`vege-${cle}`}
                    className="text-sm font-medium text-brand-900"
                  >
                    {libelle}
                  </span>
                  {eligibles !== null && (
                    <span className="text-xs text-brand-700/70">
                      {eligibles} recette{eligibles > 1 ? "s" : ""} végétarienne
                      {eligibles > 1 ? "s" : ""} éligible{eligibles > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <Bascule
                  libelleId={`vege-${cle}`}
                  actif={actif}
                  onChange={(v) => definirVegePrefere(cle, v)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Section — nombre de personnes par défaut */}
      <section className="mb-8" aria-labelledby="section-personnes">
        <h2
          id="section-personnes"
          className="mb-1 text-lg font-semibold text-brand-900"
        >
          Nombre de personnes par défaut
        </h2>
        <p className="mb-4 text-sm text-brand-700/85">
          Appliqué à chaque repas d’un planning fraîchement généré.
        </p>
        <StepperPersonnes
          valeur={form.personnesDefaut}
          onChange={(n) => setForm((f) => (f ? { ...f, personnesDefaut: n } : f))}
        />
      </section>

      {/* B3 — configuration infaisable : on explique et on bloque l'enregistrement */}
      {!faisable && analyse?.message && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {analyse.message}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() =>
            setForm({
              ...REGLAGES_DEFAUT,
              plafonds: { ...REGLAGES_DEFAUT.plafonds },
            })
          }
          className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Réinitialiser
        </button>
        <button
          type="button"
          onClick={enregistrer}
          disabled={!modifie || !faisable || enregistrement}
          aria-busy={enregistrement}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enregistrement ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </main>
  );
}
