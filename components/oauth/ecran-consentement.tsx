"use client";

// Écran de consentement OAuth 2.1 (#305, US-50, RG-72).
//
// Supabase OAuth Server redirige ici (`/oauth/consent?authorization_id=…`)
// quand un assistant IA demande l'accès au compte. Le proxy garantit une
// session OMQ et un onboarding terminé. On affiche le client et ce qu'il
// pourra faire, puis on approuve ou refuse via `auth.oauth.*` et on renvoie le
// navigateur vers l'URL du client fournie par Supabase (code ou erreur).
//
// Parcours focalisé (pas de nav, cf. app/oauth/consent/page.tsx) : le logo OMQ
// en tête dit chez qui l'on donne son accord, l'hôte de retour dit où part le
// code, la carte des droits dit ce que l'assistant pourra faire, et une seule
// décision est demandée.
//
// Les droits annoncés couvrent aussi l'écriture : une autorisation accordée
// maintenant vaudra pour les outils de modification (#306), Supabase ne
// distinguant pas de portée lecture/écriture.

import { useEffect, useState } from "react";
import { Eye, PenLine } from "lucide-react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/logo";

const MESSAGE_INVALIDE =
  "Cette demande d’autorisation est invalide ou a expiré. Relance la connexion depuis ton assistant.";

type Etat =
  | { type: "chargement" }
  | { type: "erreur" }
  | { type: "consentement"; details: OAuthAuthorizationDetails };

type Decision = "autoriser" | "refuser";

function hote(uri: string): string | null {
  try {
    return uri ? new URL(uri).host : null;
  } catch {
    return null;
  }
}

export function EcranConsentement({ authorizationId }: { authorizationId: string | null }) {
  const [etat, setEtat] = useState<Etat>({ type: "chargement" });
  const [envoi, setEnvoi] = useState<Decision | null>(null);
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

  async function decider(decision: Decision): Promise<void> {
    if (etat.type !== "consentement") return;
    setEnvoi(decision);
    setErreurEnvoi(null);
    const oauth = createClient().auth.oauth;
    const id = etat.details.authorization_id;
    try {
      const { data, error } =
        decision === "autoriser"
          ? await oauth.approveAuthorization(id, { skipBrowserRedirect: true })
          : await oauth.denyAuthorization(id, { skipBrowserRedirect: true });
      if (error || !data) throw error ?? new Error("Réponse vide.");
      window.location.assign(data.redirect_url);
    } catch (erreur) {
      console.error("Décision de consentement OAuth échouée.", erreur);
      setErreurEnvoi(
        decision === "autoriser"
          ? "L’autorisation n’a pas pu être enregistrée. Réessaie."
          : "Le refus n’a pas pu être transmis. Réessaie."
      );
      setEnvoi(null);
    }
  }

  if (!authorizationId || etat.type === "erreur") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <Logo className="size-12 text-brand-600" />
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {MESSAGE_INVALIDE}
        </p>
      </div>
    );
  }

  if (etat.type === "chargement") {
    return (
      <p role="status" className="animate-pulse text-center text-brand-700/85">
        Chargement de la demande…
      </p>
    );
  }

  const { client, user, redirect_uri: redirectUri } = etat.details;
  // Hôte du redirect_uri ENREGISTRÉ : c'est là que part le code d'accès. On
  // n'affiche pas client.uri, que le client déclare librement en DCR (un
  // tiers pourrait se présenter en « claude.ai »).
  const destination = hote(redirectUri);

  return (
    <section aria-labelledby="titre-consentement" className="flex flex-col">
      <Logo className="mb-6 size-12 self-center text-brand-600" />

      <h1
        id="titre-consentement"
        className="text-center font-display text-2xl font-semibold text-balance text-brand-900"
      >
        Autoriser {client.name}&nbsp;?
      </h1>
      <p className="mt-2 text-center text-sm text-brand-700/85">
        Cet assistant demande l’accès à ton compte On mange quoi&nbsp;?
      </p>
      {destination && (
        <p className="mt-1 text-center text-sm text-brand-700/85">
          {"Après ton choix, retour vers "}
          <span className="font-medium text-brand-900">{destination}</span>.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-brand-100 bg-surface p-4">
        <p className="text-sm font-medium text-brand-900">
          {`${client.name} pourra, en ton nom et seulement pour ton foyer :`}
        </p>
        <ul className="mt-3 flex flex-col gap-3 text-sm text-brand-900">
          <li className="flex gap-3">
            <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <span>consulter ton planning, ta liste de courses et tes recettes&nbsp;;</span>
          </li>
          <li className="flex gap-3">
            <PenLine aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <span>générer ou modifier ton planning et ta liste de courses, et ajouter des recettes.</span>
          </li>
        </ul>
      </div>

      <p className="mt-4 text-sm text-brand-700/85">
        Connecté en tant que <span className="font-medium text-brand-900">{user.email}</span>.
        Tu pourras retirer cet accès à tout moment depuis ton profil, section «&nbsp;Assistants
        connectés&nbsp;».
      </p>

      {erreurEnvoi && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {erreurEnvoi}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => decider("autoriser")}
          disabled={envoi !== null}
          aria-busy={envoi === "autoriser"}
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Autoriser
        </button>
        <button
          type="button"
          onClick={() => decider("refuser")}
          disabled={envoi !== null}
          aria-busy={envoi === "refuser"}
          className="rounded-full border border-brand-200 bg-surface px-6 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refuser
        </button>
      </div>
    </section>
  );
}
