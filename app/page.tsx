import Link from "next/link";

export default function Accueil() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
      <div className="text-center">
        <div className="mb-4 text-5xl" aria-hidden="true">🥗</div>
        <h1 className="text-3xl font-bold text-brand-900">
          Repas de la semaine
        </h1>
        <p className="mt-3 max-w-sm text-brand-700/70">
          Génère ton planning et ta liste de courses en un clic
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
