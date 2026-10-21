import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Flat config. The source is linted with typescript-eslint's `recommended` plus the unused/dead-code rules below; style is Prettier's job
// (eslint-config-prettier switches off every rule that would fight it). Non-null assertions (`!`) are used deliberately in the typed-array
// core and stay allowed.
const deadCode = {
  '@typescript-eslint/no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-constant-binary-expression': 'error',
  'no-self-compare': 'error',
  'no-unreachable': 'error',
  'no-useless-return': 'error',
  'prefer-const': 'error',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...deadCode,
      '@typescript-eslint/no-non-null-assertion': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Node scripts and benchmarks: same dead-code rules, Node and browser globals (page.evaluate callbacks use the DOM).
    files: ['scripts/**/*.mjs', 'bench/**/*.mjs', 'test/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { ...deadCode },
  },
  prettier,
);
