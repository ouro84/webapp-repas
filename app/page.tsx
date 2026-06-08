import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function Accueil() {
  return (
    <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
      <div className="flex flex-col items-center text-center">
        <Logo className="mb-5 size-24 text-brand-600" />
        <h1 className="text-3xl font-bold text-brand-900">
          On mange quoi&nbsp;?
        </h1>
        <p className="mt-3 max-w-sm text-brand-700/85">
          La question du soir a enfin sa réponse
        </p>
      </div>

      <Link
        href="/planning"
        className="rounded-full bg-brand-600 px-8 py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Générer mon planning
      </Link>
    </main>
  );
}
