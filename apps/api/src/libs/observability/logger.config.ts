import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-ID';
export const MAX_REQUEST_ID_LENGTH = 128;

// Incoming IDs must be short printable ASCII; anything else (missing,
// array, overlong, control characters) gets a fresh UUID. Never let an
// arbitrary header value flow straight into logs.
const SAFE_REQUEST_ID = /^[\x20-\x7E]+$/;

export function resolveRequestId(incoming: unknown): string {
  if (
    typeof incoming === 'string' &&
    incoming.length >= 1 &&
    incoming.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(incoming)
  ) {
    return incoming;
  }
  return randomUUID();
}

export interface HttpCompletionInput {
  requestId: unknown;
  method: string;
  routePath?: string;
  url: string;
  statusCode: number;
  durationMs: number;
}

// Prefer the registered Express route template (/api/v1/stocks/:symbol/quote)
// so logs stay low-cardinality; fall back to the raw path without query.
export function routeTemplate(routePath: string | undefined, url: string): string {
  if (routePath && routePath.length > 0) {
    return routePath;
  }
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

// The ONLY shape HTTP completion logs may take. No bodies, no headers,
// no cookies, no credentials — flat safe fields by construction.
export function buildHttpCompletionLog(input: HttpCompletionInput) {
  return {
    event: 'http_request_completed',
    request_id: input.requestId,
    method: input.method,
    route: routeTemplate(input.routePath, input.url),
    status_code: input.statusCode,
    duration_ms: input.durationMs,
  };
}

export function httpLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}

// Defense-in-depth only: completion objects never serialize these, but keep
// the redactor armed in case a future log call passes req/res through.
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
];

export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
