import { Injectable, Logger } from '@nestjs/common';
import { Data, Duration, Effect } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';

export const TWSE_LISTED_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
export const TWSE_FUND_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L';
export const TPEX_OTC_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
export const TPEX_ESB_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R';
export const TPEX_ISIN_ETF_URL = 'https://isin.twse.com.tw/isin/C_public.jsp?strMode=4';

// Universe payloads are small except the ISIN page (~2.7MB Big5, observed
// 1s–25s+ under official throttling). ISIN gets its own budget so a slow page
// cannot stall the four JSON sources; rebuilds run concurrently with at most
// one in flight, and results cache for 24h.
const JSON_SOURCE_TIMEOUT = Duration.seconds(15);
const ISIN_SOURCE_TIMEOUT = Duration.seconds(45);
export class UniverseSourceError extends Data.TaggedError('UniverseSourceError')<{
  source: string;
}> {}

export interface UniverseBuild {
  securities: Security[];
  complete: boolean;
  failures: string[];
}

const log = new Logger('UniverseProvider');

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function pushRow(
  target: Security[],
  seen: Set<string>,
  symbol: string,
  name: string,
  market: Security['market'],
  type: Security['type'],
): void {
  // First source wins: TWSE stock/ETF, then TPEX stock, then ESB, then TPEX
  // ETF. No dual listing is expected; a repeat logs so drift stays visible.
  if (!symbol || seen.has(symbol)) {
    if (symbol && seen.has(symbol)) {
      log.warn(`Duplicate universe symbol ${symbol}; keeping first source`);
    }
    return;
  }
  seen.add(symbol);
  target.push({ symbol, name, market, type });
}

function parseJsonRows(raw: unknown, source: string): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    throw new UniverseSourceError({ source });
  }
  return raw as Array<Record<string, unknown>>;
}

async function fetchJsonArray(url: string, source: string, signal: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new UniverseSourceError({ source });
  }
  return parseJsonRows(await res.json(), source);
}

// ISIN mode 4 is Big5 HTML with per-category sections (`<B> ETF <B>`).
// The ETF section is the classification source; CFI `CE*` only validates.
// A missing section or zero usable rows is a provider failure — never a
// silent empty universe that would turn into false 404s downstream.
export function parseIsinEtfSection(html: string): Security[] {
  const sectionStart = html.search(/<B>\s*ETF\s*<B>/);
  if (sectionStart < 0) {
    throw new UniverseSourceError({ source: 'tpex-isin-etf' });
  }
  const after = html.slice(sectionStart);
  const nextSection = after.slice(1).search(/<td[^>]*colspan=7[^>]*><B>/);
  const section = nextSection < 0 ? after : after.slice(0, nextSection + 1);
  const rowPattern =
    /<td[^>]*>([0-9]{4}[A-Z0-9]{0,2})\s+([^<]+?)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
  const securities: Security[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let match = rowPattern.exec(section); match !== null; match = rowPattern.exec(section)) {
    const symbol = match[1].trim();
    const name = match[2].trim();
    const market = match[5].trim();
    const cfi = match[7].trim();
    if (!symbol || !name || market !== '上櫃' || !cfi.startsWith('CE')) {
      skipped += 1;
      continue;
    }
    pushRow(securities, seen, symbol, name, 'TPEX', 'etf');
  }
  if (securities.length === 0) {
    throw new UniverseSourceError({ source: 'tpex-isin-etf' });
  }
  if (skipped > 0) {
    log.warn(`ISIN ETF section skipped ${skipped} non-conforming rows`);
  }
  return securities;
}

function fetchSource(
  source: string,
  run: (signal: AbortSignal) => Promise<Security[]>,
  timeout: Duration.DurationInput = JSON_SOURCE_TIMEOUT,
): Effect.Effect<Security[], UniverseSourceError> {
  return Effect.tryPromise({
    try: async (signal) => run(signal),
    catch: (cause) => (cause instanceof UniverseSourceError ? cause : new UniverseSourceError({ source })),
  }).pipe(
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new UniverseSourceError({ source }),
    }),
  );
}

@Injectable()
export class UniverseProvider {
  build(): Effect.Effect<UniverseBuild, never> {
    return Effect.gen(this, function* () {
      const outcomes = yield* Effect.all(
        [
          Effect.either(this.fetchTwseListed()),
          Effect.either(this.fetchTwseFund()),
          Effect.either(this.fetchTpexOtc()),
          Effect.either(this.fetchTpexEsb()),
          Effect.either(this.fetchTpexIsinEtf()),
        ],
        { concurrency: 5 },
      );
      const securities: Security[] = [];
      const seen = new Set<string>();
      const failures: string[] = [];
      for (const outcome of outcomes) {
        if (outcome._tag === 'Left') {
          failures.push(outcome.left.source);
          log.warn(`Universe source failed: ${outcome.left.source}`);
        } else {
          for (const security of outcome.right) {
            pushRow(securities, seen, security.symbol, security.name, security.market, security.type);
          }
        }
      }
      return { securities, complete: failures.length === 0, failures };
    });
  }

  private fetchTwseListed(): Effect.Effect<Security[], UniverseSourceError> {
    return fetchSource('twse-listed', async (signal) => {
      const rows = await fetchJsonArray(TWSE_LISTED_URL, 'twse-listed', signal);
      const out: Security[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        pushRow(out, seen, clean(row['公司代號']), clean(row['公司簡稱']), 'TWSE', 'stock');
      }
      return out;
    });
  }

  private fetchTwseFund(): Effect.Effect<Security[], UniverseSourceError> {
    return fetchSource('twse-fund', async (signal) => {
      const rows = await fetchJsonArray(TWSE_FUND_URL, 'twse-fund', signal);
      const out: Security[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        pushRow(out, seen, clean(row['基金代號']), clean(row['基金簡稱']), 'TWSE', 'etf');
      }
      return out;
    });
  }

  private fetchTpexOtc(): Effect.Effect<Security[], UniverseSourceError> {
    return fetchSource('tpex-otc', async (signal) => {
      const rows = await fetchJsonArray(TPEX_OTC_URL, 'tpex-otc', signal);
      const out: Security[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        pushRow(out, seen, clean(row['SecuritiesCompanyCode']), clean(row['CompanyAbbreviation']), 'TPEX', 'stock');
      }
      return out;
    });
  }

  private fetchTpexEsb(): Effect.Effect<Security[], UniverseSourceError> {
    return fetchSource('tpex-esb', async (signal) => {
      const rows = await fetchJsonArray(TPEX_ESB_URL, 'tpex-esb', signal);
      const out: Security[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        pushRow(out, seen, clean(row['SecuritiesCompanyCode']), clean(row['CompanyAbbreviation']), 'ESB', 'stock');
      }
      return out;
    });
  }

  private fetchTpexIsinEtf(): Effect.Effect<Security[], UniverseSourceError> {
    return fetchSource(
      'tpex-isin-etf',
      async (signal) => {
        const res = await fetch(TPEX_ISIN_ETF_URL, { signal, headers: { Accept: 'text/html' } });
        if (!res.ok) {
          throw new UniverseSourceError({ source: 'tpex-isin-etf' });
        }
        const html = new TextDecoder('big5').decode(Buffer.from(await res.arrayBuffer()));
        return parseIsinEtfSection(html);
      },
      ISIN_SOURCE_TIMEOUT,
    );
  }
}
