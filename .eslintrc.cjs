module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'coverage', 'node_modules'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['react', 'react-dom', '*/ui/*', '*/debug/*'],
            message: 'parser/ は React や DOM に依存してはいけません — 純粋関数として保つこと',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/parser/**/*.ts'],
    },
    {
      files: ['src/ui/**/*.{ts,tsx}', 'src/debug/**/*.{ts,tsx}', 'src/App.tsx', 'src/main.tsx'],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      files: ['test/**/*.{ts,tsx}', 'fixtures/**/*.ts', 'vite.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
