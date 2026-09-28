/** ESLint owns configuration failure reporting and rerun recovery. */
import { readdirSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

const privatePaths = ['**/core/**', '**/adapters/**'];
const coreForbidden = [
  '**/contract/api*',
  '**/contract/index*',
  '**/contract/compose*',
  '**/contract/compose/**',
  '**/adapters/**',
  '**/apps/**',
  '@novakai/*',
];
/** Capability directories define the boundary vocabulary; new capabilities require no rule edit. */
const capabilityNames = readdirSync(new URL('./capability/', import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => RegExp.escape(entry.name))
  .join('|');
/** Named capability segments cover full paths and sibling-relative paths; own ../contract imports stay local. */
const capabilityEntry = {
  regex: `(?:^|/)(?:${capabilityNames})/contract/(?!index\\.(?:js|ts)$)`,
  message: 'Import capabilities through contract/index.js; declaration files are private.',
};
/** Empty path restrictions let composition wire adapters while retaining the foreign contract boundary. */
function pathRestrictions(group) {
  if (group.length === 0) return [];
  return [{ group, message: 'Use the permitted capability contract; see import matrix.' }];
}
/** Every layer retains the capability public-entry restriction, including composition roots. */
const restrict = (group) => ['error', { patterns: [...pathRestrictions(group), capabilityEntry] }];

export default tseslint.config(
  { ignores: ['node_modules/**', '**/node_modules/**', '**/dist/**', '**/.generated/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 2],
      'no-restricted-imports': restrict(privatePaths),
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: 'List public exports explicitly; wildcard exports silently widen the contract.',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['capability/*/core/**/*.{ts,tsx}', 'apps/*/core/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(coreForbidden) },
  },
  {
    files: ['capability/*/contract/api.ts', 'apps/*/contract/api.ts'],
    rules: { 'no-restricted-imports': restrict(['**/adapters/**']) },
  },
  {
    files: ['capability/*/tests/**/*.{ts,tsx}', 'apps/*/tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(['**/core/**']) },
  },
  {
    files: [
      'capability/*/contract/compose.ts',
      'capability/*/contract/compose/**/*.{ts,tsx}',
      'apps/*/contract/compose.ts',
      'apps/*/contract/compose/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': restrict([]) },
  },
  { files: ['*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
