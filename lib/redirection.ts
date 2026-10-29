// Chemin de retour après connexion (#305, RG-72) : le proxy envoie un visiteur
// non connecté de /oauth/consent vers /login?suivant=<chemin>, et le formulaire
// d'auth y revient après succès. Seul un chemin RELATIF à l'app est accepté
// (anti open-redirect) : sinon, retour au planning.
//
// On résout le chemin comme le fera le navigateur (analyseur d'URL WHATWG) et
// on exige qu'il reste sur la même origine : l'analyseur supprime tabulations
// et retours à la ligne, si bien que « /\t/evil.com » devient « //evil.com ».
const ORIGINE_SONDE = "https://omq.invalid"

export function cheminDeRetour(brut: string | null): string {
  if (!brut || !brut.startsWith("/") || /[\x00-\x1F\x7F\\]/.test(brut)) return "/planning"
  try {
    const url = new URL(brut, ORIGINE_SONDE)
    if (url.origin !== ORIGINE_SONDE) return "/planning"
    return url.pathname + url.search + url.hash
  } catch {
    return "/planning"
  }
}

/** Vrai pour l'espace OAuth (`/oauth`, `/oauth/…`), faux pour `/oauthxyz`. */
export function estCheminOAuth(pathname: string): boolean {
  return pathname === "/oauth" || pathname.startsWith("/oauth/")
}
