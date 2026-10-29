"use client";

// Écran de consentement OAuth 2.1 (#305, US-50, RG-72).
//
// Supabase OAuth Server redirige ici (`/oauth/consent?authorization_id=…`)
// quand un assistant IA demande l'accès au compte. Le proxy garantit une
// session OMQ et un onboarding terminé. On affiche le client et ce qu'il
// pourra faire, puis on approuve ou refuse via `auth.oauth.*` et on renvoie le
// navigateur vers l'URL du client fournie par Supabase (code ou erreur).
//
// Les droits annoncés couvrent aussi l'écriture : une autorisation accordée
// maintenant vaudra pour les outils de modification (#306), Supabase ne
// distinguant pas de portée lecture/écriture.

import { useEffect, useState } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const MESSAGE_INVALIDE =
  "Cette demande d’autorisation est invalide ou a expiré. Relance la connexion depuis ton assistant.";

type Etat =
  | { type: "chargement" }
  | { type: "erreur" }
  | { type: "consentement"; details: OAuthAuthorizationDetails };

function hote(uri: string): string | null {
  try {
    return uri ? new URL(uri).host : null;
  } catch {
    return null;
  }
}

export function EcranConsentement({ authorizationId }: { authorizationId: string | null }) {
  const [etat, setEtat] = useState<Etat>({ type: "chargement" });
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (!authorizationId) return;
    let actif = true;
    createClient()
      .auth.oauth.getAuthorizationDetails(authorizationId)
      .then(({ data, error }) => {
        if (!actif) return;
        if (error || !data) {
          console.error("Demande d'autorisation OAuth illisible.", error);
          setEtat({ type: "erreur" });
        } else if ("authorization_id" in data) {
          setEtat({ type: "consentement", details: data });
        } else {
          // Déjà autorisé pour ces droits : retour direct au client.
          window.location.assign(data.redirect_url);
        }
      })
      .catch((erreur: unknown) => {
        console.error("Demande d'autorisation OAuth illisible.", erreur);
        if (actif) setEtat({ type: "erreur" });
      });
    return () => {
      actif = false;
    };
  }, [authorizationId]);

  async function decider(approuver: boolean): Promise<void> {
    if (etat.type !== "consentement") return;
    setEnvoi(true);
    setErreurEnvoi(null);
    const oauth = createClient().auth.oauth;
    const id = etat.details.authorization_id;
    try {
      const { data, error } = approuver
        ? await oauth.approveAuthorization(id, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(id, { skipBrowserRedirect: true });
      if (error || !data) throw error ?? new Error("Réponse vide.");
      window.location.assign(data.redirect_url);
    } catch (erreur) {
      console.error("Décision de consentement OAuth échouée.", erreur);
      setErreurEnvoi(
        approuver
          ? "L’autorisation n’a pas pu être enregistrée. Réessaie."
          : "Le refus n’a pas pu être transmis. Réessaie."
      );
      setEnvoi(false);
    }
  }

  if (!authorizationId || etat.type === "erreur") {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {MESSAGE_INVALIDE}
      </p>
    );
  }

  if (etat.type === "chargement") {
    return <p className="text-sm text-brand-700/85">Chargement de la demande…</p>;
  }

  const { client, user } = etat.details;
  const site = hote(client.uri);

  return (
    <section aria-labelledby="titre-consentement" className="flex flex-col gap-4">
      <h1 id="titre-consentement" className="font-display text-2xl font-semibold text-brand-900">
        Autoriser {client.name} ?
      </h1>
      {site && <p className="text-sm text-brand-700/85">{site}</p>}
      <div className="text-sm text-brand-900">
        <p>{client.name} pourra, en ton nom et seulement pour ton foyer :</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>consulter ton planning, ta liste de courses et tes recettes ;</li>
          <li>générer ou modifier ton planning et ta liste de courses, et ajouter des recettes.</li>
        </ul>
      </div>
      <p className="text-sm text-brand-700/85">Connecté en tant que {user.email}.</p>
      <p className="text-sm text-brand-700/85">
        Tu pourras retirer cet accès à tout moment depuis ton profil, section « Assistants connectés ».
      </p>
      {erreurEnvoi && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {erreurEnvoi}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => decider(true)}
          disabled={envoi}
          aria-busy={envoi}
          className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Autoriser
        </button>
        <button
          type="button"
          onClick={() => decider(false)}
          disabled={envoi}
          className="rounded-full border border-brand-200 px-6 py-3 text-sm font-medium text-brand-900 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refuser
        </button>
      </div>
    </section>
  );
}
