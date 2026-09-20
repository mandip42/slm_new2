import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'public/worklets/**',
      'public/sw.js',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // Node-side build scripts and test files are not part of the browser bundle.
    files: ['scripts/**/*.mjs', 'e2e/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
