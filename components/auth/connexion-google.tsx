"use client"

// Bouton « Continuer avec Google » (US-57) — partagé par /login et /signup.
//
// Rend, dans l'ordre : l'erreur éventuelle (retour du callback OAuth ou échec
// du clic), le bouton (ou, en PWA iOS, l'indice Safari), la mention CGU
// (RG-92 : l'acceptation est horodatée par le callback), puis un séparateur
// « ou » avant le formulaire email.
//
// Charte « Sign in with Google » : logo G multicolore, libellé en Roboto Medium,
// fond / bordure / texte du thème clair ou sombre (tokens --color-google-*,
// classes communes dans `logo-google.tsx`).

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Roboto } from "next/font/google"
import { createClient } from "@/lib/supabase/client"
import { estPwaIos, messageErreurOAuth, urlRetourOAuth } from "@/lib/auth-google"
import { CLASSES_BOUTON_GOOGLE, LogoGoogle, SpinnerGoogle } from "@/components/auth/logo-google"

// Police propre au bouton (charte Google) : auto-hébergée par next/font, donc
// sans changement de CSP, et sans toucher aux polices globales du layout.
const roboto = Roboto({ weight: "500", subsets: ["latin"] })

// Détection de la PWA iOS : store `useSyncExternalStore` sans abonnement (le
// mode standalone ne change pas en cours de session). Snapshot serveur `null` :
// tant qu'il vaut `null` on rend le bouton, sans scintillement ailleurs qu'en
// PWA iOS.
const sAbonnerSansEvenement = () => () => {}
const lireModeStandalone = (): boolean => estPwaIos(navigator as { standalone?: unknown })
const lireModeStandaloneServeur = (): boolean | null => null

// Clé `?erreur_oauth=` lue SANS `useSearchParams` : ce hook force le repli
// `<Suspense>` dans le HTML prérendu, donc le bouton n'apparaîtrait qu'après
// l'hydratation et décalerait le formulaire déjà affiché. Même mécanisme que
// la détection iOS : snapshot serveur `null` (prérendu = bouton, sans erreur),
// snapshot client = la chaîne de requête (primitive, donc stable), relue à
// chaque rendu (d'où la disparition du message après le `replaceState` du clic).
const sAbonnerSansEvenementUrl = () => () => {}
const lireErreurOAuth = (): string | null =>
  new URLSearchParams(window.location.search).get("erreur_oauth")
const lireErreurOAuthServeur = (): string | null => null

export function ConnexionGoogle() {
  const cleErreur = useSyncExternalStore<string | null>(
    sAbonnerSansEvenementUrl,
    lireErreurOAuth,
    lireErreurOAuthServeur
  )
  const standalone = useSyncExternalStore<boolean | null>(
    sAbonnerSansEvenement,
    lireModeStandalone,
    lireModeStandaloneServeur
  )
  const [chargement, setChargement] = useState(false)
  const [erreurClic, setErreurClic] = useState<string | null>(null)
  const boutonRef = useRef<HTMLButtonElement>(null)
  // Après un échec, le bouton redevient actif : on lui rend le focus, qu'un
  // navigateur retire à un bouton désactivé (il retomberait sur <body>).
  const focusApresEchec = useRef(false)

  useEffect(() => {
    if (chargement || !focusApresEchec.current) return
    focusApresEchec.current = false
    boutonRef.current?.focus()
  }, [chargement])

  // Retour arrière depuis Google (bfcache iOS/Safari) : la page est restaurée
  // telle quelle, bouton encore en chargement — on le réarme.
  useEffect(() => {
    function surAffichage(evenement: PageTransitionEvent) {
      if (evenement.persisted) setChargement(false)
    }
    window.addEventListener("pageshow", surAffichage)
    return () => window.removeEventListener("pageshow", surAffichage)
  }, [])

  const message = erreurClic ?? messageErreurOAuth(cleErreur)

  async function continuer() {
    // Nouvel essai : l'ancien message `?erreur_oauth=` disparaît ; `suivant`
    // reste dans l'URL (et part dans le redirectTo).
    const params = new URLSearchParams(window.location.search)
    if (params.has("erreur_oauth")) {
      params.delete("erreur_oauth")
      const reste = params.toString()
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (reste ? `?${reste}` : "") + window.location.hash
      )
    }
    setChargement(true)
    setErreurClic(null)
    try {
      const redirectTo = urlRetourOAuth(window.location.origin, params.get("suivant"))
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      })
      if (error) throw error
      // Succès : le navigateur part vers Google, on laisse le bouton en chargement.
    } catch (erreur) {
      console.error("Connexion Google : démarrage du parcours OAuth échoué.", erreur)
      setErreurClic(messageErreurOAuth("echec"))
      focusApresEchec.current = true
      setChargement(false)
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      {message !== null && (
        // role="alert" : annoncé immédiatement aux lecteurs d'écran
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {message}
        </p>
      )}

      {standalone === true ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Pour te connecter avec Google, ouvre OMQ dans Safari
        </p>
      ) : (
        <button
          ref={boutonRef}
          type="button"
          onClick={continuer}
          disabled={chargement}
          aria-busy={chargement}
          className={`${roboto.className} ${CLASSES_BOUTON_GOOGLE} px-6 py-3`}
        >
          {chargement ? <SpinnerGoogle /> : <LogoGoogle />}
          Continuer avec Google
        </button>
      )}

      <p className="text-center text-xs text-brand-700/85">
        En continuant, tu acceptes les{" "}
        <Link
          href="/legal/cgu"
          target="_blank"
          className="underline underline-offset-2 hover:text-brand-900"
        >
          CGU
        </Link>{" "}
        et la{" "}
        <Link
          href="/legal/confidentialite"
          target="_blank"
          className="underline underline-offset-2 hover:text-brand-900"
        >
          politique de confidentialité
        </Link>
        .
      </p>

      <div className="flex items-center gap-3 text-sm text-brand-700/85" aria-hidden="true">
        <span className="h-px flex-1 bg-brand-200" />
        ou
        <span className="h-px flex-1 bg-brand-200" />
      </div>
    </div>
  )
}
