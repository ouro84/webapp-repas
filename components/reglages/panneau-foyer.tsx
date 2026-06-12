"use client";

// Panneau « Mon foyer » de /reglages (#56 PR3, US-19). Compteur de membres,
// invitation (code + partage natif + QR — bonus), jonction par code (RG-33) et
// sortie (RG-29). Modèle « foyer de 1 systématique » : pas d'action « créer »,
// on naît solo et on INVITE pour partager, ou on REJOINT.
//
// Trois états (RG-09) : chargement / erreur / chargé. Le panneau se charge
// indépendamment des réglages de génération de la page hôte.
//
// Effet de bord clé : après une jonction/sortie, le FOYER change → le cache
// local (planning + coches) de l'ancien foyer est périmé. On le réinitialise
// (reinitialiserCacheFoyer) puis on recharge la page pour réhydrater depuis la
// base du nouveau foyer.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  chargerFoyer,
  genererCodeInvitation,
  quitterFoyer,
  rejoindreFoyer,
  type EtatFoyer,
} from "@/lib/foyer";
import { reinitialiserCacheFoyer } from "@/lib/sync";
import {
  chargerRecettesGerees,
  masquerRecette,
  supprimerRecette,
} from "@/lib/recettes";
import { detecterDoublons, type GroupeDoublon } from "@/lib/doublons";
import { ConfirmationModale } from "@/components/ui/confirmation";
import { ModaleDoublons } from "@/components/reglages/modale-doublons";
import type { Recette } from "@/types";

// Un code est utilisable tant qu'il n'a pas expiré (le serveur fait foi via
// rejoindre_foyer ; ici on n'affiche le bloc « actif » que pour un code valide).
function codeValide(etat: EtatFoyer): boolean {
  return (
    etat.code !== null &&
    etat.expireLe !== null &&
    new Date(etat.expireLe).getTime() > Date.now()
  );
}

function formaterExpiration(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PanneauFoyer() {
  const [etat, setEtat] = useState<EtatFoyer | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [codeSaisi, setCodeSaisi] = useState("");
  const [generation, setGeneration] = useState(false);
  const [jonction, setJonction] = useState(false);
  const [afficherQR, setAfficherQR] = useState(false);
  const [confirmerSortie, setConfirmerSortie] = useState(false);
  const [partageDispo, setPartageDispo] = useState(false);
  // Doublons détectés après une jonction (bonus dédup) ; null = modale fermée.
  const [doublons, setDoublons] = useState<GroupeDoublon[] | null>(null);
  const [editables, setEditables] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let actif = true;
    // Tous les setState se font DANS la promesse (pas synchrones au montage) →
    // conforme à react-hooks/set-state-in-effect (cf. pièges CLAUDE.md).
    chargerFoyer()
      .then((e) => {
        if (!actif) return;
        setEtat(e);
        // Partage natif (Web Share) — détecté côté client.
        setPartageDispo(typeof navigator !== "undefined" && !!navigator.share);
        // Pré-remplissage du code depuis un lien d'invitation (?rejoindre=CODE),
        // sans useSearchParams (évite la frontière Suspense) : lecture directe.
        const codeLien = new URLSearchParams(window.location.search).get(
          "rejoindre"
        );
        if (codeLien) setCodeSaisi(codeLien.toUpperCase());
      })
      .catch(
        (e) =>
          actif && setErreur(e instanceof Error ? e.message : "Chargement impossible.")
      );
    return () => {
      actif = false;
    };
  }, []);

  async function rafraichir(): Promise<void> {
    setEtat(await chargerFoyer());
  }

  async function generer(): Promise<void> {
    setGeneration(true);
    try {
      await genererCodeInvitation();
      await rafraichir();
      setAfficherQR(false);
      toast.success("Code d’invitation prêt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      setGeneration(false);
    }
  }

  function lienInvitation(code: string): string {
    return `${window.location.origin}/reglages?rejoindre=${code}`;
  }

  async function partager(code: string): Promise<void> {
    const message = `Rejoins mon foyer sur « On mange quoi ? » avec le code ${code}.`;
    try {
      await navigator.share({
        title: "On mange quoi ?",
        text: message,
        url: lienInvitation(code),
      });
    } catch {
      // Annulation utilisateur ou API absente : repli silencieux sur le copier.
    }
  }

  async function copier(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copié");
    } catch {
      toast.error("Copie impossible.");
    }
  }

  async function rejoindre(): Promise<void> {
    const code = codeSaisi.trim();
    if (!code) return;
    setJonction(true);
    try {
      await rejoindreFoyer(code);
      // Le profil pointe désormais le nouveau foyer : on lit son catalogue
      // fusionné pour détecter d'éventuels doublons (RG-33 / bonus dédup).
      const gerees = await chargerRecettesGerees();
      const groupes = detecterDoublons(gerees.map((g) => g.recette));
      if (groupes.length > 0) {
        setEditables(new Map(gerees.map((g) => [g.recette.id, g.editable])));
        setDoublons(groupes); // ouvre la modale ; le rechargement suit sa fermeture
      } else {
        terminerChangementFoyer();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de rejoindre ce foyer.");
      setJonction(false);
    }
  }

  async function sortir(): Promise<void> {
    setConfirmerSortie(false);
    try {
      await quitterFoyer();
      terminerChangementFoyer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de quitter le foyer.");
    }
  }

  // Réinitialise le cache local périmé puis recharge la page : la prochaine
  // hydratation repart de la base du nouveau foyer.
  function terminerChangementFoyer(): void {
    reinitialiserCacheFoyer();
    window.location.reload();
  }

  // Supprime une recette depuis la modale de doublons : suppression réelle pour
  // une recette du foyer (editable), masquage pour une globale (#105).
  async function supprimerDoublon(recette: Recette): Promise<void> {
    if (editables.get(recette.id)) await supprimerRecette(recette.id);
    else await masquerRecette(recette.id);
  }

  if (erreur !== null) {
    return (
      <section className="mb-8" aria-labelledby="section-foyer">
        <h2 id="section-foyer" className="mb-1 text-lg font-semibold text-brand-900">
          Mon foyer
        </h2>
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      </section>
    );
  }

  if (etat === null) {
    return (
      <section className="mb-8" aria-labelledby="section-foyer">
        <h2 id="section-foyer" className="mb-1 text-lg font-semibold text-brand-900">
          Mon foyer
        </h2>
        <p role="status" className="animate-pulse text-brand-700/85">
          Chargement…
        </p>
      </section>
    );
  }

  const partage = etat.membres > 1;
  const valide = codeValide(etat);

  return (
    <section className="mb-8" aria-labelledby="section-foyer">
      <h2 id="section-foyer" className="mb-1 text-lg font-semibold text-brand-900">
        Mon foyer
      </h2>
      <p className="mb-4 text-sm text-brand-700/85">
        {partage
          ? `Vous êtes ${etat.membres} à partager recettes, planning et liste de courses.`
          : "Tu es seul·e dans ton foyer. Invite quelqu’un pour tout partager : recettes, planning et liste de courses."}
      </p>

      {/* Inviter : génération + partage du code (RG-30 : tout membre peut). */}
      <div className="mb-6 rounded-2xl border border-brand-100 p-4">
        {valide && etat.code ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-700/70">
                Code d’invitation
              </p>
              <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-brand-900">
                {etat.code}
              </p>
              {etat.expireLe && (
                <p className="text-xs text-brand-700/70">
                  Valable jusqu’au {formaterExpiration(etat.expireLe)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {partageDispo && (
                <button
                  type="button"
                  onClick={() => partager(etat.code!)}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  Partager
                </button>
              )}
              <button
                type="button"
                onClick={() => copier(etat.code!)}
                className="rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
              >
                Copier
              </button>
              <button
                type="button"
                onClick={() => setAfficherQR((v) => !v)}
                aria-expanded={afficherQR}
                className="rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
              >
                {afficherQR ? "Masquer le QR" : "QR code"}
              </button>
              <button
                type="button"
                onClick={generer}
                disabled={generation}
                className="rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-50"
              >
                {generation ? "…" : "Régénérer"}
              </button>
            </div>

            {afficherQR && (
              // Fond BLANC littéral (pas bg-surface) : le contraste du QR doit
              // tenir en mode sombre comme en clair pour rester scannable.
              <div className="self-start rounded-xl bg-white p-3">
                <QRCodeSVG value={lienInvitation(etat.code)} size={160} />
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={generer}
            disabled={generation}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-50"
          >
            {generation ? "Génération…" : "Inviter quelqu’un"}
          </button>
        )}
      </div>

      {/* Rejoindre : interdit si déjà en foyer partagé (RG-29 → quitter d'abord). */}
      {partage ? (
        <p className="mb-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Pour rejoindre un autre foyer, quitte d’abord celui-ci.
        </p>
      ) : (
        <div className="mb-6">
          <label
            htmlFor="code-foyer"
            className="mb-2 block text-sm font-medium text-brand-900"
          >
            Rejoindre un foyer
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="code-foyer"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={codeSaisi}
              onChange={(e) => setCodeSaisi(e.target.value.toUpperCase())}
              placeholder="Code reçu (ex. K7M2PQ9X)"
              className="flex-1 rounded-full border border-brand-200 bg-surface px-4 py-2.5 font-mono tracking-widest text-brand-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-brand-700/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            />
            <button
              type="button"
              onClick={rejoindre}
              disabled={jonction || codeSaisi.trim().length === 0}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {jonction ? "Connexion…" : "Rejoindre"}
            </button>
          </div>
        </div>
      )}

      {/* Quitter : seulement en foyer partagé (quitter en solo n'a pas de sens). */}
      {partage && (
        <button
          type="button"
          onClick={() => setConfirmerSortie(true)}
          className="rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Quitter le foyer
        </button>
      )}

      {confirmerSortie && (
        <ConfirmationModale
          titre="Quitter le foyer ?"
          message="Tu repartiras avec ta propre copie des recettes, du planning et de la liste de courses du foyer. Les autres membres, eux, conservent tout."
          libelleConfirmer="Quitter"
          onConfirmer={sortir}
          onAnnuler={() => setConfirmerSortie(false)}
        />
      )}

      {doublons !== null && (
        <ModaleDoublons
          groupes={doublons}
          onSupprimer={supprimerDoublon}
          // Fermeture de la modale = fin du parcours de jonction : on recharge.
          onFermer={() => terminerChangementFoyer()}
        />
      )}
    </section>
  );
}
