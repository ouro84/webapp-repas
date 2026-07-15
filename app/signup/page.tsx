"use client"

import { createClient } from "@/lib/supabase/client"
import { traduireErreurAuth } from "@/lib/messages-auth"
import { LONGUEUR_MIN_MDP } from "@/lib/auth-regles"
import { CGU_VERSION_ACTUELLE } from "@/lib/legal"
import { FormulaireAuth, LienPied } from "@/components/auth/formulaire-auth"

export default function SignupPage() {
  const supabase = createClient()

  // Renvoie un message d'erreur français actionnable (#58), ou null si succès.
  async function inscrire(
    email: string,
    password: string
  ): Promise<string | null> {
    const { data, error } = await supabase.auth.signUp({ email, password })
    // Contexte "signup" : neutralise le signal « compte déjà existant »
    // (anti-énumération de comptes, audit F-05).
    if (error) return traduireErreurAuth(error, "signup")

    // Horodatage de l'acceptation des CGU (#235, RG épopée RGPD) — la case est
    // déjà obligatoire côté FormulaireAuth (cguRequise), donc atteindre ce
    // point signifie qu'elle a été cochée. Best-effort : un échec ne doit pas
    // faire échouer l'inscription déjà réussie côté auth (compte créé quoi
    // qu'il arrive) — l'absence de cgu_version resterait visible côté admin.
    if (data.user) {
      const { error: erreurProfil } = await supabase
        .from("profiles")
        .update({
          cgu_version: CGU_VERSION_ACTUELLE,
          cgu_acceptees_le: new Date().toISOString(),
        })
        .eq("user_id", data.user.id)
      if (erreurProfil) {
        console.error("Horodatage de l'acceptation des CGU échoué.", erreurProfil)
      }
    }
    return null
  }

  return (
    <FormulaireAuth
      titre="Créer un compte"
      autocompletePassword="new-password"
      minLengthPassword={LONGUEUR_MIN_MDP}
      labelSoumettre="Créer mon compte"
      labelChargement="Création…"
      onSoumettre={inscrire}
      cguRequise
      pied={
        <>
          Déjà un compte ? <LienPied href="/login">Se connecter</LienPied>
        </>
      }
    />
  )
}
