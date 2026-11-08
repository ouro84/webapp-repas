// Écran « Chargement… » d'une page chargée côté client (RG-09).
//
// Deux contraintes de stabilité visuelle (CLS), mesurées sur /courses (0,82 en
// desktop) et /ce-soir (0,22) :
// - même boîte que le `<main>` de l'état chargé (`largeur`) : React réutilise
//   l'élément, et un `<main>` qui passe de pleine largeur à `max-w-2xl` décale
//   toute la page ;
// - `min-h-dvh` : le pied de page (et le bandeau cookies) reste sous la ligne
//   de flottaison, au lieu d'être visible puis repoussé par le contenu chargé.
export function EcranChargement({ largeur = "etroite" }: { largeur?: "etroite" | "pleine" }) {
  const boite = largeur === "etroite" ? "mx-auto w-full max-w-2xl" : "w-full"
  return (
    <main
      id="contenu"
      className={`${boite} flex min-h-dvh flex-1 flex-col items-center justify-center p-4 md:p-8`}
    >
      {/* role="status" : annonce le chargement aux lecteurs d'écran */}
      <p role="status" className="animate-pulse text-lg text-brand-700/85">
        Chargement…
      </p>
    </main>
  )
}
