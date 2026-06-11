import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ApercuPlanning } from "@/components/ui/apercu-planning";

export default function Accueil() {
  return (
    <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center text-center">
        <Logo className="mb-5 size-24 text-brand-600" />
        <h1 className="font-display text-3xl font-semibold text-brand-900">
          On mange quoi&nbsp;?
        </h1>
        <p className="mt-3 max-w-sm text-brand-700/85">
          La question du soir a enfin sa réponse
        </p>
      </div>

      {/* Aperçu décoratif (#68) : montre la promesse produit (un planning de la
          semaine) entre la tagline et le CTA — promesse → aperçu → action. */}
      <ApercuPlanning />

      <Link
        href="/planning"
        className="rounded-full bg-primary px-8 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
      >
        Générer mon planning
      </Link>
    </main>
  );
}
