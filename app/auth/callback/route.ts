// Callback OAuth Google (US-57, RG-93) : Google → Supabase → ici avec
// `?code=<pkce>&suivant=<chemin>` (ou `?error=…`). On échange le code contre
// une session à cookies, on horodate les CGU si absentes (RG-92), puis on
// redirige. L'URL finale ne contient jamais le `code`.
//
// /auth/* est déjà exempté de la garde d'onboarding par proxy.ts : une
// première connexion Google passe ici avant /bienvenue.

import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { erreurOAuthDepuisCallback, type ErreurOAuth } from "@/lib/auth-google"
import { horodaterCguSiAbsentes } from "@/lib/cgu-oauth"
import { cheminDeRetour } from "@/lib/redirection"

function versLoginEnErreur(request: NextRequest, erreur: ErreurOAuth) {
  return NextResponse.redirect(new URL(`/login?erreur_oauth=${erreur}`, request.url))
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  const erreur = erreurOAuthDepuisCallback(params)
  if (erreur) return versLoginEnErreur(request, erreur)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(params.get("code")!)
  if (error || !data.user) {
    console.error("Échange du code OAuth Google échoué.", error)
    return versLoginEnErreur(request, "echec")
  }

  await horodaterCguSiAbsentes(supabase, data.user.id)

  // cheminDeRetour : chemins relatifs à l'app seulement (anti open-redirect).
  return NextResponse.redirect(new URL(cheminDeRetour(params.get("suivant")), request.url))
}
