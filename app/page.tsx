import Link from "next/link";

export default function Accueil() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Repas de la semaine
        </h1>
        <p className="mt-2 text-gray-500">
          Génère ton planning et ta liste de courses en un clic
        </p>
      </div>

      <Link
        href="/planning"
        className="rounded-full bg-black px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-gray-800"
      >
        Générer mon planning
      </Link>
    </main>
  );
}
