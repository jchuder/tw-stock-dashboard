// ADR 001: TypeScript pinned to 6.0.3 (not 7.0.2) — Nest CLI 12 + typescript-eslint
// do not yet support the TS 7.0 programmatic API. See docs/adr/001-typescript-downgrade.md.
// Revisit when both publish TS 7 support (expected TS 7.1).

import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const webLayers = ['web-app', 'web-widgets', 'web-feature', 'web-entity', 'web-core', 'web-shared'];
const apiLayers = ['api-app', 'api-feature', 'api-lib'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        // NOTE: elementsSingleType defaults to first-match-wins. List deeper
        // folder patterns before any descriptor whose subtree covers them
        // (api-feature before api-app), or the parent silently swallows the child.
        { type: 'web-app', pattern: 'apps/web/src/app' },
        { type: 'web-widgets', pattern: 'apps/web/src/widgets/*', capture: ['widget'] },
        { type: 'web-feature', pattern: 'apps/web/src/features/*', capture: ['feature'] },
        { type: 'web-entity', pattern: 'apps/web/src/entities/*', capture: ['entity'] },
        { type: 'web-core', pattern: 'apps/web/src/core' },
        { type: 'web-shared', pattern: 'apps/web/src/shared' },
        { type: 'api-feature', pattern: 'apps/api/src/features/*', capture: ['feature'] },
        { type: 'api-lib', pattern: 'apps/api/src/libs/*', capture: ['lib'] },
        { type: 'api-app', pattern: 'apps/api/src' },
        { type: 'contracts', pattern: 'packages/contracts/src' },
      ],
      // Let boundaries resolve TypeScript ESM imports that use `.js` extensions
      // (e.g. `from '../shared/api/health.js'` → `health.ts`). Without this,
      // those dependencies are "unknown" and silently skip the disallow default.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['tsconfig.base.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      // Same-element (same feature folder, same entity folder, …) imports are
      // skipped by default (checkInternals: false), so a disallow between two
      // files of one element type only fires across element instances —
      // exactly the feature A → feature B / entity A → entity B block.
      'boundaries/dependencies': [
        2,
        {
          default: 'disallow',
          policies: [
            {
              // Cross-app code flows only through packages/contracts.
              allow: { to: { element: { type: 'contracts' } } },
            },
            {
              from: { element: { type: 'web-entity' } },
              allow: { to: { element: { type: 'web-shared' } } },
            },
            {
              from: { element: { type: 'web-feature' } },
              allow: { to: { element: { types: { anyOf: ['web-entity', 'web-shared'] } } } },
            },
            {
              from: { element: { type: 'web-widgets' } },
              allow: {
                to: { element: { types: { anyOf: ['web-feature', 'web-entity', 'web-shared'] } } },
              },
            },
            {
              from: { element: { type: 'web-app' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['web-widgets', 'web-feature', 'web-entity', 'web-core', 'web-shared'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'web-core' } },
              allow: { to: { element: { type: 'web-shared' } } },
            },
            {
              from: { element: { type: 'api-app' } },
              allow: { to: { element: { types: { anyOf: ['api-feature', 'api-lib'] } } } },
            },
            {
              from: { element: { type: 'api-feature' } },
              allow: { to: { element: { type: 'api-lib' } } },
            },
            {
              from: { element: { type: 'api-lib' } },
              disallow: { to: { element: { type: 'api-feature' } } },
              message: 'api libs must not depend on features; invert the dependency',
            },
            {
              from: { element: { types: { anyOf: webLayers } } },
              disallow: { to: { element: { types: { anyOf: apiLayers } } } },
              message: 'apps/web must not import apps/api source; share code via packages/contracts',
            },
            {
              from: { element: { types: { anyOf: apiLayers } } },
              disallow: { to: { element: { types: { anyOf: webLayers } } } },
              message: 'apps/api must not import apps/web source; share code via packages/contracts',
            },
          ],
        },
      ],
    },
  },
);
