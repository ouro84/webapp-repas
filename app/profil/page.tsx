"use client";

// Page « Mon profil » (#22 PR1) — point d'entrée « mon compte ».
//
// Sépare l'IDENTITÉ (qui je suis, avec qui) de la CONFIGURATION DE GÉNÉRATION
// (comment l'app se comporte, page /reglages). Regroupe : édition du prénom et
// de l'avatar, foyer (PanneauFoyer, déplacé depuis /reglages), sécurité
// (changement de mot de passe), lien vers les réglages de génération, et
// déconnexion.
//
// Déconnexion : on détruit la session PUIS on réinitialise le cache local
// (planning + coches du foyer) — sinon il survivrait à la déconnexion et
// fuiterait vers le prochain compte connecté sur l'appareil. Navigation pleine
// page vers /login (le proxy confirme l'absence de session).

import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { reinitialiserCacheFoyer } from "@/lib/sync";
import { EditionIdentite } from "@/components/profil/edition-identite";
import { ChangerMotDePasse } from "@/components/profil/changer-mot-de-passe";
import { PanneauFoyer } from "@/components/profil/panneau-foyer";

export default function PageProfil() {
  async function deconnecter(): Promise<void> {
    try {
      // scope 'local' : déconnecte CET appareil sans révoquer les sessions des
      // autres (les membres du foyer / mes autres appareils restent connectés).
      // Évite aussi, en e2e, de révoquer les tokens du compte de test partagé.
      await createClient().auth.signOut({ scope: "local" });
      reinitialiserCacheFoyer();
      window.location.assign("/login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Déconnexion impossible.");
    }
  }

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">
        Mon profil
      </h1>

      <EditionIdentite />
      <div className="mb-8 border-t border-brand-100" />

      <PanneauFoyer />
      <div className="mb-8 border-t border-brand-100" />

      <ChangerMotDePasse />
      <div className="mb-8 border-t border-brand-100" />

      {/* Passerelle vers la configuration de génération (séparée de l'identité). */}
      <Link
        href="/reglages"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline underline-offset-2 transition-colors hover:text-brand-600"
      >
        Réglages de génération →
      </Link>

      <div className="mt-8 border-t border-brand-100 pt-6">
        <button
          type="button"
          onClick={deconnecter}
          className="rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Se déconnecter
        </button>
      </div>
    </main>
  );
}
