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
    // Vendored third-party QR encoder (CommonJS port, not app source).
    // It is excluded from the project lint scope instead of being rewritten,
    // because a rewrite would modify a verified third-party artifact.
    "lib/qr/**",
  ]),
]);

export default eslintConfig;
