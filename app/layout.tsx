import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { NavBar } from "@/components/ui/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Repas de la semaine",
  description: "Génère ton planning de repas hebdomadaire et ta liste de courses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang="fr" corrigé : important pour les lecteurs d'écran et le SEO
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        body en flex flex-col h-full : la NavBar prend sa hauteur naturelle,
        le contenu (children) remplit le reste via flex-1 sur chaque page.
      */}
      <body className="flex min-h-full flex-col">
        <NavBar />
        {/*
          Notifications toast (sonner) — aux couleurs du design system via les
          variables CSS émises par le @theme de globals.css.
        */}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#ffffff",
              border: "1px solid var(--color-brand-100)",
              color: "var(--color-brand-900)",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
