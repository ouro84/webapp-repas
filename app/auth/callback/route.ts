// Callback OAuth Google (US-57) : Google → Supabase → ici avec
// `?code=<pkce>&suivant=<chemin>` (ou `?error=…`). On échange le code contre
// une session à cookies, on horodate les CGU si absentes (RG-92), puis on
// redirige. L'URL finale ne contient jamais le `code`.
//
// En erreur (annulation chez Google, échec d'échange, exception), le contexte
// n'est jamais perdu :
//  - session déjà ouverte (ré-authentification depuis /profil, D10) et
//    `suivant` valide → retour sur `suivant` avec `erreur_oauth=<clé>`, que la
//    page d'origine affiche ;
//  - sinon → `/login?erreur_oauth=<clé>` avec `suivant` s'il est valide, pour
//    qu'un nouvel essai revienne au même endroit (ex. consentement MCP).
// Un connecté ne doit pas être renvoyé sur `/login?suivant=…` : le proxy le
// redirigerait aussitôt vers `suivant` sans le message, et une ré-authentification
// annulée afficherait le formulaire de suppression comme si elle avait réussi.
//
// /auth/* est déjà exempté de la garde d'onboarding par proxy.ts : une
// première connexion Google passe ici avant /bienvenue.

import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { erreurOAuthDepuisCallback, type ErreurOAuth } from "@/lib/auth-google"
import { horodaterCguSiAbsentes } from "@/lib/cgu-oauth"
import { cheminDeRetour } from "@/lib/redirection"

type ClientServeur = Awaited<ReturnType<typeof createClient>>

/** `suivant` s'il survit tel quel à `cheminDeRetour` (anti open-redirect), sinon `null`. */
function suivantValide(brut: string | null): string | null {
  return brut !== null && cheminDeRetour(brut) === brut ? brut : null
}

async function aUneSession(supabase: ClientServeur): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user !== null
  } catch (erreur) {
    console.error("Callback OAuth : lecture de la session existante impossible.", erreur)
    return false
  }
}

async function redirigerEnErreur(
  request: NextRequest,
  supabase: ClientServeur,
  erreur: ErreurOAuth
) {
  const suivant = suivantValide(request.nextUrl.searchParams.get("suivant"))

  if (suivant !== null && (await aUneSession(supabase))) {
    const retour = new URL(suivant, request.url)
    retour.searchParams.set("erreur_oauth", erreur)
    return NextResponse.redirect(retour)
  }

  const login = new URL("/login", request.url)
  login.searchParams.set("erreur_oauth", erreur)
  if (suivant !== null) login.searchParams.set("suivant", suivant)
  return NextResponse.redirect(login)
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const supabase = await createClient()

  const erreur = erreurOAuthDepuisCallback(params)
  if (erreur) return redirigerEnErreur(request, supabase, erreur)

  let userId: string
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.get("code")!)
    if (error || !data.user) {
      console.error("Échange du code OAuth Google échoué.", error)
      return redirigerEnErreur(request, supabase, "echec")
    }
    userId = data.user.id
  } catch (exception) {
    console.error("Échange du code OAuth Google échoué (exception).", exception)
    return redirigerEnErreur(request, supabase, "echec")
  }

  await horodaterCguSiAbsentes(supabase, userId)

  // cheminDeRetour : chemins relatifs à l'app seulement (anti open-redirect).
  return NextResponse.redirect(new URL(cheminDeRetour(params.get("suivant")), request.url))
}
