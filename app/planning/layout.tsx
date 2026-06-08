import type { Metadata } from "next";

// Titre distinct par route (WCAG 2.4.2) — la page est un Client Component
// et ne peut pas exporter metadata elle-même, d'où ce layout serveur minimal.
export const metadata: Metadata = {
  title: "Planning — On mange quoi ?",
};

export default function PlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
