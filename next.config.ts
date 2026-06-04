import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise l'accès au serveur de dev depuis le réseau local (test mobile).
  // Next 16 bloque par défaut les requêtes cross-origin vers les ressources
  // de dev (_next/*) — sans cela, la navigation depuis un téléphone casse.
  // Sans effet en production.
  allowedDevOrigins: ["10.0.0.18"],
};

export default nextConfig;
