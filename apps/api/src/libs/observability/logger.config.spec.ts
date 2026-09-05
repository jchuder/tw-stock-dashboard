import { describe, expect, it } from 'vitest';
import {
  buildHttpCompletionLog,
  httpLogLevel,
  resolveRequestId,
  routeTemplate,
} from './logger.config.js';

describe('resolveRequestId', () => {
  it('reuses a valid incoming X-Request-ID', () => {
    expect(resolveRequestId('q6a-test-123')).toBe('q6a-test-123');
  });

  it('generates a UUID when the header is missing', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates a UUID for empty, overlong, or non-ASCII values', () => {
    expect(resolveRequestId('')).not.toBe('');
    expect(resolveRequestId('x'.repeat(129))).not.toHaveLength(129);
    expect(resolveRequestId('帶中文的id')).not.toBe('帶中文的id');
    expect(resolveRequestId(['a', 'b'])).not.toEqual(['a', 'b']);
  });
});

describe('routeTemplate', () => {
  it('prefers the registered route template', () => {
    expect(routeTemplate('/api/v1/stocks/:symbol/quote', '/api/v1/stocks/2330/quote')).toBe(
      '/api/v1/stocks/:symbol/quote',
    );
  });

  it('falls back to the raw path without query string', () => {
    expect(routeTemplate(undefined, '/api/v1/stocks/2330/quote?foo=bar')).toBe('/api/v1/stocks/2330/quote');
  });
});

describe('buildHttpCompletionLog', () => {
  it('emits only the safe flat shape for a secret-bearing request', () => {
    const hostile = {
      requestId: 'q6a-test-123',
      method: 'GET',
      routePath: '/api/v1/stocks/:symbol/quote',
      url: '/api/v1/stocks/2330/quote',
      statusCode: 200,
      durationMs: 12,
      headers: { authorization: 'Bearer SECRET', cookie: 'SECRET', 'x-api-key': 'SECRET' },
      body: { secret: 'SECRET' },
    };
    const log = buildHttpCompletionLog(hostile);

    expect(log).toEqual({
      event: 'http_request_completed',
      request_id: 'q6a-test-123',
      method: 'GET',
      route: '/api/v1/stocks/:symbol/quote',
      status_code: 200,
      duration_ms: 12,
    });
    expect(JSON.stringify(log)).not.toContain('SECRET');
  });
});

describe('httpLogLevel', () => {
  it('maps 200 to info, 404 to warn, 500 to error', () => {
    expect(httpLogLevel(200)).toBe('info');
    expect(httpLogLevel(404)).toBe('warn');
    expect(httpLogLevel(500)).toBe('error');
  });
});
