// Proxy (Next.js 16) — anciennement « middleware » (#12). Le fichier `proxy.ts`
// et la fonction exportée `proxy` remplacent la convention `middleware`/`middleware`
// dépréciée en Next 16. Gère le rafraîchissement de session Supabase et les
// redirections d'accès (routes protégées / routes d'auth).
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Construit une URL de redirection en PRÉSERVANT le code d'invitation présent
// dans l'URL entrante (#22 PR3, deep-link) : sans ça, un membre déjà connecté
// qui clique un lien `/signup?code=…` serait redirigé vers /planning en perdant
// le code. Côté client, un composant le capte ensuite en sessionStorage.
function urlPreservantCode(chemin: string, request: NextRequest): URL {
  const url = new URL(chemin, request.url)
  const code =
    request.nextUrl.searchParams.get("code") ??
    request.nextUrl.searchParams.get("rejoindre")
  if (code) url.searchParams.set("code", code)
  return url
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Rafraîchit la session si elle a expiré
  // Ne pas écrire de logique entre createServerClient et getUser()
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Pages protégées : redirige vers /login si non connecté. /bienvenue (tunnel
  // d'onboarding #22 PR2) en fait partie — on ne s'onboarde pas déconnecté.
  const protectedRoutes = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/bienvenue"]
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(urlPreservantCode("/login", request))
  }

  const authRoutes = ["/login", "/signup"]
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route))

  // Garde d'onboarding (#22 PR2) : tant que profiles.onboarding_complete est
  // faux, l'utilisateur connecté est renvoyé vers le tunnel /bienvenue ; une
  // fois terminé, il ne peut plus y revenir (ni rester sur les routes d'auth).
  // Une requête par navigation connectée — choix assumé (usage perso, cf. plan
  // #22). On EXEMPTE /api/* et /auth/* (déconnexion, reset mot de passe) : ni
  // redirection ni requête, pour ne pas casser ces flux ni les ralentir.
  if (user && !pathname.startsWith("/api") && !pathname.startsWith("/auth")) {
    const { data } = await supabase
      .from("profiles")
      .select("onboarding_complete")
      .eq("user_id", user.id)
      .single()
    // Fail-open sur erreur (profil illisible/transitoire) : on considère
    // l'utilisateur onboardé pour ne jamais le piéger dans une boucle.
    const onboarde = data ? data.onboarding_complete : true

    if (!onboarde && pathname !== "/bienvenue") {
      return NextResponse.redirect(urlPreservantCode("/bienvenue", request))
    }
    if (onboarde && (pathname === "/bienvenue" || isAuthRoute)) {
      return NextResponse.redirect(urlPreservantCode("/planning", request))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclut les fichiers statiques et les routes internes Next.js
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
