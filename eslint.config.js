import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", ".vercel/**", "apps-script/**", "sw.js"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser } },
    rules: { "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }] }
  },
  {
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } }
  }
];
