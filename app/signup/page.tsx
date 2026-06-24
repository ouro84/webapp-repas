"use client"

import { createClient } from "@/lib/supabase/client"
import { traduireErreurAuth } from "@/lib/messages-auth"
import { LONGUEUR_MIN_MDP } from "@/lib/auth-regles"
import { FormulaireAuth, LienPied } from "@/components/auth/formulaire-auth"

export default function SignupPage() {
  const supabase = createClient()

  // Renvoie un message d'erreur français actionnable (#58), ou null si succès.
  async function inscrire(
    email: string,
    password: string
  ): Promise<string | null> {
    const { error } = await supabase.auth.signUp({ email, password })
    // Contexte "signup" : neutralise le signal « compte déjà existant »
    // (anti-énumération de comptes, audit F-05).
    return error ? traduireErreurAuth(error, "signup") : null
  }

  return (
    <FormulaireAuth
      titre="Créer un compte"
      autocompletePassword="new-password"
      minLengthPassword={LONGUEUR_MIN_MDP}
      labelSoumettre="Créer mon compte"
      labelChargement="Création…"
      onSoumettre={inscrire}
      pied={
        <>
          Déjà un compte ? <LienPied href="/login">Se connecter</LienPied>
        </>
      }
    />
  )
}
