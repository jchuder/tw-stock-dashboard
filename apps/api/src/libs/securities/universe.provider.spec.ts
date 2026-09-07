import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TPEX_ESB_URL,
  TPEX_ISIN_ETF_URL,
  TPEX_OTC_URL,
  TWSE_FUND_URL,
  TWSE_LISTED_URL,
  UniverseProvider,
} from './universe.provider.js';

const TWSE_L = [
  { '公司代號': '2330', '公司簡稱': '台積電' },
  { '公司代號': '2317', '公司簡稱': '鴻海' },
];

const TWSE_FUND = [{ '基金代號': '00981A', '基金簡稱': '主動統一台股增長' }];

const TPEX_O = [{ SecuritiesCompanyCode: '6488', CompanyAbbreviation: '環球晶' }];

const TPEX_R = [{ SecuritiesCompanyCode: '7883', CompanyAbbreviation: '饗賓' }];

// Production Big5 sample: ETF section header plus the 00411A and 006201 rows,
// captured 2026-09-07 from the live ISIN page. The provider decodes Big5, so
// the fixture must be real Big5 bytes — a UTF-8 string would garble the CJK
// market marker and exercise nothing.
const ISIN_ETF_BIG5 = Buffer.concat([
  Buffer.from(
    'Z2NvbG9yPSNGQUZBRDI+PC90ZD48L3RyPjx0cj48dGQgYmdjb2xvcj0jRkFGQUQyIGNvbHNwYW49NyA+PEI+IEVURiA8Qj4gPC90ZD48L3RyPjx0cj48dGQgYmdjb2xvcj0jRkFGQUQyPjAwNDExQaFApUSwyrLOpECrZap1rOyn3jwvdGQ+PHRkIGJnY29sb3I9I0ZBRkFEMj5UVzAwMDAwNDExQTA8L3RkPjx0ZCBiZ2NvbG9yPSNGQUZBRDI+MjAyNi8wOC8yNjwvdGQ+PHRkIGJnY29sb3I9I0ZBRkFEMj6kV8JkPC90ZD48dGQgYmdjb2xvcj0jRkFGQUQyPjwvdGQ+PHRkIGJnY29sb3I9I0ZBRkFEMj5DRU9JRVU8L3RkPjx0ZCBiZ2NvbG9yPSNGQUZBRDI+PC90ZD48L3RyPg==',
    'base64',
  ),
  Buffer.from(
    'PHRyPjx0ZCBiZ2NvbG9yPSNGQUZBRDI+MDA2MjAxoUCkuKRqtEnCZDUwPC90ZD48dGQgYmdjb2xvcj0jRkFGQUQyPlRXMDAwMDA2MjAxNzwvdGQ+PHRkIGJnY29sb3I9I0ZBRkFEMj4yMDExLzAxLzI3PC90ZD48dGQgYmdjb2xvcj0jRkFGQUQyPqRXwmQ8L3RkPjx0ZCBiZ2NvbG9yPSNGQUZBRDI+PC90ZD48dGQgYmdjb2xvcj0jRkFGQUQyPkNFT0dFVTwvdGQ+PHRkIGJnY29sb3I9I0ZBRkFEMj48L3RkPjwvdHI+',
    'base64',
  ),
]);

function stubUniverse(overrides: Record<string, Response> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url in overrides) {
        return overrides[url].clone();
      }
      if (url === TWSE_LISTED_URL) return new Response(JSON.stringify(TWSE_L), { status: 200 });
      if (url === TWSE_FUND_URL) return new Response(JSON.stringify(TWSE_FUND), { status: 200 });
      if (url === TPEX_OTC_URL) return new Response(JSON.stringify(TPEX_O), { status: 200 });
      if (url === TPEX_ESB_URL) return new Response(JSON.stringify(TPEX_R), { status: 200 });
      if (url === TPEX_ISIN_ETF_URL) return new Response(ISIN_ETF_BIG5, { status: 200 });
      throw new Error(`unexpected universe call: ${url}`);
    }),
  );
}

function runBuild() {
  return Effect.runPromise(new UniverseProvider().build());
}

describe('UniverseProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges five official sources with market and type', async () => {
    stubUniverse();

    const build = await runBuild();

    expect(build.complete).toBe(true);
    expect(build.failures).toEqual([]);
    expect(build.securities).toEqual([
      { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
      { symbol: '2317', name: '鴻海', market: 'TWSE', type: 'stock' },
      { symbol: '00981A', name: '主動統一台股增長', market: 'TWSE', type: 'etf' },
      { symbol: '6488', name: '環球晶', market: 'TPEX', type: 'stock' },
      { symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' },
      { symbol: '00411A', name: '主動統一前沿科技', market: 'TPEX', type: 'etf' },
      { symbol: '006201', name: '元大富櫃50', market: 'TPEX', type: 'etf' },
    ]);
  });

  it('marks partial builds and keeps successful sources', async () => {
    stubUniverse({ [TPEX_ISIN_ETF_URL]: new Response('boom', { status: 500 }) });

    const build = await runBuild();

    expect(build.complete).toBe(false);
    expect(build.failures).toEqual(['tpex-isin-etf']);
    expect(build.securities.map((s) => s.symbol)).toEqual(['2330', '2317', '00981A', '6488', '7883']);
  });

  it('treats a missing ISIN ETF section as a provider failure, not an empty universe', async () => {
    stubUniverse({ [TPEX_ISIN_ETF_URL]: new Response('<html>no sections here</html>', { status: 200 }) });

    const build = await runBuild();

    expect(build.complete).toBe(false);
    expect(build.failures).toEqual(['tpex-isin-etf']);
  });
  it('skips non-CE CFI rows instead of classifying them as ETFs', async () => {
    // ASCII-safe row except the market cell, which must be real Big5 上櫃 so
    // the skip is driven by the RWSCCA CFI check rather than a garbled market.
    const warrantRow = Buffer.concat([
      Buffer.from('<tr><td>700001 warrant</td><td>TW25Z7000011</td><td>2026/01/01</td><td>', 'utf8'),
      Buffer.from('pFfCZA==', 'base64'),
      Buffer.from('</td><td></td><td>RWSCCA</td><td></td></tr>', 'utf8'),
    ]);
    stubUniverse({
      [TPEX_ISIN_ETF_URL]: new Response(Buffer.concat([ISIN_ETF_BIG5, warrantRow]), { status: 200 }),
    });

    const build = await runBuild();

    expect(build.complete).toBe(true);
    expect(build.securities.map((s) => s.symbol)).not.toContain('700001');
  });

  it('keeps the first source on duplicate symbols', async () => {
    stubUniverse({
      [TPEX_OTC_URL]: new Response(
        JSON.stringify([
          { SecuritiesCompanyCode: '6488', CompanyAbbreviation: '環球晶' },
          { SecuritiesCompanyCode: '2330', CompanyAbbreviation: '冒名' },
        ]),
        { status: 200 },
      ),
    });

    const build = await runBuild();

    expect(build.complete).toBe(true);
    expect(build.securities.find((s) => s.symbol === '2330')).toEqual({
      symbol: '2330',
      name: '台積電',
      market: 'TWSE',
      type: 'stock',
    });
  });

  it('resolves through Either for service wiring', async () => {
    stubUniverse();

    const result = await Effect.runPromise(Effect.either(new UniverseProvider().build()));

    expect(Either.isRight(result)).toBe(true);
  });
});
