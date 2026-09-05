// Boundary regression guard: proves eslint-plugin-boundaries actually blocks
// the forbidden directions (and allows feature -> shared / feature -> lib).
//
// Why this exists: the dependency rule silently skips anything it cannot
// classify (unknown elements, unresolvable .js ESM imports). A policy that
// references a deleted element type, or a resolver gap, looks green while
// enforcing nothing. Temp probes caught this twice; this script makes the
// proof repeatable: `pnpm verify:boundaries`.
//
// It writes throwaway fixtures inside the real element folders (patterns only
// match inside the repo tree), lints them, asserts per-file expectations,
// then removes every fixture even on failure.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARY_RULE = 'boundaries/dependencies';

const FIXTURES = [
  {
    file: 'apps/web/src/features/__bv-a__/a.ts',
    content: `import { API_BASE_URL } from '../../shared/api/base-url.js';\nexport const a = API_BASE_URL;\n`,
    expectViolation: false,
    label: 'web-feature -> web-shared (allowed)',
  },
  {
    file: 'apps/web/src/features/__bv-b__/b.ts',
    content: `import { a } from '../__bv-a__/a.js';\nexport const b = a;\n`,
    expectViolation: true,
    label: 'web-feature A -> web-feature B (blocked)',
  },
  {
    file: 'apps/web/src/shared/__bv__/c.ts',
    content: `import { a } from '../../features/__bv-a__/a.js';\nexport const c = a;\n`,
    expectViolation: true,
    label: 'web-shared -> web-feature (blocked)',
  },
  {
    file: 'apps/web/src/shared/__bv__/d.ts',
    content: `import { AppModule } from '../../../../../apps/api/src/app.module.js';\nexport const d = AppModule;\n`,
    expectViolation: true,
    label: 'web -> api source (blocked)',
  },
  {
    file: 'apps/api/src/features/__bv-e__/e.ts',
    content: `import { App } from '../../../../../apps/web/src/app/App.js';\nexport const e = App;\n`,
    expectViolation: true,
    label: 'api -> web source (blocked)',
  },
  {
    file: 'apps/api/src/features/__bv-f__/f.ts',
    content: `import { LOG_LEVEL } from '../../libs/observability/logger.config.js';\nexport const f = LOG_LEVEL;\n`,
    expectViolation: false,
    label: 'api-feature -> api-lib (allowed)',
  },
  {
    file: 'apps/api/src/libs/__bv__/g.ts',
    content: `import { StockQuoteModule } from '../../features/stock-quote/stock-quote.module.js';\nexport const g = StockQuoteModule;\n`,
    expectViolation: true,
    label: 'api-lib -> api-feature (blocked)',
  },
];

const createdDirs = new Set();

function cleanup() {
  for (const { file } of FIXTURES) {
    rmSync(join(ROOT, file), { force: true });
  }
  for (const dir of [...createdDirs].sort().reverse()) {
    rmSync(join(ROOT, dir), { force: true, recursive: true });
  }
}

let failures = 0;
try {
  for (const { file, content } of FIXTURES) {
    const abs = join(ROOT, file);
    mkdirSync(dirname(abs), { recursive: true });
    createdDirs.add(dirname(file));
    writeFileSync(abs, content);
  }

  let raw;
  try {
    raw = execFileSync('node_modules/.bin/eslint', ['--format', 'json', ...FIXTURES.map((f) => f.file)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // eslint exits non-zero when violations exist; JSON is still on stdout.
    raw = err.stdout ?? '[]';
  }
  const results = new Map(JSON.parse(raw).map((r) => [r.filePath, r.messages ?? []]));

  for (const { file, expectViolation, label } of FIXTURES) {
    const abs = join(ROOT, file);
    const violations = (results.get(abs) ?? []).filter((m) => m.ruleId === BOUNDARY_RULE);
    const blocked = violations.length > 0;
    if (blocked === expectViolation) {
      console.log(`ok   ${label}`);
    } else {
      failures += 1;
      console.log(`FAIL ${label}: expected ${expectViolation ? 'a violation' : 'clean'}, got ${violations.length} boundary error(s)`);
      for (const v of violations) {
        console.log(`       ${v.line}:${v.column} ${v.message}`);
      }
    }
  }
} finally {
  cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} boundary expectation(s) failed`);
  process.exit(1);
}
console.log('\nall boundary expectations hold');
