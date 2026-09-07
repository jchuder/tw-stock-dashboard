// Shared production-shaped universe fixtures for API specs. Feature specs
// import from here (feature -> lib is allowed) instead of duplicating stub
// payloads or importing across features (which boundaries forbid).
// The ISIN sample is real Big5 bytes from the live page: the provider decodes
// Big5, so a UTF-8 string fixture would garble CJK and exercise nothing.

const TWSE_L = [
  { '公司代號': '2330', '公司簡稱': '台積電' },
  { '公司代號': '2317', '公司簡稱': '鴻海' },
];

const TWSE_FUND = [{ '基金代號': '00981A', '基金簡稱': '主動統一台股增長' }];

const TPEX_O = [{ SecuritiesCompanyCode: '6488', CompanyAbbreviation: '環球晶' }];

const TPEX_R = [{ SecuritiesCompanyCode: '7883', CompanyAbbreviation: '饗賓' }];

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

// Complete-universe response for a universe URL, or null for anything else.
// Every source succeeds, so specs resolve through a complete build unless
// they override a URL with their own stub first.
export function universeFixtureResponse(url: string): Response | null {
  if (url.includes('t187ap03_L')) return json(TWSE_L);
  if (url.includes('t187ap47_L')) return json(TWSE_FUND);
  if (url.includes('mopsfin_t187ap03_O')) return json(TPEX_O);
  if (url.includes('mopsfin_t187ap03_R')) return json(TPEX_R);
  if (url.includes('C_public.jsp')) return new Response(ISIN_ETF_BIG5, { status: 200 });
  return null;
}
