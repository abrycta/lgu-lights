import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Same base as Typhoon Replay's web config (typescript-eslint recommended, React hooks, react-refresh),
// without its layer-boundary rules, which describe Typhoon's folder layout.
export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "public", "src/whatif/pkg"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,ts}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
