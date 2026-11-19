import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser, ecmaVersion: 2023, sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, 'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }] },
  },
];
