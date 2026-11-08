"use client"

// Bouton « Continuer avec Google » (US-57) — partagé par /login et /signup.
//
// Rend, dans l'ordre : l'erreur éventuelle (retour du callback OAuth ou échec
// du clic), le bouton (ou, en PWA iOS, l'indice Safari), la mention CGU
// (RG-92 : l'acceptation est horodatée par le callback), puis un séparateur
// « ou » avant le formulaire email.
//
// Charte « Sign in with Google » : logo G multicolore, libellé en Roboto Medium,
// fond / bordure / texte du thème clair ou sombre (tokens --color-google-*).

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Roboto } from "next/font/google"
import { createClient } from "@/lib/supabase/client"
import { estPwaIos, messageErreurOAuth, urlRetourOAuth } from "@/lib/auth-google"

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
// snapshot client = la chaîne de requête (primitive, donc stable).
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
    setChargement(true)
    setErreurClic(null)
    try {
      const redirectTo = urlRetourOAuth(
        window.location.origin,
        new URLSearchParams(window.location.search).get("suivant")
      )
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      })
      if (error) throw error
      // Succès : le navigateur part vers Google, on laisse le bouton en chargement.
    } catch (erreur) {
      console.error("Connexion Google : démarrage du parcours OAuth échoué.", erreur)
      setErreurClic(messageErreurOAuth("echec"))
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
          type="button"
          onClick={continuer}
          disabled={chargement}
          aria-busy={chargement}
          className={`${roboto.className} flex items-center justify-center gap-3 rounded-full border border-google-bordure bg-google-fond px-6 py-3 text-sm font-medium text-google-texte transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60`}
        >
          {chargement ? <Spinner /> : <LogoGoogle />}
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

// Logo « G » officiel de Google (4 tracés aux couleurs de la charte) — SVG
// inline, masqué aux lecteurs d'écran (le libellé du bouton porte le nom).
function LogoGoogle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

// Spinner du bouton en chargement (aria-busy porte déjà l'information).
function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 animate-spin" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
