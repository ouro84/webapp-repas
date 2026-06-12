"use client";

// Interstitiel d'invitation en attente (#22 PR3, US-24 sc.2) — pour un membre
// DÉJÀ inscrit qui ouvre un lien d'invitation. Monté une seule fois dans le
// layout (comme AlerteModifPlanning), il :
//  1. capte un éventuel `?code=` de l'URL vers sessionStorage (sur TOUTES les
//     pages, y compris /login & /signup avant submit, et /planning?code=… après
//     la redirection du proxy d'un utilisateur déjà connecté) ;
//  2. hors tunnel/auth, si un code valide est en attente et que l'utilisateur
//     est SOLO, propose de rejoindre le foyer de l'invitant·e (RG-29 : refusé
//     s'il est déjà en foyer partagé → on l'explique et on oublie le code).
//
// Le nouvel inscrit, lui, est géré par le tunnel /bienvenue (qui lit le même
// code) — d'où l'inertie de ce composant sur /bienvenue, /login et /signup.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { chargerFoyer, rejoindreFoyer } from "@/lib/foyer";
import { reinitialiserCacheFoyer } from "@/lib/sync";
import {
  apercuInvitation,
  capterCodeDepuisURL,
  effacerCodeEnAttente,
  lireCodeEnAttente,
} from "@/lib/invitation";
import { ConfirmationModale } from "@/components/ui/confirmation";

// Pages où ce composant reste inerte (le tunnel ou l'auth gèrent le code).
const PAGES_INERTES = new Set(["/bienvenue", "/login", "/signup"]);

export function InvitationEnAttente() {
  const pathname = usePathname();
  // Code + prénom de l'invitant à confirmer (null = pas de modale).
  const [invitation, setInvitation] = useState<{
    code: string;
    prenom: string | null;
  } | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let actif = true;
    // Capte d'abord un code éventuel de l'URL (toutes pages) → sessionStorage.
    capterCodeDepuisURL();
    if (PAGES_INERTES.has(pathname)) return;
    const code = lireCodeEnAttente();
    if (!code) return;

    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!actif || !user) return; // déconnecté : sera traité après connexion

      // RG-29 : on ne peut rejoindre qu'en étant solo.
      const foyer = await chargerFoyer().catch(() => null);
      if (!actif || !foyer) return;
      if (foyer.membres > 1) {
        effacerCodeEnAttente();
        toast.info("Pour rejoindre ce foyer, quitte d’abord le tien (Profil).");
        return;
      }

      const apercu = await apercuInvitation(code).catch(() => null);
      if (!actif) return;
      if (!apercu || !apercu.valide) {
        effacerCodeEnAttente(); // code expiré / invalide : on oublie
        return;
      }
      setInvitation({ code, prenom: apercu.prenom });
    })().catch(() => {});

    return () => {
      actif = false;
    };
  }, [pathname]);

  if (invitation === null) return null;

  async function rejoindre(): Promise<void> {
    if (invitation === null || enCours) return;
    setEnCours(true);
    try {
      await rejoindreFoyer(invitation.code);
      effacerCodeEnAttente();
      // Le foyer a changé → cache local périmé (cf. #56 PR3) puis rechargement.
      reinitialiserCacheFoyer();
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de rejoindre ce foyer.");
      setEnCours(false);
      setInvitation(null);
    }
  }

  function ignorer(): void {
    effacerCodeEnAttente();
    setInvitation(null);
  }

  return (
    <ConfirmationModale
      titre={
        invitation.prenom
          ? `Rejoindre le foyer de ${invitation.prenom} ?`
          : "Rejoindre ce foyer ?"
      }
      message="Vous partagerez recettes, planning et liste de courses. Tes recettes personnelles seront fusionnées dans le foyer."
      libelleConfirmer={enCours ? "…" : "Rejoindre"}
      onConfirmer={rejoindre}
      onAnnuler={ignorer}
    />
  );
}
