// Chemin de retour après connexion (#305, RG-72) : le proxy envoie un visiteur
// non connecté de /oauth/consent vers /login?suivant=<chemin>, et le formulaire
// d'auth y revient après succès. Seul un chemin RELATIF à l'app est accepté
// (anti open-redirect) : sinon, retour au planning.
export function cheminDeRetour(brut: string | null): string {
  if (!brut || !brut.startsWith("/") || brut.startsWith("//") || brut.includes("\\")) {
    return "/planning"
  }
  return brut
}
