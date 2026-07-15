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
import {
  ORDRE_TEMPS,
  rangTemps,
  REGLAGES_DEFAUT,
  auMoinsUnCreneauActif,
} from "@/lib/reglages";
import { analyserVivier } from "@/lib/generateur";
import { PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes";
import { Interrupteur } from "@/components/ui/interrupteur";
import type { Recette, ReglagesGeneration, PlafondCreneau } from "@/types";

// Ordre d'affichage du contrôle segmenté : les plafonds de temps, puis
// « Aucun » (#217, RG-44) — dernier, car c'est l'exception (« je ne cuisine
// pas ce repas »), pas le cas courant.
const ORDRE_PLAFONDS: PlafondCreneau[] = [...ORDRE_TEMPS, "aucun"];

const LIBELLE_PLAFOND: Record<PlafondCreneau, string> = {
  rapide: "Rapide",
  normal: "Normal",
  long: "Long",
  aucun: "—",
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

// Contrôle segmenté (radiogroup) : Rapide / Normal / Long / Aucun (#217).
function SegmentPlafond({
  libelleId,
  valeur,
  onChange,
}: {
  libelleId: string;
  valeur: PlafondCreneau;
  onChange: (plafond: PlafondCreneau) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={libelleId}
      className="inline-flex rounded-full border border-brand-200 bg-surface p-0.5"
    >
      {ORDRE_PLAFONDS.map((p) => {
        const actif = p === valeur;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={actif}
            aria-label={p === "aucun" ? "Aucun (je ne cuisine pas ce repas)" : undefined}
            onClick={() => onChange(p)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              actif ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"
            }`}
          >
            {LIBELLE_PLAFOND[p]}
          </button>
        );
      })}
    </div>
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
    "flex size-9 items-center justify-center rounded-full border border-brand-200 text-lg leading-none text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
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
  // RG-47 (#217) : au moins un créneau doit rester actif — garde indépendante
  // de la faisabilité du vivier (B3), bloque l'enregistrement elle aussi.
  const creneauValide = form ? auMoinsUnCreneauActif(form.plafonds) : true;
  const faisable = (analyse ? analyse.suffisant : true) && creneauValide;

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

  const blocGeneration =
    erreur !== null ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {erreur}
      </p>
    ) : form === null ? (
      <p role="status" className="animate-pulse text-brand-700/85">
        Chargement…
      </p>
    ) : (
      <GenerationReglages
        form={form}
        setForm={setForm}
        recettes={recettes}
        analyse={analyse}
        faisable={faisable}
        creneauValide={creneauValide}
        modifie={modifie}
        enregistrement={enregistrement}
        enregistrer={enregistrer}
      />
    );

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">
        Réglages de génération
      </h1>
      {blocGeneration}
    </main>
  );
}

// Bloc des réglages de génération (#45) — extrait pour que la page hôte rende le
// panneau Foyer indépendamment de l'état (chargement/erreur) de ces réglages.
function GenerationReglages({
  form,
  setForm,
  recettes,
  analyse,
  faisable,
  creneauValide,
  modifie,
  enregistrement,
  enregistrer,
}: {
  form: ReglagesGeneration;
  setForm: React.Dispatch<React.SetStateAction<ReglagesGeneration | null>>;
  recettes: Recette[] | null;
  analyse: ReturnType<typeof analyserVivier> | null;
  faisable: boolean;
  creneauValide: boolean;
  modifie: boolean;
  enregistrement: boolean;
  enregistrer: () => Promise<void>;
}) {
  function definirPlafond(cle: CleCreneau, plafond: PlafondCreneau): void {
    setForm((f) => (f ? { ...f, plafonds: { ...f.plafonds, [cle]: plafond } } : f));
  }
  // « Aucun » (#217) : pas de plafond de temps à parler d'éligibilité — ce
  // créneau n'est simplement pas généré.
  function nbEligibles(plafond: PlafondCreneau): number | null {
    if (recettes === null || plafond === "aucun") return null;
    const max = rangTemps(plafond);
    return recettes.filter((r) => rangTemps(r.tempsPreparation) <= max).length;
  }
  function vegeActif(cle: CleCreneau): boolean {
    return form.vegetarienPrefere?.[cle] ?? false;
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
  function nbVegeEligibles(plafond: PlafondCreneau): number | null {
    if (recettes === null || plafond === "aucun") return null;
    const max = rangTemps(plafond);
    return recettes.filter(
      (r) => r.vegetarien === true && rangTemps(r.tempsPreparation) <= max
    ).length;
  }
  const mixActif = form.mixAccompagnementJour ?? false;
  function definirMix(valeur: boolean): void {
    setForm((f) => (f ? { ...f, mixAccompagnementJour: valeur } : f));
  }
  const nbLegumes =
    recettes === null
      ? null
      : recettes.filter((r) => r.accompagnement === "legumes").length;
  const saisonnaliteActif = form.saisonnalite !== false;
  function definirSaisonnalite(valeur: boolean): void {
    setForm((f) => (f ? { ...f, saisonnalite: valeur } : f));
  }

  return (
    <>
      <p className="mb-6 text-sm text-brand-700/85">
        Ces règles s’appliquent à la prochaine génération (complète ou d’un seul
        repas). Pense à enregistrer.
      </p>

      {/* Section — temps de préparation maximum par créneau */}
      <section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4 md:p-5" aria-labelledby="section-temps">
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
                    <span className="text-xs text-brand-700/85">
                      {eligibles} recette{eligibles > 1 ? "s" : ""} éligible
                      {eligibles > 1 ? "s" : ""}
                    </span>
                  )}
                  {form.plafonds[cle] === "aucun" && (
                    <span className="text-xs text-brand-700/85">
                      Ce repas n’est pas généré.
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
      <section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4 md:p-5" aria-labelledby="section-vege">
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
                    <span className="text-xs text-brand-700/85">
                      {eligibles} recette{eligibles > 1 ? "s" : ""} végétarienne
                      {eligibles > 1 ? "s" : ""} éligible{eligibles > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <Interrupteur
                  libelleId={`vege-${cle}`}
                  actif={actif}
                  onChange={(v) => definirVegePrefere(cle, v)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Section — au moins un repas légumes par jour (#49 PR2, RG-27) */}
      <section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4 md:p-5" aria-labelledby="section-mix">
        <h2 id="section-mix" className="mb-1 text-lg font-semibold text-brand-900">
          Équilibre des accompagnements
        </h2>
        <p className="mb-4 text-sm text-brand-700/85">
          Préférence souple : la génération s’arrange pour qu’au moins un des
          deux repas de chaque journée soit à base de légumes. Si le vivier de
          recettes « légumes » est insuffisant, le planning est généré quand
          même et tu es prévenu.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span
              id="mix-legume"
              className="text-sm font-medium text-brand-900"
            >
              Au moins un repas légumes par jour
            </span>
            {mixActif && nbLegumes !== null && (
              <span className="text-xs text-brand-700/85">
                {nbLegumes} recette{nbLegumes > 1 ? "s" : ""} « légumes » dans ton
                vivier
              </span>
            )}
          </div>
          <Interrupteur
            libelleId="mix-legume"
            actif={mixActif}
            onChange={definirMix}
          />
        </div>
      </section>

      {/* Section — saisonnalité (#23 PR2, RG-28) */}
      <section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4 md:p-5" aria-labelledby="section-saison">
        <h2 id="section-saison" className="mb-1 text-lg font-semibold text-brand-900">
          Recettes de saison
        </h2>
        <p className="mb-4 text-sm text-brand-700/85">
          La génération ne propose que des recettes de la saison de la semaine
          planifiée. Si le vivier de saison est insuffisant, le planning est
          complété avec d’autres recettes et tu es prévenu.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span id="saisonnalite" className="text-sm font-medium text-brand-900">
            Ne proposer que des recettes de saison
          </span>
          <Interrupteur
            libelleId="saisonnalite"
            actif={saisonnaliteActif}
            onChange={definirSaisonnalite}
          />
        </div>
      </section>

      {/* Section — nombre de personnes par défaut */}
      <section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4 md:p-5" aria-labelledby="section-personnes">
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

      {/* RG-47 (#217) : au moins un créneau doit rester actif. */}
      {!creneauValide && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Au moins un repas doit rester actif — tu ne peux pas tous les régler
          sur « — ».
        </p>
      )}

      {/* B3 — configuration infaisable : on explique et on bloque l'enregistrement */}
      {creneauValide && !faisable && analyse?.message && (
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
          className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Réinitialiser
        </button>
        <button
          type="button"
          onClick={enregistrer}
          disabled={!modifie || !faisable || enregistrement}
          aria-busy={enregistrement}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enregistrement ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </>
  );
}
