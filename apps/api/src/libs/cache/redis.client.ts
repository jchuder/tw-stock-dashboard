import { Logger } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

// Fail-open Redis access. No REDIS_URL means the cache is intentionally
// disabled (INFO once); a configured-but-unreachable Redis degrades to
// bypass with throttled WARNs — never a per-request log flood, never a 500.
const log = new Logger('RedisClient');

let client: RedisClientType | null = null;
let disabledLogged = false;
let lastWarnAt = 0;
const WARN_THROTTLE_MS = 60_000;

function warnThrottled(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_THROTTLE_MS) {
    return;
  }
  lastWarnAt = now;
  log.warn(message);
}

export function reportRedisFailure(message: string): void {
  warnThrottled(message);
}

function getUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url ? url : null;
}

export function getRedisClient(): RedisClientType | null {
  const url = getUrl();
  if (!url) {
    if (!disabledLogged) {
      disabledLogged = true;
      log.log('REDIS_URL is not set; cache is intentionally disabled');
    }
    return null;
  }
  if (!client) {
    client = createClient({ url });
    client.on('error', (err: unknown) => {
      warnThrottled(`Redis client error, bypassing cache: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return client;
}
