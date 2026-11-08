"use client";

// Suppression de compte (#237, US-31) — droit à l'effacement RGPD. Section
// "Zone dangereuse" de /profil, même patron que ChangerMotDePasse : ré-auth
// + confirmation forte (saisie exacte de "SUPPRIMER"), pas de modale.
//
// La protection réelle est le contrôle de fraîcheur côté serveur (RG-93) : la
// route et la RPC refusent (403) si la session ne s'est pas authentifiée il y a
// moins de 5 minutes. Le composant ne fait que provoquer cette ré-authentification :
//  - compte avec mot de passe : `signInWithPassword` juste avant l'appel ;
//  - compte Google sans mot de passe (US-57, D10) : aller-retour OAuth
//    (`prompt=select_account`, `login_hint`) qui revient sur
//    `/profil?suppression=confirmer`. L'uid et l'email d'origine voyagent en
//    `sessionStorage` : au retour, un autre uid (autre compte Google choisi)
//    déconnecte et affiche un message. Annulation ou échec chez Google : le
//    callback revient ici avec `erreur_oauth` (session conservée), on consomme
//    le mémo, on affiche le message et on redemande. Cas « compte Google neuf choisi par
//    erreur » : ce compte n'a pas fini l'onboarding, le proxy l'envoie sur
//    /bienvenue et la page n'est jamais atteinte, donc rien n'est supprimé.
// Le mot "SUPPRIMER" reste une confirmation UX (RG design D6).

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reinitialiserCacheFoyer } from "@/lib/sync";
import { chargerFoyer } from "@/lib/foyer";
import { methodeReauth, type MethodeReauth } from "@/lib/reauth";
import { messageErreurOAuth, urlRetourOAuth } from "@/lib/auth-google";
import { CLASSES_BOUTON_GOOGLE, LogoGoogle, SpinnerGoogle } from "@/components/auth/logo-google";

const MOT_CONFIRMATION = "SUPPRIMER";
// Mémo de l'aller-retour Google : JSON `{ uid, email }` (US-57, D10).
const CLE_REAUTH = "reauth_suppression_uid";
const PARAM_RETOUR = "suppression";
const VALEUR_RETOUR = "confirmer";
// Posé par /auth/callback quand Google a été annulé ou a échoué (session conservée).
const PARAM_ERREUR_OAUTH = "erreur_oauth";
const MESSAGE_REAUTH_ANNULEE = "Confirmation avec Google annulée. Tu peux réessayer.";
const CHEMIN_RETOUR = `/profil?${PARAM_RETOUR}=${VALEUR_RETOUR}`;

type Utilisateur = { id: string; email: string | null; methode: MethodeReauth };

/** Lit puis efface le mémo ; `null` si absent ou illisible. */
function consommerMemoReauth(): { uid: string; email: string } | null {
  try {
    const brut = sessionStorage.getItem(CLE_REAUTH);
    sessionStorage.removeItem(CLE_REAUTH);
    if (brut === null) return null;
    const memo = JSON.parse(brut) as { uid?: unknown; email?: unknown };
    if (typeof memo.uid !== "string") return null;
    return { uid: memo.uid, email: typeof memo.email === "string" ? memo.email : "" };
  } catch {
    return null;
  }
}

export function SupprimerCompte() {
  const supabase = createClient();
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);
  // Réassurance contextuelle (audit critique) : même esprit que « Quitter le
  // foyer » (panneau-foyer.tsx) — dire précisément ce qui disparaît plutôt
  // qu'un « irréversible » générique. null = pas encore su (défaut prudent :
  // le message solo, qui décrit le pire cas).
  const [partage, setPartage] = useState<boolean | null>(null);
  // null = identité pas encore lue : on montre alors la voie mot de passe
  // (cas majoritaire, pas de décalage de mise en page).
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  // true = retour Google validé (même uid) : « SUPPRIMER » suffit.
  const [reauthGoogleOk, setReauthGoogleOk] = useState(false);
  const [redirectionGoogle, setRedirectionGoogle] = useState(false);
  // Email d'origine quand l'utilisateur est revenu avec un autre compte Google.
  const [autreCompte, setAutreCompte] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    chargerFoyer()
      .then((e) => actif && setPartage(e.membres > 1))
      .catch(() => {
        /* best-effort : le message solo (par défaut) reste affiché */
      });
    return () => {
      actif = false;
    };
  }, []);

  // Identité + éventuel retour de la ré-authentification Google. `setState`
  // dans la promesse (règle set-state-in-effect) ; le mémo n'est consommé que
  // si l'effet est encore actif, sinon le double montage StrictMode le volerait.
  useEffect(() => {
    let actif = true;
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!actif || !user) return;
        setUtilisateur({
          id: user.id,
          email: user.email ?? null,
          methode: methodeReauth(user.identities),
        });

        const params = new URLSearchParams(window.location.search);
        const retourGoogle = params.get(PARAM_RETOUR) === VALEUR_RETOUR;
        const cleErreur = params.get(PARAM_ERREUR_OAUTH);
        if (!retourGoogle && cleErreur === null) return;
        params.delete(PARAM_RETOUR);
        params.delete(PARAM_ERREUR_OAUTH);
        const reste = params.toString();
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + (reste ? `?${reste}` : "")
        );

        const memo = consommerMemoReauth();
        // Annulation ou échec chez Google (le callback renvoie ici avec
        // `erreur_oauth`, avec ou sans `suppression=confirmer`) : la
        // ré-authentification n'a pas eu lieu, on redemande.
        if (cleErreur !== null) {
          setErreur(
            cleErreur === "annule" ? MESSAGE_REAUTH_ANNULEE : messageErreurOAuth("echec")
          );
          return;
        }
        if (memo === null) return; // pas de preuve du retour : on redemande
        if (memo.uid === user.id) {
          setReauthGoogleOk(true);
          return;
        }
        // Autre compte Google : on ne supprime rien, on déconnecte.
        setAutreCompte(memo.email);
        reinitialiserCacheFoyer();
        supabase.auth.signOut({ scope: "local" }).catch((e) => {
          console.error("Suppression : déconnexion après mauvais compte Google échouée.", e);
        });
      })
      .catch((e) => {
        // Repli sur la voie mot de passe : l'échec de lecture ne bloque pas la section.
        console.error("Suppression : lecture de l'utilisateur impossible.", e);
      });
    return () => {
      actif = false;
    };
    // `supabase` est recréé à chaque rendu : l'effet ne tourne qu'au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retour arrière depuis Google (bfcache iOS/Safari) : la page est restaurée
  // telle quelle, bouton encore en chargement — on le réarme (jumeau de
  // `connexion-google.tsx`).
  useEffect(() => {
    function surAffichage(evenement: PageTransitionEvent) {
      if (evenement.persisted) setRedirectionGoogle(false);
    }
    window.addEventListener("pageshow", surAffichage);
    return () => window.removeEventListener("pageshow", surAffichage);
  }, []);

  const voieGoogle = utilisateur?.methode === "google";
  const confirmationValide = confirmation === MOT_CONFIRMATION;

  async function confirmerAvecGoogle(): Promise<void> {
    if (!utilisateur) return;
    setErreur(null);
    setRedirectionGoogle(true);
    try {
      sessionStorage.setItem(
        CLE_REAUTH,
        JSON.stringify({ uid: utilisateur.id, email: utilisateur.email ?? "" })
      );
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: urlRetourOAuth(window.location.origin, CHEMIN_RETOUR),
          // select_account : laisse choisir le compte ; login_hint : présélectionne le bon.
          queryParams: {
            prompt: "select_account",
            ...(utilisateur.email ? { login_hint: utilisateur.email } : {}),
          },
        },
      });
      if (error) throw error;
      // Succès : le navigateur part vers Google, le bouton reste en chargement.
    } catch (e) {
      console.error("Suppression : démarrage de la ré-authentification Google échoué.", e);
      try {
        sessionStorage.removeItem(CLE_REAUTH);
      } catch {
        /* stockage indisponible : rien à nettoyer */
      }
      setErreur("La confirmation avec Google a échoué. Réessaie dans un instant.");
      setRedirectionGoogle(false);
    }
  }

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);
    if (!confirmationValide) return;
    if (voieGoogle && !reauthGoogleOk) return;

    setSuppression(true);
    try {
      // Voie Google : la ré-authentification vient d'avoir lieu (retour OAuth) ;
      // le serveur en vérifie la fraîcheur (RG-93).
      if (!reauthGoogleOk) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.email) {
          setErreur("Session expirée. Reconnecte-toi pour supprimer ton compte.");
          return;
        }

        const { error: erreurAuth } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: motDePasse,
        });
        if (erreurAuth) {
          setErreur("Mot de passe incorrect.");
          return;
        }
      }

      const reponse = await fetch("/api/compte/supprimer", { method: "POST" });
      if (!reponse.ok) {
        const corps = await reponse.json().catch(() => null);
        setErreur(corps?.error ?? "Suppression impossible. Réessaie dans quelques instants.");
        // Confirmation périmée (RG-93) : on redemande Google plutôt que de laisser
        // l'utilisateur retenter avec un formulaire qui échouera encore.
        if (reponse.status === 403 && voieGoogle) setReauthGoogleOk(false);
        return;
      }

      reinitialiserCacheFoyer();
      await supabase.auth.signOut({ scope: "local" });
      window.location.assign("/compte-supprime");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setSuppression(false);
    }
  }

  const blocErreur =
    erreur !== null ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {erreur}
      </p>
    ) : null;

  return (
    <section aria-labelledby="section-zone-dangereuse">
      <h2 id="section-zone-dangereuse" className="mb-4 text-lg font-semibold text-brand-900">
        Zone dangereuse
      </h2>
      <div className="flex max-w-sm flex-col gap-4">
        <p className="text-sm text-brand-700/85">
          {partage
            ? "Cette action supprime ton compte et ton profil. Tes recettes restent dans le foyer (les autres membres les conservent), mais ne te seront plus attribuées. Ton planning et ta liste de courses personnels disparaissent. Irréversible."
            : "Cette action supprime définitivement ton compte, ton foyer, tes recettes, ton planning et ta liste de courses. Irréversible."}
        </p>

        {autreCompte !== null ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {`Tu t’es connecté avec un autre compte Google. Reconnecte-toi avec ${autreCompte} pour supprimer ton compte.`}
          </p>
        ) : voieGoogle && !reauthGoogleOk ? (
          <>
            <p className="text-sm text-brand-700/85">
              Pour supprimer ton compte, confirme d’abord ton identité avec Google.
            </p>
            {blocErreur}
            <button
              type="button"
              onClick={confirmerAvecGoogle}
              disabled={redirectionGoogle}
              aria-busy={redirectionGoogle}
              className={`${CLASSES_BOUTON_GOOGLE} self-start px-5 py-2.5`}
            >
              {redirectionGoogle ? <SpinnerGoogle /> : <LogoGoogle />}
              Confirmer avec Google
            </button>
          </>
        ) : (
          <form onSubmit={soumettre} className="flex flex-col gap-4" noValidate>
            {!voieGoogle && (
              <div className="flex flex-col gap-1">
                <label htmlFor="suppr-mdp" className="text-sm font-medium text-brand-900">
                  Mot de passe
                </label>
                <input
                  id="suppr-mdp"
                  type="password"
                  autoComplete="current-password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  required
                  className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="suppr-confirmation" className="text-sm font-medium text-brand-900">
                Tape SUPPRIMER pour confirmer
              </label>
              <input
                id="suppr-confirmation"
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
                className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
              />
            </div>

            {blocErreur}

            <button
              type="submit"
              disabled={!confirmationValide || suppression}
              aria-busy={suppression}
              className="self-start rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {suppression ? "Suppression…" : "Supprimer mon compte"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
