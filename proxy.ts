// Proxy (Next.js 16) — anciennement « middleware » (#12). Le fichier `proxy.ts`
// et la fonction exportée `proxy` remplacent la convention `middleware`/`middleware`
// dépréciée en Next 16. Gère le rafraîchissement de session Supabase et les
// redirections d'accès (routes protégées / routes d'auth).
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { estLienProfondCycle } from '@/lib/lien-cycle'
import { cheminDeRetour, estCheminOAuth } from '@/lib/redirection'

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

// Routes servies SANS session à cookies (#305) : le serveur MCP s'authentifie
// par jeton OAuth (Bearer) et la metadata RFC 9728 est publique (ce seul
// document : un futur fichier sous /.well-known/ reste soumis au proxy). Ni client
// Supabase à cookies, ni garde d'onboarding : appels de serveur à serveur.
export function sansSession(pathname: string): boolean {
  return (
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname.startsWith("/.well-known/oauth-protected-resource/")
  )
}

// Onboarding déjà terminé sur cet appareil : la valeur est le `sub` du compte,
// pour qu'un autre compte connecté dans le même navigateur soit relu en base.
// Pourquoi : la lecture de `profiles` coûtait un aller-retour réseau à CHAQUE
// requête (documents et préchargements de liens). `onboarding_complete` ne
// repasse jamais à faux ; un cookie forgé ne fait sauter que son propre tunnel.
export const COOKIE_ONBOARDE = "omq_onboarde"
const UN_AN = 60 * 60 * 24 * 365

export async function proxy(request: NextRequest) {
  if (sansSession(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

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

  // Rafraîchit la session si elle a expiré (getClaims passe par getSession),
  // puis vérifie la signature du JWT LOCALEMENT (clés ES256 publiques, JWKS en
  // cache 10 min au niveau du module) : pas d'aller-retour vers Supabase Auth,
  // contrairement à getUser. Un compte supprimé garde un JWT valide jusqu'à son
  // expiration (1 h) : le proxy ne fait que rediriger, la RLS reste l'arbitre.
  // Ne pas écrire de logique entre createServerClient et getClaims().
  // Encadré (#169) : si Supabase est indisponible, on dégrade en « non
  // connecté » plutôt que de laisser le proxy crasher (500 sur TOUTES les
  // routes filtrées, app entièrement inaccessible). Les routes protégées
  // redirigeront alors vers /login.
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    userId = data?.claims.sub ?? null
  } catch (erreur) {
    console.error("proxy : récupération de la session échouée.", erreur)
  }

  const pathname = request.nextUrl.pathname

  // Pages protégées : redirige vers /login si non connecté. /bienvenue (tunnel
  // d'onboarding #22 PR2) en fait partie — on ne s'onboarde pas déconnecté.
  // /oauth (#305, RG-72) : l'écran de consentement exige une session OMQ.
  const protectedRoutes = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/bienvenue", "/ce-soir", "/oauth"]
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && !userId) {
    const login = urlPreservantCode("/login", request)
    // Consentement OAuth (RG-72) et lien profond /planning?cycle= (#320, RG-87) :
    // on revient sur la demande après connexion (le formulaire d'auth lit
    // `suivant`, filtré par cheminDeRetour).
    if (estCheminOAuth(pathname) || estLienProfondCycle(pathname, request.nextUrl.searchParams)) {
      login.searchParams.set("suivant", pathname + request.nextUrl.search)
    }
    return NextResponse.redirect(login)
  }

  const authRoutes = ["/login", "/signup"]
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route))

  // Garde d'onboarding (#22 PR2) : tant que profiles.onboarding_complete est
  // faux, l'utilisateur connecté est renvoyé vers le tunnel /bienvenue ; une
  // fois terminé, il ne peut plus y revenir (ni rester sur les routes d'auth).
  // La base n'est lue que tant que le cookie `omq_onboarde` de ce compte est
  // absent. On EXEMPTE /api/*, /auth/* (déconnexion, reset mot de passe) et
  // /legal/* (#235 — CGU/confidentialité/mentions légales doivent rester
  // lisibles PENDANT le tunnel d'onboarding, où le lien de la case CGU du
  // signup peut être rouvert) : ni redirection ni requête, pour ne pas casser
  // ces flux ni les ralentir.
  if (
    userId &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/legal") &&
    !pathname.startsWith("/compte-supprime")
  ) {
    let onboarde = request.cookies.get(COOKIE_ONBOARDE)?.value === userId
    let poserCookie = false
    if (!onboarde) {
      // Fail-open sur erreur (profil illisible/transitoire OU Supabase
      // indisponible, #169) : on considère l'utilisateur onboardé pour ne
      // jamais le piéger dans une boucle ni crasher le proxy, sans poser le
      // cookie (la base sera relue à la requête suivante).
      onboarde = true
      try {
        const { data } = await supabase
          .from("profiles")
          .select("onboarding_complete")
          .eq("user_id", userId)
          .single()
        onboarde = data ? data.onboarding_complete : true
        poserCookie = data?.onboarding_complete === true
      } catch (erreur) {
        console.error("proxy : lecture de l'onboarding échouée (fail-open).", erreur)
      }
    }
    // Pose le cookie sur la réponse renvoyée, redirection comprise.
    const avecCookie = (reponse: NextResponse): NextResponse => {
      if (poserCookie) {
        reponse.cookies.set(COOKIE_ONBOARDE, userId, {
          httpOnly: true,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
          path: "/",
          maxAge: UN_AN,
        })
      }
      return reponse
    }

    if (!onboarde && pathname !== "/bienvenue") {
      return NextResponse.redirect(urlPreservantCode("/bienvenue", request))
    }
    // Accueil d'un connecté (#335) : « / » est la vitrine publique (hero +
    // « Générer mon planning »), sans objet une fois le compte ouvert. Logo,
    // lien partagé ou favori ouvrent directement le prochain repas, quelle que
    // soit l'heure (/ce-soir s'adapte : « Ce midi », repas du lendemain…).
    // urlPreservantCode garde un éventuel lien d'invitation (?code=).
    if (onboarde && pathname === "/") {
      return avecCookie(NextResponse.redirect(urlPreservantCode("/ce-soir", request)))
    }
    if (onboarde && (pathname === "/bienvenue" || isAuthRoute)) {
      // Déjà connecté sur /login?suivant=… (#305) : retour à la demande OAuth
      // ou au lien profond /planning?cycle= (#320, RG-87).
      const suivant = isAuthRoute ? request.nextUrl.searchParams.get("suivant") : null
      return avecCookie(NextResponse.redirect(urlPreservantCode(cheminDeRetour(suivant), request)))
    }
    return avecCookie(supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclut les fichiers statiques, les routes internes Next.js et les
    // fichiers publics sans session (manifest PWA, robots) : chaque passage du
    // proxy coûte une invocation de fonction.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
