import eslint from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [".agents/**", ".git/**", "node_modules/**", "coverage/**", "dist/**", "build/**"],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
