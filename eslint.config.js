const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

// Modules provided by the Lumine/Electron runtime rather than this package's own
// manifest, so they aren't resolvable by eslint-plugin-n.
const runtimeModules = ["atom", "electron", "@electron/remote"];

module.exports = [
  js.configs.recommended,
  n.configs["flat/recommended-script"],
  {
    settings: {
      // This runs inside the editor's bundled Node 24 runtime, so lint
      // syntax/builtins against that rather than the package's `engines`.
      n: { version: ">=24.0.0" },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.browser,
        ...globals.node,
        atom: "writable",
      },
    },
    rules: {
      "no-constant-condition": "off",
      "no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "n/no-missing-require": ["error", { allowModules: runtimeModules }],
      "n/no-unpublished-require": ["error", { allowModules: runtimeModules }],
      "n/no-extraneous-require": ["error", { allowModules: runtimeModules }],
      // `localStorage`/`navigator` here are Chromium (renderer) globals, not
      // Node's newer experimental builtins of the same name.
      "n/no-unsupported-features/node-builtins": [
        "error",
        { ignores: ["localStorage", "navigator"] },
      ],
    },
  },
  {
    // The pty worker is a standalone `ELECTRON_RUN_AS_NODE` entry point, so
    // `process.exit` is legitimate here.
    files: ["lib/pty-worker.js"],
    rules: { "n/no-process-exit": "off" },
  },
  {
    // Jasmine specs run in the editor's test runner; they load devDependencies
    // and fixtures by paths the resolver can't follow.
    files: ["spec/**", "**/*-spec.js"],
    languageOptions: {
      globals: { ...globals.jasmine },
    },
    rules: {
      "n/no-missing-require": "off",
      "n/no-unpublished-require": "off",
      "n/no-extraneous-require": "off",
    },
  },
  // Must be last: turns off any lint rules that would conflict with Prettier.
  prettier,
];
