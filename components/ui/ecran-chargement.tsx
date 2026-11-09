// Coque « Chargement… » d'une page chargée côté client (RG-09, #400).
//
// Deux contraintes de stabilité visuelle (CLS), mesurées sur /courses (0,82 en
// desktop) et /ce-soir (0,22) :
// - même boîte que le `<main>` de l'état chargé (`largeur`, `espacement`) :
//   React réutilise l'élément, et un `<main>` qui passe de pleine largeur à
//   `max-w-2xl` décale toute la page ;
// - `min-h-dvh` : le pied de page (et le bandeau cookies) reste sous la ligne
//   de flottaison, au lieu d'être visible puis repoussé par le contenu chargé.
//
// Avec `children` : le squelette de la page (blocs `Squelette`), sans centrage,
// sous une `ZoneChargement`. Sans `children` : texte « Chargement… » visible
// centré. PROVISOIRE : retiré quand chaque page aura son squelette (#400).
import type { ReactNode } from "react"

import { ZoneChargement } from "./squelette"

export function EcranChargement({
  largeur = "etroite",
  espacement = "p-4 md:p-8",
  children,
}: {
  largeur?: "etroite" | "pleine"
  espacement?: string
  children?: ReactNode
}) {
  const boite = largeur === "etroite" ? "mx-auto w-full max-w-2xl" : "w-full"
  const base = `${boite} flex min-h-dvh flex-1 flex-col ${espacement}`
  if (children === undefined) {
    return (
      <main id="contenu" className={`${base} items-center justify-center`}>
        {/* role="status" : annonce le chargement aux lecteurs d'écran */}
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    )
  }
  return (
    <main id="contenu" className={base}>
      <ZoneChargement className="contents">{children}</ZoneChargement>
    </main>
  )
}
