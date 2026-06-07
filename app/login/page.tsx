"use client"

import { createClient } from "@/lib/supabase/client"
import { traduireErreurAuth } from "@/lib/messages-auth"
import { FormulaireAuth, LienPied } from "@/components/auth/formulaire-auth"

export default function LoginPage() {
  const supabase = createClient()

  // Renvoie un message d'erreur français actionnable (#58), ou null si succès.
  async function connecter(
    email: string,
    password: string
  ): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? traduireErreurAuth(error) : null
  }

  return (
    <FormulaireAuth
      titre="Se connecter"
      autocompletePassword="current-password"
      labelSoumettre="Se connecter"
      labelChargement="Connexion…"
      onSoumettre={connecter}
      pied={
        <>
          Pas encore de compte ? <LienPied href="/signup">S&apos;inscrire</LienPied>
        </>
      }
    />
  )
}
