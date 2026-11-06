import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dossier local d'understand-anything, hors de Git.
    ".understand-anything/**",
    // Exécuteurs hors de l'app (NAS), avec leur propre outillage (#308).
    "integrations/**",
  ]),
  // #363 : seul un geste de l'utilisateur pousse le planning, via les écritures
  // d'intention de lib/stockage.ts. Une page qui écrirait `storePlanning`
  // directement mettrait l'écran à jour sans jamais pousser (édition perdue).
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='storePlanning'][property.name=/^(ecrire|effacer)$/]",
          message:
            "Écrire le planning depuis une page passe par sauvegarderRemplacementSlot / sauvegarderPlanningComplet / restaurerSnapshotAnnulation (lib/stockage.ts) : une écriture directe de storePlanning ne pousse jamais (#363).",
        },
      ],
    },
  },
]);

export default eslintConfig;
