"use client";

// Section « Assistants connectés » de /profil (#305, US-50, RG-72).
//
// Liste les clients OAuth (assistants IA) autorisés par l'utilisateur
// (`auth.oauth.listGrants`) et permet de les déconnecter (`revokeGrant`) :
// Supabase révoque le consentement, supprime les sessions du client et
// invalide ses refresh tokens. Le jeton d'accès déjà émis reste valable
// jusqu'à son expiration (au plus 1 h, `jwt_exp`), ce que RG-72 admet.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { OAuthGrant } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ConfirmationModale } from "@/components/ui/confirmation";

type Etat = { type: "chargement" } | { type: "erreur" } | { type: "pret"; grants: OAuthGrant[] };

function dateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function AssistantsConnectes() {
  const [etat, setEtat] = useState<Etat>({ type: "chargement" });
  const [aConfirmer, setAConfirmer] = useState<OAuthGrant | null>(null);

  useEffect(() => {
    let actif = true;
    createClient()
      .auth.oauth.listGrants()
      .then(({ data, error }) => {
        if (!actif) return;
        if (error || !data) {
          console.error("Chargement des assistants connectés échoué.", error);
          setEtat({ type: "erreur" });
        } else {
          setEtat({ type: "pret", grants: data });
        }
      })
      .catch((erreur: unknown) => {
        console.error("Chargement des assistants connectés échoué.", erreur);
        if (actif) setEtat({ type: "erreur" });
      });
    return () => {
      actif = false;
    };
  }, []);

  async function deconnecter(grant: OAuthGrant): Promise<void> {
    setAConfirmer(null);
    const nom = grant.client.name;
    try {
      const { error } = await createClient().auth.oauth.revokeGrant({ clientId: grant.client.id });
      if (error) throw error;
      setEtat((precedent) =>
        precedent.type === "pret"
          ? { type: "pret", grants: precedent.grants.filter((g) => g.client.id !== grant.client.id) }
          : precedent
      );
      toast.success(`${nom} est déconnecté.`);
    } catch (erreur) {
      console.error("Révocation de l'assistant échouée.", erreur);
      toast.error(`Impossible de déconnecter ${nom}. Réessaie.`);
    }
  }

  return (
    <section aria-labelledby="titre-assistants" className="mb-8">
      <h2 id="titre-assistants" className="mb-4 text-lg font-semibold text-brand-900">
        Assistants connectés
      </h2>

      {etat.type === "chargement" && <p className="text-sm text-brand-700/85">Chargement…</p>}

      {etat.type === "erreur" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Impossible de charger les assistants connectés. Réessaie plus tard.
        </p>
      )}

      {etat.type === "pret" && etat.grants.length === 0 && (
        <p className="text-sm text-brand-700/85">Aucun assistant connecté.</p>
      )}

      {etat.type === "pret" && etat.grants.length > 0 && (
        <ul className="flex flex-col gap-3">
          {etat.grants.map((grant) => (
            <li key={grant.client.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-brand-900">
                {grant.client.name}
                <span className="block text-xs font-normal text-brand-700/85">
                  {`autorisé le ${dateFr(grant.granted_at)}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setAConfirmer(grant)}
                aria-label={`Déconnecter ${grant.client.name}`}
                className="rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
              >
                Déconnecter
              </button>
            </li>
          ))}
        </ul>
      )}

      {aConfirmer && (
        <ConfirmationModale
          titre={`Déconnecter ${aConfirmer.client.name} ?`}
          message="Il ne pourra plus accéder à ton compte et devra redemander ton autorisation."
          libelleConfirmer="Déconnecter"
          onConfirmer={() => deconnecter(aConfirmer)}
          onAnnuler={() => setAConfirmer(null)}
        />
      )}
    </section>
  );
}
